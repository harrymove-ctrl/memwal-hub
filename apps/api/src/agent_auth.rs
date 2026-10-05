use axum::{Json, extract::State, http::StatusCode};
use axum_extra::extract::CookieJar;
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use chrono::{DateTime, Duration, Utc};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{
    AppState,
    auth::authenticated_user_id,
    error::ApiError,
    gateway::{generate_gateway_key, hash_gateway_key},
};

/// Device codes stay valid for ten minutes; agents poll every few seconds.
const DEVICE_CODE_TTL_MINUTES: i64 = 10;
const POLL_INTERVAL_SECONDS: u32 = 3;

#[derive(Debug, Deserialize, ToSchema)]
pub struct StartDeviceAuthorization {
    /// Human-readable label the approving operator sees, e.g. "Claude Code on MacBook".
    pub agent_label: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct DeviceAuthorizationStarted {
    /// Secret the agent polls with. Never shown to the operator.
    pub device_code: String,
    /// Short code the operator types or clicks to approve, e.g. "XK7P-29QD".
    pub user_code: String,
    /// Where the operator approves the request.
    pub verification_uri: String,
    pub expires_in_seconds: i64,
    pub poll_interval_seconds: u32,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct PollDeviceAuthorization {
    pub device_code: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct DeviceAuthorizationToken {
    /// "pending", "approved" (key present exactly once), or "denied".
    pub status: String,
    /// The gateway key. Present only on the first poll after approval.
    pub key: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct DecideDeviceAuthorization {
    /// The short user code shown by the agent, e.g. "XK7P-29QD".
    pub user_code: String,
    /// true approves and issues a gateway key; false denies.
    pub approve: bool,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct PendingDeviceAuthorization {
    pub user_code: String,
    pub agent_label: String,
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
}

#[derive(Debug, FromRow)]
struct DeviceRow {
    id: Uuid,
    status: String,
    expires_at: DateTime<Utc>,
}

fn database_error(error: sqlx::Error) -> ApiError {
    eprintln!("agent auth database error: {error}");
    ApiError::Internal
}

fn generate_user_code() -> String {
    // Unambiguous alphabet: no 0/O, 1/I/L.
    const ALPHABET: &[u8] = b"23456789ABCDEFGHJKMNPQRSTUVWXYZ";
    let mut bytes = [0_u8; 8];
    rand::thread_rng().fill_bytes(&mut bytes);
    let mut code: String = bytes
        .iter()
        .map(|byte| ALPHABET[*byte as usize % ALPHABET.len()] as char)
        .collect();
    code.insert(4, '-');
    code
}

fn generate_device_code() -> String {
    let mut secret = [0_u8; 32];
    rand::thread_rng().fill_bytes(&mut secret);
    format!("hwd_{}", URL_SAFE_NO_PAD.encode(secret))
}

#[utoipa::path(
    post,
    path = "/agent-auth/device",
    request_body = StartDeviceAuthorization,
    responses(
        (status = 201, description = "Device authorization started; poll with the device code", body = DeviceAuthorizationStarted),
        (status = 422, description = "Invalid agent label", body = crate::ErrorResponse)
    ),
    tag = "agent auth"
)]
pub async fn start_device_authorization(
    State(state): State<AppState>,
    Json(payload): Json<StartDeviceAuthorization>,
) -> Result<(StatusCode, Json<DeviceAuthorizationStarted>), ApiError> {
    let label = payload.agent_label.trim();
    if label.is_empty() || label.len() > 64 {
        return Err(ApiError::Validation(
            "agent_label must be between 1 and 64 characters",
        ));
    }

    let device_code = generate_device_code();
    let user_code = generate_user_code();
    let expires_at = Utc::now() + Duration::minutes(DEVICE_CODE_TTL_MINUTES);

    sqlx::query(
        "INSERT INTO agent_device_authorizations
            (id, device_code_hash, user_code, agent_label, expires_at)
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(Uuid::new_v4())
    .bind(hash_gateway_key(&device_code))
    .bind(&user_code)
    .bind(label)
    .bind(expires_at)
    .execute(&state.pool)
    .await
    .map_err(database_error)?;

    let frontend = state
        .config
        .frontend_origin
        .to_str()
        .unwrap_or("http://localhost:5173")
        .trim_end_matches('/')
        .to_owned();

    Ok((
        StatusCode::CREATED,
        Json(DeviceAuthorizationStarted {
            device_code,
            verification_uri: format!("{frontend}/agents?device_code={user_code}"),
            user_code,
            expires_in_seconds: DEVICE_CODE_TTL_MINUTES * 60,
            poll_interval_seconds: POLL_INTERVAL_SECONDS,
        }),
    ))
}

#[utoipa::path(
    post,
    path = "/agent-auth/device/token",
    request_body = PollDeviceAuthorization,
    responses(
        (status = 200, description = "Current authorization status; the key appears exactly once after approval", body = DeviceAuthorizationToken),
        (status = 404, description = "Unknown or expired device code", body = crate::ErrorResponse)
    ),
    tag = "agent auth"
)]
pub async fn poll_device_authorization(
    State(state): State<AppState>,
    Json(payload): Json<PollDeviceAuthorization>,
) -> Result<Json<DeviceAuthorizationToken>, ApiError> {
    let row = sqlx::query_as::<_, DeviceRow>(
        "SELECT id, status, expires_at
         FROM agent_device_authorizations
         WHERE device_code_hash = $1",
    )
    .bind(hash_gateway_key(&payload.device_code))
    .fetch_optional(&state.pool)
    .await
    .map_err(database_error)?
    .ok_or(ApiError::NotFound)?;

    // TTL binds every state: an approved-but-unclaimed key dies with the
    // code instead of lingering as a claimable plaintext secret.
    if row.expires_at < Utc::now() {
        sqlx::query(
            "UPDATE agent_device_authorizations
             SET status = 'consumed', issued_key = NULL
             WHERE id = $1 AND status IN ('pending', 'approved')",
        )
        .bind(row.id)
        .execute(&state.pool)
        .await
        .map_err(database_error)?;
        return Err(ApiError::NotFound);
    }

    match row.status.as_str() {
        "pending" => Ok(Json(DeviceAuthorizationToken {
            status: "pending".to_owned(),
            key: None,
        })),
        "denied" => Ok(Json(DeviceAuthorizationToken {
            status: "denied".to_owned(),
            key: None,
        })),
        "approved" => {
            // Atomic consume: exactly one poll can ever read the key, even
            // under concurrent or replayed requests.
            let issued = sqlx::query_scalar::<_, Option<String>>(
                "UPDATE agent_device_authorizations
                 SET status = 'consumed', issued_key = NULL
                 WHERE id = $1 AND status = 'approved'
                 RETURNING (SELECT issued_key FROM agent_device_authorizations WHERE id = $1)",
            )
            .bind(row.id)
            .fetch_optional(&state.pool)
            .await
            .map_err(database_error)?
            .flatten();
            match issued {
                Some(key) => Ok(Json(DeviceAuthorizationToken {
                    status: "approved".to_owned(),
                    key: Some(key),
                })),
                None => Err(ApiError::NotFound),
            }
        }
        // "consumed": key already handed out once; treat as gone.
        _ => Err(ApiError::NotFound),
    }
}

#[utoipa::path(
    get,
    path = "/agent-auth/device/pending",
    responses(
        (status = 200, description = "Pending authorization requests awaiting this operator", body = [PendingDeviceAuthorization]),
        (status = 401, description = "Hub login required", body = crate::ErrorResponse)
    ),
    tag = "agent auth"
)]
pub async fn list_pending_authorizations(
    State(state): State<AppState>,
    jar: CookieJar,
) -> Result<Json<Vec<PendingDeviceAuthorization>>, ApiError> {
    authenticated_user_id(&state, &jar).await?;
    let rows = sqlx::query_as::<_, (String, String, DateTime<Utc>, DateTime<Utc>)>(
        "SELECT user_code, agent_label, created_at, expires_at
         FROM agent_device_authorizations
         WHERE status = 'pending' AND expires_at > NOW()
         ORDER BY created_at DESC",
    )
    .fetch_all(&state.pool)
    .await
    .map_err(database_error)?;

    Ok(Json(
        rows.into_iter()
            .map(
                |(user_code, agent_label, created_at, expires_at)| PendingDeviceAuthorization {
                    user_code,
                    agent_label,
                    created_at,
                    expires_at,
                },
            )
            .collect(),
    ))
}

#[utoipa::path(
    post,
    path = "/agent-auth/device/decision",
    request_body = DecideDeviceAuthorization,
    responses(
        (status = 204, description = "Authorization approved or denied"),
        (status = 401, description = "Hub login required", body = crate::ErrorResponse),
        (status = 404, description = "Unknown, expired, or already-decided code", body = crate::ErrorResponse)
    ),
    tag = "agent auth"
)]
pub async fn decide_device_authorization(
    State(state): State<AppState>,
    jar: CookieJar,
    Json(payload): Json<DecideDeviceAuthorization>,
) -> Result<StatusCode, ApiError> {
    let user_id = authenticated_user_id(&state, &jar).await?;
    let user_code = payload.user_code.trim().to_uppercase();

    let row = sqlx::query_as::<_, (Uuid,)>(
        "SELECT id FROM agent_device_authorizations
         WHERE user_code = $1 AND status = 'pending' AND expires_at > NOW()",
    )
    .bind(&user_code)
    .fetch_optional(&state.pool)
    .await
    .map_err(database_error)?
    .ok_or(ApiError::NotFound)?;

    if !payload.approve {
        sqlx::query("UPDATE agent_device_authorizations SET status = 'denied' WHERE id = $1")
            .bind(row.0)
            .execute(&state.pool)
            .await
            .map_err(database_error)?;
        return Ok(StatusCode::NO_CONTENT);
    }

    // Issue a real gateway key owned by the approving operator.
    let key = generate_gateway_key();
    let key_id = Uuid::new_v4();
    let mut tx = state.pool.begin().await.map_err(database_error)?;
    sqlx::query(
        "INSERT INTO gateway_keys (id, user_id, key_hash, last_four)
         VALUES ($1, $2, $3, $4)",
    )
    .bind(key_id)
    .bind(user_id)
    .bind(hash_gateway_key(&key))
    .bind(&key[key.len() - 4..])
    .execute(&mut *tx)
    .await
    .map_err(database_error)?;
    let updated = sqlx::query(
        "UPDATE agent_device_authorizations
         SET status = 'approved', approved_by = $1, gateway_key_id = $2, issued_key = $3
         WHERE id = $4 AND status = 'pending'",
    )
    .bind(user_id)
    .bind(key_id)
    .bind(&key)
    .bind(row.0)
    .execute(&mut *tx)
    .await
    .map_err(database_error)?;
    if updated.rows_affected() == 0 {
        // Lost the race to a concurrent approval: abort, leaving no orphan key.
        tx.rollback().await.map_err(database_error)?;
        return Err(ApiError::NotFound);
    }
    tx.commit().await.map_err(database_error)?;

    Ok(StatusCode::NO_CONTENT)
}
