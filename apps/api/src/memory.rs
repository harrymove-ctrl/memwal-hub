use std::{path::PathBuf, time::Duration};

use aes_gcm::{Aes256Gcm, KeyInit, Nonce, aead::Aead};
use axum::{Json, extract::State, http::StatusCode};
use axum_extra::extract::CookieJar;
use serde::{Deserialize, Serialize};
use tokio::{io::AsyncWriteExt, process::Command, time::timeout};
use uuid::Uuid;

use crate::{AppState, auth::optional_authenticated_user_id, error::ApiError};

const DEFAULT_SERVER: &str = "https://relayer.memory.walrus.xyz";
const DEFAULT_NAMESPACE: &str = "bew-harness/product-discovery";

#[derive(Debug, Serialize)]
pub struct MemorySession {
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
    pub last_error: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SaveWalrus {
    pub account_id: String,
    pub delegate_key: String,
    pub namespace: Option<String>,
    pub server_url: Option<String>,
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

#[derive(Debug, Deserialize)]
struct SdkRecall {
    status: String,
    memories: Vec<SdkHit>,
    detail: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SdkHit {
    text: String,
    #[serde(rename = "blobId")]
    blob_id: Option<String>,
}

pub async fn session(
    State(state): State<AppState>,
    jar: CookieJar,
) -> Result<Json<MemorySession>, ApiError> {
    let user_id = optional_authenticated_user_id(&state, &jar).await?;
    let address = match user_id {
        Some(user_id) => wallet_address(&state, user_id).await?,
        None => None,
    };
    Ok(Json(MemorySession {
        address,
        walrus: walrus_status(&state, user_id).await?,
    }))
}

pub async fn save(
    State(state): State<AppState>,
    jar: CookieJar,
    Json(payload): Json<SaveWalrus>,
) -> Result<Json<WalrusStatus>, ApiError> {
    let Some(user_id) = optional_authenticated_user_id(&state, &jar).await? else {
        return Err(ApiError::Unauthorized);
    };
    let account_id = payload.account_id.trim();
    let delegate_key = payload.delegate_key.trim();
    if account_id.is_empty() || delegate_key.is_empty() {
        return Err(ApiError::Validation(
            "Account ID and delegate key are both required.",
        ));
    }
    let server_url = payload
        .server_url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(DEFAULT_SERVER);
    let namespace = payload
        .namespace
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(DEFAULT_NAMESPACE);
    let (ciphertext, nonce) = encrypt_secret(&state.config.credential_encryption_key, delegate_key)?;
    sqlx::query(
        "INSERT INTO storage_connections
            (id, user_id, provider, account_id, server_url, namespace, key_ciphertext, key_nonce, status)
         VALUES ($1, $2, 'walrus_memory', $3, $4, $5, $6, $7, 'key_stored')
         ON CONFLICT (user_id, provider) DO UPDATE
         SET account_id = EXCLUDED.account_id,
             server_url = EXCLUDED.server_url,
             namespace = EXCLUDED.namespace,
             key_ciphertext = EXCLUDED.key_ciphertext,
             key_nonce = EXCLUDED.key_nonce,
             status = 'key_stored',
             last_error = NULL,
             updated_at = NOW()",
    )
    .bind(Uuid::new_v4())
    .bind(user_id)
    .bind(account_id)
    .bind(server_url)
    .bind(namespace)
    .bind(ciphertext)
    .bind(nonce)
    .execute(&state.pool)
    .await
    .map_err(|_| ApiError::Internal)?;
    let settings = load_settings(&state, user_id).await?.expect("connection was just saved");
    let verified = run_sdk(&settings, "hub connection check", "verify").await;
    let (status, last_error) = match verified {
        Ok(_) => ("verified", None),
        Err(error) => ("requires_reconnect", Some(error)),
    };
    sqlx::query(
        "UPDATE storage_connections
         SET status = $2,
             last_verified_at = CASE WHEN $2 = 'verified' THEN NOW() ELSE last_verified_at END,
             last_error = $3,
             updated_at = NOW()
         WHERE user_id = $1 AND provider = 'walrus_memory'",
    )
    .bind(user_id)
    .bind(status)
    .bind(&last_error)
    .execute(&state.pool)
    .await
    .map_err(|_| ApiError::Internal)?;
    Ok(Json(walrus_status(&state, Some(user_id)).await?))
}

pub async fn clear(
    State(state): State<AppState>,
    jar: CookieJar,
) -> Result<Json<WalrusStatus>, ApiError> {
    let Some(user_id) = optional_authenticated_user_id(&state, &jar).await? else {
        return Err(ApiError::Unauthorized);
    };
    sqlx::query("DELETE FROM storage_connections WHERE user_id = $1 AND provider = 'walrus_memory'")
        .bind(user_id)
        .execute(&state.pool)
        .await
        .map_err(|_| ApiError::Internal)?;
    Ok(Json(walrus_status(&state, Some(user_id)).await?))
}

pub async fn recall(
    State(state): State<AppState>,
    jar: CookieJar,
) -> Result<(StatusCode, Json<MemoryRecall>), ApiError> {
    let Some(user_id) = optional_authenticated_user_id(&state, &jar).await? else {
        return Err(ApiError::Unauthorized);
    };
    let Some(address) = wallet_address(&state, user_id).await? else {
        return Ok((
            StatusCode::OK,
            Json(MemoryRecall {
                address: String::new(),
                status: "no_wallet".to_owned(),
                detail: "This session has no wallet address. Sign in with the address that owns the memory.".to_owned(),
                memories: Vec::new(),
            }),
        ));
    };
    let Some(settings) = load_settings(&state, user_id).await? else {
        return Ok((
            StatusCode::OK,
            Json(MemoryRecall {
                address,
                status: "unavailable".to_owned(),
                detail: "Walrus is not registered for this user. No blob was invented.".to_owned(),
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
                detail: settings.last_error.unwrap_or_else(|| "Delegate key is stored but not verified. Save it again to retry. No blob was invented.".to_owned()),
                memories: Vec::new(),
            }),
        ));
    }
    match run_sdk(&settings, &format!("What should {address} remember from earlier sessions?"), "recall").await {
        Ok(mut recall) => {
            recall.address = address;
            Ok((StatusCode::OK, Json(recall)))
        }
        Err(detail) => Ok((
            StatusCode::OK,
            Json(MemoryRecall {
                address,
                status: "error".to_owned(),
                detail,
                memories: Vec::new(),
            }),
        )),
    }
}

async fn walrus_status(state: &AppState, user_id: Option<Uuid>) -> Result<WalrusStatus, ApiError> {
    let Some(user_id) = user_id else {
        return Ok(empty_status());
    };
    let row = sqlx::query_as::<_, (String, String, String, String, Option<String>)>(
        "SELECT account_id, server_url, namespace, status, last_error
         FROM storage_connections WHERE user_id = $1 AND provider = 'walrus_memory'",
    )
    .bind(user_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ApiError::Internal)?;
    Ok(match row {
        Some((account_id, server_url, namespace, status, last_error)) => WalrusStatus {
            configured: status == "verified",
            status,
            account_id: Some(account_id),
            namespace,
            server_url,
            last_error,
        },
        None => empty_status(),
    })
}

fn empty_status() -> WalrusStatus {
    WalrusStatus {
        configured: false,
        status: "unavailable".to_owned(),
        account_id: None,
        namespace: DEFAULT_NAMESPACE.to_owned(),
        server_url: DEFAULT_SERVER.to_owned(),
        last_error: None,
    }
}

struct StoredWalrus {
    account_id: String,
    server_url: String,
    namespace: String,
    key: String,
    status: String,
    last_error: Option<String>,
}

async fn load_settings(state: &AppState, user_id: Uuid) -> Result<Option<StoredWalrus>, ApiError> {
    let Some((account_id, server_url, namespace, ciphertext, nonce, status, last_error)) = sqlx::query_as::<_, (String, String, String, Vec<u8>, Vec<u8>, String, Option<String>)>(
        "SELECT account_id, server_url, namespace, key_ciphertext, key_nonce, status, last_error
         FROM storage_connections WHERE user_id = $1 AND provider = 'walrus_memory'",
    )
    .bind(user_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ApiError::Internal)? else {
        return Ok(None);
    };
    let key = decrypt_secret(&state.config.credential_encryption_key, &ciphertext, &nonce)?;
    Ok(Some(StoredWalrus { account_id, server_url, namespace, key, status, last_error }))
}


async fn run_sdk(settings: &StoredWalrus, query: &str, action: &str) -> Result<MemoryRecall, String> {
    let script = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("scripts/memwal/recall.mjs");
    let mut child = Command::new("node")
        .arg(&script)
        .current_dir(script.parent().unwrap_or(script.as_path()))
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|error| format!("Could not start the MemWal SDK: {error}"))?;
    let payload = serde_json::json!({
        "key": settings.key,
        "accountId": settings.account_id,
        "serverUrl": settings.server_url,
        "namespace": settings.namespace,
        "query": query,
        "action": action,
    });
    let mut stdin = child.stdin.take().ok_or("MemWal SDK stdin was not available.")?;
    stdin
        .write_all(payload.to_string().as_bytes())
        .await
        .map_err(|error| format!("Could not pass the recall to the SDK: {error}"))?;
    drop(stdin);
    let output = timeout(Duration::from_secs(20), child.wait_with_output())
        .await
        .map_err(|_| "Walrus recall timed out after 20s.".to_owned())?
        .map_err(|error| format!("MemWal SDK failed: {error}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let trimmed = stderr.trim();
        return Err(if trimmed.is_empty() {
            format!("MemWal SDK exited with {}.", output.status)
        } else {
            trimmed.chars().take(500).collect()
        });
    }
    let parsed: SdkRecall = serde_json::from_slice(&output.stdout)
        .map_err(|_| "MemWal SDK returned an unreadable result.".to_owned())?;
    let detail = if parsed.memories.is_empty() {
        "Recall finished. This address has no stored memories yet.".to_owned()
    } else {
        format!("Recalled {} memor{}.", parsed.memories.len(), if parsed.memories.len() == 1 { "y" } else { "ies" })
    };
    Ok(MemoryRecall {
        address: String::new(),
        status: parsed.status,
        detail: parsed.detail.unwrap_or(detail),
        memories: parsed
            .memories
            .into_iter()
            .map(|hit| MemoryHit {
                text: hit.text,
                blob_id: hit.blob_id,
            })
            .collect(),
    })
}

async fn wallet_address(state: &AppState, user_id: Uuid) -> Result<Option<String>, ApiError> {
    let address = sqlx::query_scalar::<_, Option<String>>("SELECT sui_address FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_one(&state.pool)
        .await
        .map_err(|_| ApiError::Internal)?;
    Ok(address.filter(|value| !value.is_empty()))
}

fn encrypt_secret(key: &[u8; 32], secret: &str) -> Result<(Vec<u8>, Vec<u8>), ApiError> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| ApiError::Internal)?;
    let mut nonce_bytes = [0_u8; 12];
    rand::RngCore::fill_bytes(&mut rand::rngs::OsRng, &mut nonce_bytes);
    let ciphertext = cipher
        .encrypt(Nonce::from_slice(&nonce_bytes), secret.as_bytes())
        .map_err(|_| ApiError::Internal)?;
    Ok((ciphertext, nonce_bytes.to_vec()))
}

fn decrypt_secret(key: &[u8; 32], ciphertext: &[u8], nonce: &[u8]) -> Result<String, ApiError> {
    if nonce.len() != 12 {
        return Err(ApiError::Internal);
    }
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| ApiError::Internal)?;
    let plaintext = cipher
        .decrypt(Nonce::from_slice(nonce), ciphertext)
        .map_err(|_| ApiError::Internal)?;
    String::from_utf8(plaintext).map_err(|_| ApiError::Internal)
}
