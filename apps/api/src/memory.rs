use std::{path::PathBuf, time::Duration};

use aes_gcm::{Aes256Gcm, KeyInit, Nonce, aead::Aead};
use axum::{
    Json,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use axum_extra::extract::CookieJar;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tokio::{io::AsyncWriteExt, process::Command, time::timeout};
use uuid::Uuid;

use crate::{AppState, auth::optional_authenticated_user_id, error::ApiError};

/// The public Walrus Memory relayer. `GET /config` on it reports `mainnet`.
pub(crate) const DEFAULT_SERVER: &str = "https://relayer.memory.walrus.xyz";
pub(crate) const DEFAULT_NAMESPACE: &str = "bew-harness/product-discovery";
const REQUIRED_NETWORK: &str = "mainnet";

#[derive(Debug, Serialize)]
pub struct MemorySession {
    pub signed_in: bool,
    pub address: Option<String>,
    pub walrus: WalrusStatus,
}

#[derive(Debug, Serialize)]
pub struct WalrusStatus {
    pub configured: bool,
    pub status: String,
    pub account_id: Option<String>,
    pub namespace: String,
    pub server_url: String,
    pub network: String,
    pub last_error: Option<String>,
    pub last_error_code: Option<String>,
    pub last_verified_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Debug, Deserialize)]
pub struct SaveWalrus {
    pub account_id: String,
    pub delegate_key: Option<String>,
    pub namespace: Option<String>,
    pub server_url: Option<String>,
    pub network: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct RecallQuery {
    pub query: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct MemoryHit {
    pub text: String,
    pub blob_id: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct MemoryRecall {
    pub address: String,
    pub status: String,
    pub detail: String,
    pub memories: Vec<MemoryHit>,
}

/// A Walrus Memory failure, already classified by the SDK bridge.
#[derive(Debug, Clone)]
pub(crate) struct SdkError {
    pub code: String,
    pub message: String,
}

impl SdkError {
    fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.to_owned(),
            message: message.into(),
        }
    }
}

pub(crate) struct StoredWalrus {
    pub account_id: String,
    pub server_url: String,
    pub namespace: String,
    pub key: String,
    pub status: String,
    pub last_error: Option<String>,
}

pub(crate) fn json_error(status: StatusCode, code: &str, message: impl Into<String>) -> Response {
    (
        status,
        Json(json!({ "code": code, "message": message.into() })),
    )
        .into_response()
}

/// Relayers a delegate key may be sent to. The key is never forwarded to an
/// arbitrary server named in a request.
pub(crate) fn allowed_relayers() -> Vec<String> {
    let mut allowed = vec![DEFAULT_SERVER.to_owned()];
    if let Ok(extra) = std::env::var("MEMWAL_ALLOWED_RELAYERS") {
        for value in extra.split(',') {
            let value = value.trim().trim_end_matches('/');
            if value.starts_with("https://") && !allowed.iter().any(|item| item == value) {
                allowed.push(value.to_owned());
            }
        }
    }
    allowed
}

pub(crate) fn valid_account_id(value: &str) -> bool {
    value.len() == 66
        && value.starts_with("0x")
        && value[2..].bytes().all(|byte| byte.is_ascii_hexdigit())
}

/// Accepts the formats the SDK accepts for an Ed25519 delegate key: 32 bytes of
/// hex (optionally `0x`-prefixed) or a `suiprivkey1…` bech32 string.
pub(crate) fn valid_delegate_key(value: &str) -> bool {
    let hex = value.strip_prefix("0x").unwrap_or(value);
    (hex.len() == 64 && hex.bytes().all(|byte| byte.is_ascii_hexdigit()))
        || (value.starts_with("suiprivkey1")
            && value.len() > 40
            && value.bytes().all(|byte| byte.is_ascii_alphanumeric()))
}

fn valid_namespace(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 96
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-_./:".contains(&byte))
}

pub async fn session(State(state): State<AppState>, jar: CookieJar) -> Response {
    let user_id = match optional_authenticated_user_id(&state, &jar).await {
        Ok(user_id) => user_id,
        Err(_) => {
            return json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "backend_error",
                "The workspace session could not be read.",
            );
        }
    };
    let address = match user_id {
        Some(user_id) => match wallet_address(&state, user_id).await {
            Ok(address) => address,
            Err(_) => {
                return json_error(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "backend_error",
                    "The workspace session could not be read.",
                );
            }
        },
        None => None,
    };
    match walrus_status(&state, user_id).await {
        Ok(walrus) => Json(MemorySession {
            signed_in: user_id.is_some(),
            address,
            walrus,
        })
        .into_response(),
        Err(_) => json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "backend_error",
            "Walrus Memory status could not be read from the database.",
        ),
    }
}

pub async fn save(
    State(state): State<AppState>,
    jar: CookieJar,
    Json(payload): Json<SaveWalrus>,
) -> Response {
    let user_id = match optional_authenticated_user_id(&state, &jar).await {
        Ok(Some(user_id)) => user_id,
        Ok(None) => {
            return json_error(
                StatusCode::UNAUTHORIZED,
                "unauthorized",
                "Sign in to the workspace first.",
            );
        }
        Err(_) => {
            return json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "backend_error",
                "The workspace session could not be read.",
            );
        }
    };
    let account_id = payload.account_id.trim().to_ascii_lowercase();
    if !valid_account_id(&account_id) {
        return json_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_account_id",
            "The account ID must be a 0x-prefixed, 64-character hexadecimal Sui object ID.",
        );
    }
    let network = payload
        .network
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(REQUIRED_NETWORK);
    if network != REQUIRED_NETWORK {
        return json_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "wrong_network",
            "Only Walrus Memory Mainnet is supported.",
        );
    }
    let server_url = payload
        .server_url
        .as_deref()
        .map(|value| value.trim().trim_end_matches('/'))
        .filter(|value| !value.is_empty())
        .unwrap_or(DEFAULT_SERVER)
        .to_owned();
    if !allowed_relayers().contains(&server_url) {
        return json_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "relayer_not_allowed",
            "That relayer is not on this workspace's allowlist. The delegate key is only sent to an approved Mainnet relayer.",
        );
    }
    let namespace = payload
        .namespace
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(DEFAULT_NAMESPACE)
        .to_owned();
    if !valid_namespace(&namespace) {
        return json_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_namespace",
            "Use letters, numbers and - _ . / : in the namespace (96 characters at most).",
        );
    }
    let new_key = payload
        .delegate_key
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned);
    let key = match new_key {
        Some(key) => {
            if !valid_delegate_key(&key) {
                return json_error(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "invalid_delegate_key",
                    "The delegate key must be a 64-character hexadecimal Ed25519 private key or a suiprivkey1 string. Never paste an owner wallet key.",
                );
            }
            key
        }
        None => match load_settings(&state, user_id).await {
            Ok(Some(existing)) => existing.key,
            Ok(None) => {
                return json_error(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "missing_delegate_key",
                    "Enter the delegate key.",
                );
            }
            Err(_) => {
                return json_error(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "backend_error",
                    "The stored key could not be read.",
                );
            }
        },
    };
    let settings = StoredWalrus {
        account_id: account_id.clone(),
        server_url: server_url.clone(),
        namespace: namespace.clone(),
        key,
        status: "key_stored".to_owned(),
        last_error: None,
    };
    let verified = run_sdk(&settings, "verify", json!({}), Duration::from_secs(30)).await;
    let (status, error_code, last_error, owner) = match &verified {
        Ok(value) => (
            "verified",
            None,
            None,
            value["ownerAddress"].as_str().map(str::to_owned),
        ),
        Err(error) => (
            "requires_reconnect",
            Some(error.code.clone()),
            Some(error.message.clone()),
            None,
        ),
    };
    let (ciphertext, nonce) =
        match encrypt_secret(&state.config.credential_encryption_key, &settings.key) {
            Ok(value) => value,
            Err(_) => {
                return json_error(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "backend_error",
                    "The delegate key could not be encrypted.",
                );
            }
        };
    let stored = sqlx::query(
        "INSERT INTO storage_connections
            (id, user_id, provider, account_id, server_url, namespace, key_ciphertext, key_nonce, status,
             last_verified_at, last_error, last_error_code, network, owner_address)
         VALUES ($1, $2, 'walrus_memory', $3, $4, $5, $6, $7, $8,
             CASE WHEN $8 = 'verified' THEN NOW() ELSE NULL END, $9, $10, 'mainnet', $11)
         ON CONFLICT (user_id, provider) DO UPDATE
         SET account_id = EXCLUDED.account_id,
             server_url = EXCLUDED.server_url,
             namespace = EXCLUDED.namespace,
             key_ciphertext = EXCLUDED.key_ciphertext,
             key_nonce = EXCLUDED.key_nonce,
             status = EXCLUDED.status,
             last_verified_at = CASE WHEN EXCLUDED.status = 'verified' THEN NOW() ELSE storage_connections.last_verified_at END,
             last_error = EXCLUDED.last_error,
             last_error_code = EXCLUDED.last_error_code,
             network = 'mainnet',
             owner_address = EXCLUDED.owner_address,
             updated_at = NOW()",
    )
    .bind(Uuid::new_v4())
    .bind(user_id)
    .bind(&account_id)
    .bind(&server_url)
    .bind(&namespace)
    .bind(ciphertext)
    .bind(nonce)
    .bind(status)
    .bind(&last_error)
    .bind(&error_code)
    .bind(&owner)
    .execute(&state.pool)
    .await;
    if stored.is_err() {
        return json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "backend_error",
            "Walrus Memory settings could not be saved.",
        );
    }
    match walrus_status(&state, Some(user_id)).await {
        Ok(status) => Json(status).into_response(),
        Err(_) => json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "backend_error",
            "Walrus Memory status could not be read.",
        ),
    }
}

pub async fn clear(
    State(state): State<AppState>,
    jar: CookieJar,
) -> Result<Json<WalrusStatus>, ApiError> {
    let Some(user_id) = optional_authenticated_user_id(&state, &jar).await? else {
        return Err(ApiError::Unauthorized);
    };
    sqlx::query(
        "DELETE FROM storage_connections WHERE user_id = $1 AND provider = 'walrus_memory'",
    )
    .bind(user_id)
    .execute(&state.pool)
    .await
    .map_err(|_| ApiError::Internal)?;
    Ok(Json(walrus_status(&state, Some(user_id)).await?))
}

/// Recalls with the caller's own query. There is no fixed fallback question.
pub async fn recall(
    State(state): State<AppState>,
    jar: CookieJar,
    Json(payload): Json<RecallQuery>,
) -> Result<(StatusCode, Json<MemoryRecall>), ApiError> {
    let Some(user_id) = optional_authenticated_user_id(&state, &jar).await? else {
        return Err(ApiError::Unauthorized);
    };
    let address = wallet_address(&state, user_id).await?.unwrap_or_default();
    let Some(query) = payload
        .query
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Err(ApiError::Validation(
            "Recall needs the user's question as its query.",
        ));
    };
    let Some(settings) = load_settings(&state, user_id).await? else {
        return Ok((
            StatusCode::OK,
            Json(MemoryRecall {
                address,
                status: "not_connected".to_owned(),
                detail: "Walrus Memory is not connected for this user.".to_owned(),
                memories: Vec::new(),
            }),
        ));
    };
    if settings.status != "verified" {
        return Ok((
            StatusCode::OK,
            Json(MemoryRecall {
                address,
                status: "requires_reconnect".to_owned(),
                detail: settings
                    .last_error
                    .unwrap_or_else(|| "The delegate key is stored but not verified.".to_owned()),
                memories: Vec::new(),
            }),
        ));
    }
    match sdk_recall(&settings, query, 8).await {
        Ok(hits) => Ok((
            StatusCode::OK,
            Json(MemoryRecall {
                address,
                status: "recalled".to_owned(),
                detail: format!("Recalled {} memories.", hits.len()),
                memories: hits
                    .into_iter()
                    .map(|hit| MemoryHit {
                        text: hit.text,
                        blob_id: hit.blob_id,
                    })
                    .collect(),
            }),
        )),
        Err(error) => Ok((
            StatusCode::BAD_GATEWAY,
            Json(MemoryRecall {
                address,
                status: error.code,
                detail: error.message,
                memories: Vec::new(),
            }),
        )),
    }
}

#[derive(Debug, Deserialize)]
pub struct RememberBody {
    pub text: String,
}

#[derive(Debug, Serialize)]
pub struct SaveAttempt {
    pub status: String,
    pub detail: String,
}

/// Legacy single-fact save used by the example discovery flow. It reports
/// `saved` only after the relayer job reaches `done` with a blob ID.
pub async fn remember(
    State(state): State<AppState>,
    jar: CookieJar,
    Json(body): Json<RememberBody>,
) -> Result<Json<SaveAttempt>, ApiError> {
    let Some(user_id) = optional_authenticated_user_id(&state, &jar).await? else {
        return Ok(Json(SaveAttempt {
            status: "failed".into(),
            detail: "Sign in before saving a finding.".into(),
        }));
    };
    let text = body.text.trim();
    if text.is_empty() {
        return Ok(Json(SaveAttempt {
            status: "failed".into(),
            detail: "Nothing was approved to save.".into(),
        }));
    }
    let Some(settings) = load_settings(&state, user_id).await? else {
        return Ok(Json(SaveAttempt {
            status: "failed".into(),
            detail: "Walrus Memory is not connected. No fact was written.".into(),
        }));
    };
    if settings.status != "verified" {
        return Ok(Json(SaveAttempt {
            status: "failed".into(),
            detail: "Walrus Memory needs reconnect. No fact was written.".into(),
        }));
    }
    let key = Uuid::new_v4().to_string();
    let job = match sdk_remember_submit(&settings, text, &key).await {
        Ok(job) => job,
        Err(error) => {
            return Ok(Json(SaveAttempt {
                status: "failed".into(),
                detail: error.message,
            }));
        }
    };
    for _ in 0..40 {
        tokio::time::sleep(Duration::from_millis(1500)).await;
        if let Ok(jobs) = sdk_remember_status(&settings, std::slice::from_ref(&job)).await
            && let Some(current) = jobs.first()
        {
            match current.status.as_str() {
                "done" if current.blob_id.is_some() => {
                    return Ok(Json(SaveAttempt {
                        status: "saved".into(),
                        detail: format!(
                            "Stored on Walrus Mainnet as blob {}.",
                            current.blob_id.clone().unwrap_or_default()
                        ),
                    }));
                }
                "failed" | "not_found" => {
                    return Ok(Json(SaveAttempt {
                        status: "failed".into(),
                        detail: current
                            .error
                            .clone()
                            .unwrap_or_else(|| "The relayer reported the write as failed.".into()),
                    }));
                }
                _ => {}
            }
        }
    }
    Ok(Json(SaveAttempt {
        status: "pending".into(),
        detail: format!("Accepted as job {job}, but storage completion was not confirmed yet."),
    }))
}

pub async fn console_report() -> Json<SaveAttempt> {
    Json(SaveAttempt {
        status: "failed".into(),
        detail: "Walrus Console is not connected. No report was uploaded.".into(),
    })
}

/// Authoritative counts reported by the relayer for this user's account.
pub async fn stats(State(state): State<AppState>, jar: CookieJar) -> Response {
    let user_id = match optional_authenticated_user_id(&state, &jar).await {
        Ok(Some(user_id)) => user_id,
        Ok(None) => {
            return json_error(
                StatusCode::UNAUTHORIZED,
                "unauthorized",
                "Sign in to the workspace first.",
            );
        }
        Err(_) => {
            return json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "backend_error",
                "The workspace session could not be read.",
            );
        }
    };
    let settings = match load_settings(&state, user_id).await {
        Ok(Some(settings)) if settings.status == "verified" => settings,
        Ok(_) => {
            return json_error(
                StatusCode::CONFLICT,
                "memory_not_ready",
                "Walrus Memory is not verified for this user.",
            );
        }
        Err(_) => {
            return json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "backend_error",
                "The stored key could not be read.",
            );
        }
    };
    match run_sdk(&settings, "stats", json!({}), Duration::from_secs(180)).await {
        Ok(value) => Json(json!({
            "sources": {
                "namespaces": "Walrus Memory relayer listNamespaces (memory_count per namespace, relayer index)",
                "on_chain": "Sui Mainnet: Walrus Blob objects owned by the account owner, filtered by memwal_package_id and memwal_agent_id metadata",
            },
            "network": value["network"],
            "package_id": value["packageId"],
            "owner_address": value["ownerAddress"],
            "agent_public_key": value["agentPublicKey"],
            "namespaces": value["namespaces"],
            "on_chain": value["onChain"],
            "on_chain_error": value["onChainError"],
        }))
        .into_response(),
        Err(error) => json_error(StatusCode::BAD_GATEWAY, &error.code, error.message),
    }
}

pub(crate) struct RecallHit {
    pub text: String,
    pub blob_id: Option<String>,
    pub distance: Option<f64>,
    pub created_at: Option<String>,
}

pub(crate) async fn sdk_recall(
    settings: &StoredWalrus,
    query: &str,
    limit: u32,
) -> Result<Vec<RecallHit>, SdkError> {
    let value = run_sdk(
        settings,
        "recall",
        json!({ "query": query, "limit": limit }),
        Duration::from_secs(25),
    )
    .await?;
    Ok(value["memories"]
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    Some(RecallHit {
                        text: item["text"].as_str()?.to_owned(),
                        blob_id: item["blobId"].as_str().map(str::to_owned),
                        distance: item["distance"].as_f64(),
                        created_at: item["createdAt"].as_str().map(str::to_owned),
                    })
                })
                .collect()
        })
        .unwrap_or_default())
}

pub(crate) async fn sdk_remember_submit(
    settings: &StoredWalrus,
    text: &str,
    idempotency_key: &str,
) -> Result<String, SdkError> {
    let value = run_sdk(
        settings,
        "remember_submit",
        json!({ "text": text, "idempotencyKey": idempotency_key }),
        Duration::from_secs(35),
    )
    .await?;
    value["jobId"].as_str().map(str::to_owned).ok_or_else(|| {
        SdkError::new(
            "relayer_error",
            "The relayer accepted the write without a job ID.",
        )
    })
}

pub(crate) struct JobStatus {
    pub job_id: String,
    pub status: String,
    pub blob_id: Option<String>,
    pub error: Option<String>,
}

pub(crate) async fn sdk_remember_status(
    settings: &StoredWalrus,
    job_ids: &[String],
) -> Result<Vec<JobStatus>, SdkError> {
    let value = run_sdk(
        settings,
        "remember_status",
        json!({ "jobIds": job_ids }),
        Duration::from_secs(30),
    )
    .await?;
    Ok(value["jobs"]
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    Some(JobStatus {
                        job_id: item["jobId"].as_str()?.to_owned(),
                        status: item["status"].as_str().unwrap_or("unknown").to_owned(),
                        blob_id: item["blobId"].as_str().map(str::to_owned),
                        error: item["error"].as_str().map(str::to_owned),
                    })
                })
                .collect()
        })
        .unwrap_or_default())
}

async fn walrus_status(state: &AppState, user_id: Option<Uuid>) -> Result<WalrusStatus, ApiError> {
    let Some(user_id) = user_id else {
        return Ok(empty_status("signed_out"));
    };
    let row = sqlx::query_as::<_, (String, String, String, String, Option<String>, Option<String>, String, Option<chrono::DateTime<chrono::Utc>>)>(
        "SELECT account_id, server_url, namespace, status, last_error, last_error_code, network, last_verified_at
         FROM storage_connections WHERE user_id = $1 AND provider = 'walrus_memory'",
    )
    .bind(user_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ApiError::Internal)?;
    Ok(match row {
        Some((
            account_id,
            server_url,
            namespace,
            status,
            last_error,
            last_error_code,
            network,
            last_verified_at,
        )) => WalrusStatus {
            configured: status == "verified",
            status,
            account_id: Some(account_id),
            namespace,
            server_url,
            network,
            last_error,
            last_error_code,
            last_verified_at,
        },
        None => empty_status("not_connected"),
    })
}

fn empty_status(status: &str) -> WalrusStatus {
    WalrusStatus {
        configured: false,
        status: status.to_owned(),
        account_id: None,
        namespace: DEFAULT_NAMESPACE.to_owned(),
        server_url: DEFAULT_SERVER.to_owned(),
        network: REQUIRED_NETWORK.to_owned(),
        last_error: None,
        last_error_code: None,
        last_verified_at: None,
    }
}

pub(crate) async fn load_settings(
    state: &AppState,
    user_id: Uuid,
) -> Result<Option<StoredWalrus>, ApiError> {
    let Some((account_id, server_url, namespace, ciphertext, nonce, status, last_error)) =
        sqlx::query_as::<_, (String, String, String, Vec<u8>, Vec<u8>, String, Option<String>)>(
            "SELECT account_id, server_url, namespace, key_ciphertext, key_nonce, status, last_error
             FROM storage_connections WHERE user_id = $1 AND provider = 'walrus_memory'",
        )
        .bind(user_id)
        .fetch_optional(&state.pool)
        .await
        .map_err(|_| ApiError::Internal)?
    else {
        return Ok(None);
    };
    let key = decrypt_secret(&state.config.credential_encryption_key, &ciphertext, &nonce)?;
    Ok(Some(StoredWalrus {
        account_id,
        server_url,
        namespace,
        key,
        status,
        last_error,
    }))
}

fn sdk_script() -> PathBuf {
    if let Ok(path) = std::env::var("MEMWAL_SDK_SCRIPT") {
        return PathBuf::from(path);
    }
    let installed = PathBuf::from("/app/scripts/memwal/recall.mjs");
    if installed.exists() {
        return installed;
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("scripts/memwal/recall.mjs")
}

/// Runs one Walrus Memory SDK action. The delegate key travels on stdin only.
pub(crate) async fn run_sdk(
    settings: &StoredWalrus,
    action: &str,
    extra: Value,
    limit: Duration,
) -> Result<Value, SdkError> {
    let script = sdk_script();
    let mut child = Command::new("node")
        .arg(&script)
        .current_dir(script.parent().unwrap_or(script.as_path()))
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|_| {
            SdkError::new(
                "sdk_unavailable",
                "The backend could not start the Walrus Memory SDK (Node.js is required).",
            )
        })?;
    let mut payload = json!({
        "key": settings.key,
        "accountId": settings.account_id,
        "serverUrl": settings.server_url,
        "namespace": settings.namespace,
        "action": action,
    });
    if let (Some(target), Some(source)) = (payload.as_object_mut(), extra.as_object()) {
        for (key, value) in source {
            target.insert(key.clone(), value.clone());
        }
    }
    let mut stdin = child.stdin.take().ok_or_else(|| {
        SdkError::new(
            "sdk_unavailable",
            "The Walrus Memory SDK input was not available.",
        )
    })?;
    stdin
        .write_all(payload.to_string().as_bytes())
        .await
        .map_err(|_| {
            SdkError::new(
                "sdk_unavailable",
                "The request could not be passed to the Walrus Memory SDK.",
            )
        })?;
    drop(stdin);
    drop(payload);
    let output = timeout(limit, child.wait_with_output())
        .await
        .map_err(|_| {
            SdkError::new(
                "relayer_unavailable",
                format!(
                    "Walrus Memory did not answer within {} seconds.",
                    limit.as_secs()
                ),
            )
        })?
        .map_err(|_| SdkError::new("sdk_unavailable", "The Walrus Memory SDK process failed."))?;
    let value: Value = serde_json::from_slice(&output.stdout).map_err(|_| {
        SdkError::new(
            "sdk_unavailable",
            "The Walrus Memory SDK returned an unreadable result.",
        )
    })?;
    if value["ok"].as_bool() == Some(true) {
        Ok(value)
    } else {
        Err(SdkError::new(
            value["code"].as_str().unwrap_or("relayer_error"),
            value["message"]
                .as_str()
                .unwrap_or("The Walrus Memory request failed.")
                .to_owned(),
        ))
    }
}

async fn wallet_address(state: &AppState, user_id: Uuid) -> Result<Option<String>, ApiError> {
    let address =
        sqlx::query_scalar::<_, Option<String>>("SELECT sui_address FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_one(&state.pool)
            .await
            .map_err(|_| ApiError::Internal)?;
    Ok(address.filter(|value| !value.is_empty()))
}

pub(crate) fn encrypt_secret(key: &[u8; 32], secret: &str) -> Result<(Vec<u8>, Vec<u8>), ApiError> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| ApiError::Internal)?;
    let mut nonce_bytes = [0_u8; 12];
    rand::RngCore::fill_bytes(&mut rand::rngs::OsRng, &mut nonce_bytes);
    let ciphertext = cipher
        .encrypt(Nonce::from_slice(&nonce_bytes), secret.as_bytes())
        .map_err(|_| ApiError::Internal)?;
    Ok((ciphertext, nonce_bytes.to_vec()))
}

pub(crate) fn decrypt_secret(
    key: &[u8; 32],
    ciphertext: &[u8],
    nonce: &[u8],
) -> Result<String, ApiError> {
    if nonce.len() != 12 {
        return Err(ApiError::Internal);
    }
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| ApiError::Internal)?;
    let plaintext = cipher
        .decrypt(Nonce::from_slice(nonce), ciphertext)
        .map_err(|_| ApiError::Internal)?;
    String::from_utf8(plaintext).map_err(|_| ApiError::Internal)
}

#[cfg(test)]
mod tests {
    use super::{
        allowed_relayers, decrypt_secret, encrypt_secret, valid_account_id, valid_delegate_key,
        valid_namespace,
    };

    #[test]
    fn account_ids_must_be_full_sui_object_ids() {
        assert!(valid_account_id(&format!("0x{}", "a".repeat(64))));
        assert!(!valid_account_id("0x1234"));
        assert!(!valid_account_id(&"a".repeat(66)));
        assert!(!valid_account_id(&format!("0x{}", "g".repeat(64))));
    }

    #[test]
    fn delegate_keys_accept_hex_and_bech32_only() {
        assert!(valid_delegate_key(&"0".repeat(64)));
        assert!(valid_delegate_key(&format!("0x{}", "f".repeat(64))));
        assert!(valid_delegate_key(&format!(
            "suiprivkey1{}",
            "q".repeat(50)
        )));
        assert!(!valid_delegate_key("short"));
        assert!(!valid_delegate_key(&"z".repeat(64)));
    }

    #[test]
    fn namespaces_are_restricted() {
        assert!(valid_namespace("bew-harness/product-discovery"));
        assert!(!valid_namespace(""));
        assert!(!valid_namespace("has space"));
    }

    #[test]
    fn delegate_keys_are_never_sent_to_unlisted_relayers() {
        let allowed = allowed_relayers();
        assert!(allowed.contains(&"https://relayer.memory.walrus.xyz".to_owned()));
        assert!(!allowed.contains(&"https://evil.example".to_owned()));
    }

    #[test]
    fn secrets_round_trip_through_aes_gcm() {
        let key = [9_u8; 32];
        let (ciphertext, nonce) = encrypt_secret(&key, "delegate").unwrap();
        assert!(!ciphertext.windows(8).any(|window| window == b"delegate"));
        assert_eq!(
            decrypt_secret(&key, &ciphertext, &nonce).unwrap(),
            "delegate"
        );
    }
}
