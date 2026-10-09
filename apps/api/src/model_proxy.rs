//! User-scoped OpenAI-compatible model proxy (for example ZRouter).
//!
//! The browser never sees the proxy key: it is AES-256-GCM encrypted at rest,
//! every model call is made here, and routes only ever return redacted
//! metadata. Destinations are validated before any request carries the key,
//! and redirects are never followed, so the key cannot be forwarded elsewhere.

use std::{net::IpAddr, sync::OnceLock, time::Duration};

use axum::{
    Json,
    extract::State,
    http::{HeaderMap, StatusCode, header::ORIGIN},
    response::{IntoResponse, Response},
};
use axum_extra::extract::CookieJar;
use reqwest::{Client, Url, header::ACCEPT, redirect::Policy};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use uuid::Uuid;

use crate::{
    AppState,
    auth::optional_authenticated_user_id,
    memory::{decrypt_secret, encrypt_secret, json_error},
};

pub(crate) const DEFAULT_MAX_OUTPUT_TOKENS: i32 = 2048;
/// The test connection asks for a one-word answer with a hard output cap.
pub(crate) const TEST_MAX_OUTPUT_TOKENS: u32 = 32;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ProxyErrorCode {
    InvalidKey,
    ModelUnavailable,
    WrongEndpoint,
    RateLimited,
    Timeout,
    ProxyUnavailable,
    InvalidDestination,
    InvalidRequest,
}

impl ProxyErrorCode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::InvalidKey => "invalid_key",
            Self::ModelUnavailable => "model_unavailable",
            Self::WrongEndpoint => "wrong_endpoint",
            Self::RateLimited => "rate_limited",
            Self::Timeout => "timeout",
            Self::ProxyUnavailable => "proxy_unavailable",
            Self::InvalidDestination => "invalid_destination",
            Self::InvalidRequest => "invalid_request",
        }
    }

    pub fn message(self) -> &'static str {
        match self {
            Self::InvalidKey => "The proxy rejected the API key.",
            Self::ModelUnavailable => {
                "The proxy does not offer this model ID, or it is unavailable right now."
            }
            Self::WrongEndpoint => {
                "This URL did not answer like an OpenAI-compatible Chat Completions endpoint. Check the API base URL."
            }
            Self::RateLimited => "The proxy is rate limiting this key or its quota is exhausted.",
            Self::Timeout => "The proxy did not answer in time.",
            Self::ProxyUnavailable => "The proxy is unavailable.",
            Self::InvalidDestination => "This destination is not allowed.",
            Self::InvalidRequest => "The proxy rejected the request.",
        }
    }
}

#[derive(Debug, Clone)]
pub struct ProxyError {
    pub code: ProxyErrorCode,
    pub detail: Option<String>,
}

impl ProxyError {
    pub fn new(code: ProxyErrorCode) -> Self {
        Self { code, detail: None }
    }

    pub fn with_detail(code: ProxyErrorCode, detail: impl Into<String>) -> Self {
        Self {
            code,
            detail: Some(detail.into()),
        }
    }

    pub fn message(&self) -> String {
        match &self.detail {
            Some(detail) => format!("{} {}", self.code.message(), detail),
            None => self.code.message().to_owned(),
        }
    }
}

/// `MODEL_PROXY_ALLOW_LOCAL_HTTP=true` is the explicit local-development
/// exception: it permits `http://localhost`, `127.0.0.1` and `[::1]` only.
pub fn allow_local_http() -> bool {
    std::env::var("MODEL_PROXY_ALLOW_LOCAL_HTTP")
        .map(|value| value.eq_ignore_ascii_case("true") || value == "1")
        .unwrap_or(false)
}

fn bare_host(host: &str) -> &str {
    host.trim_start_matches('[').trim_end_matches(']')
}

fn is_loopback_host(host: &str) -> bool {
    let bare = bare_host(host);
    bare == "localhost"
        || bare
            .parse::<IpAddr>()
            .map(|ip| ip.is_loopback())
            .unwrap_or(false)
}

/// Internal, link-local (including 169.254.169.254 metadata), private,
/// carrier-grade NAT and reserved addresses are never valid destinations.
/// Loopback is allowed only under the local-development exception.
pub fn blocked_ip(ip: IpAddr, allow_local: bool) -> bool {
    if ip.is_loopback() {
        return !allow_local;
    }
    match ip {
        IpAddr::V4(v4) => {
            let octets = v4.octets();
            v4.is_private()
                || v4.is_link_local()
                || v4.is_unspecified()
                || v4.is_broadcast()
                || v4.is_multicast()
                || v4.is_documentation()
                || octets[0] == 0
                || (octets[0] == 100 && (octets[1] & 0xc0) == 64)
                || (octets[0] == 192 && octets[1] == 0 && octets[2] == 0)
                || (octets[0] == 198 && (octets[1] & 0xfe) == 18)
                || octets[0] >= 240
        }
        IpAddr::V6(v6) => {
            if let Some(v4) = v6.to_ipv4_mapped() {
                return blocked_ip(IpAddr::V4(v4), allow_local);
            }
            let segments = v6.segments();
            v6.is_unspecified()
                || v6.is_multicast()
                || (segments[0] & 0xfe00) == 0xfc00
                || (segments[0] & 0xffc0) == 0xfe80
        }
    }
}

fn check_host_name(host: &str, allow_local: bool) -> Result<(), String> {
    let bare = bare_host(host);
    if let Ok(ip) = bare.parse::<IpAddr>() {
        if blocked_ip(ip, allow_local) {
            return Err("Internal, private and metadata addresses are not allowed.".to_owned());
        }
        return Ok(());
    }
    if bare == "localhost" {
        return if allow_local {
            Ok(())
        } else {
            Err("Local addresses need the local development exception on the backend.".to_owned())
        };
    }
    if bare == "metadata"
        || bare.ends_with(".internal")
        || bare.ends_with(".local")
        || bare.ends_with(".localhost")
        || !bare.contains('.')
    {
        return Err("Internal host names are not allowed.".to_owned());
    }
    Ok(())
}

/// Normalizes a user-entered API base URL without inventing path segments.
///
/// A pasted endpoint (`…/chat/completions`, `…/models`) is reduced to its base,
/// and a doubled `/v1/v1` collapses to one. Nothing is appended, so a base of
/// `https://api.example/openai` stays exactly that.
pub fn normalize_base_url(input: &str, allow_local: bool) -> Result<String, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("Enter the API base URL.".to_owned());
    }
    let url = Url::parse(trimmed).map_err(|_| "The API base URL is not a valid URL.".to_owned())?;
    if !url.username().is_empty() || url.password().is_some() {
        return Err(
            "Remove credentials from the URL. Put the key in the API key field.".to_owned(),
        );
    }
    if url.query().is_some() || url.fragment().is_some() {
        return Err("Remove the query string or fragment from the API base URL.".to_owned());
    }
    let host = url
        .host_str()
        .ok_or_else(|| "The API base URL needs a host.".to_owned())?
        .to_ascii_lowercase();
    match url.scheme() {
        "https" => {}
        "http" if is_loopback_host(&host) && allow_local => {}
        "http" if is_loopback_host(&host) => {
            return Err("Plain HTTP to a local address needs the local development exception (MODEL_PROXY_ALLOW_LOCAL_HTTP=true on the backend).".to_owned());
        }
        _ => return Err("Use an https:// API base URL.".to_owned()),
    }
    check_host_name(&host, allow_local)?;
    let mut path = url.path().trim_end_matches('/').to_owned();
    for suffix in ["/chat/completions", "/completions", "/responses", "/models"] {
        if let Some(stripped) = path.strip_suffix(suffix) {
            path = stripped.trim_end_matches('/').to_owned();
            break;
        }
    }
    while path.ends_with("/v1/v1") {
        path.truncate(path.len() - 3);
    }
    let port = url
        .port()
        .map(|port| format!(":{port}"))
        .unwrap_or_default();
    Ok(format!("{}://{}{}{}", url.scheme(), host, port, path))
}

/// True when both normalized base URLs point at the same scheme, host and port.
/// A stored key is only ever sent to the host it was saved for.
pub(crate) fn same_host(a: &str, b: &str) -> bool {
    match (Url::parse(a), Url::parse(b)) {
        (Ok(a), Ok(b)) => {
            a.scheme() == b.scheme()
                && a.host_str().map(str::to_ascii_lowercase)
                    == b.host_str().map(str::to_ascii_lowercase)
                && a.port_or_known_default() == b.port_or_known_default()
        }
        _ => false,
    }
}

/// Joins a normalized base and an endpoint path with exactly one slash.
pub fn endpoint(base: &str, path: &str) -> String {
    format!(
        "{}/{}",
        base.trim_end_matches('/'),
        path.trim_start_matches('/')
    )
}

/// Resolves the host and rejects it if any address is internal. This runs
/// before every keyed request so a later DNS change is caught too.
pub async fn check_resolved(base: &str, allow_local: bool) -> Result<(), ProxyError> {
    let url = Url::parse(base).map_err(|_| ProxyError::new(ProxyErrorCode::InvalidDestination))?;
    let host = url
        .host_str()
        .ok_or_else(|| ProxyError::new(ProxyErrorCode::InvalidDestination))?;
    let port = url.port_or_known_default().unwrap_or(443);
    let addresses = tokio::net::lookup_host((bare_host(host), port))
        .await
        .map_err(|_| {
            ProxyError::with_detail(
                ProxyErrorCode::ProxyUnavailable,
                "The host name could not be resolved.",
            )
        })?;
    let mut any = false;
    for address in addresses {
        any = true;
        if blocked_ip(address.ip(), allow_local) {
            return Err(ProxyError::with_detail(
                ProxyErrorCode::InvalidDestination,
                "The host resolves to an internal or private address.",
            ));
        }
    }
    if any {
        Ok(())
    } else {
        Err(ProxyError::with_detail(
            ProxyErrorCode::ProxyUnavailable,
            "The host name did not resolve.",
        ))
    }
}

pub(crate) fn proxy_http() -> &'static Client {
    static CLIENT: OnceLock<Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        Client::builder()
            .redirect(Policy::none())
            .connect_timeout(Duration::from_secs(10))
            .user_agent(concat!("hub-william/", env!("CARGO_PKG_VERSION")))
            .build()
            .expect("model proxy HTTP client should build")
    })
}

/// Maps an upstream HTTP status and body to a user-facing error class.
pub fn classify_status(status: u16, body: &str) -> ProxyErrorCode {
    let lower = body.to_ascii_lowercase();
    let mentions_model = lower.contains("model");
    let html =
        lower.trim_start().starts_with("<!doctype") || lower.trim_start().starts_with("<html");
    let model_missing = mentions_model
        && [
            "not found",
            "not_found",
            "does not exist",
            "unsupported",
            "not supported",
            "invalid model",
            "unknown model",
            "not available",
            "no available channel",
            "model_not_found",
        ]
        .iter()
        .any(|needle| lower.contains(needle));
    match status {
        300..=399 => ProxyErrorCode::WrongEndpoint,
        401 => ProxyErrorCode::InvalidKey,
        402 => ProxyErrorCode::RateLimited,
        403 if lower.contains("quota")
            || lower.contains("balance")
            || lower.contains("insufficient") =>
        {
            ProxyErrorCode::RateLimited
        }
        403 => ProxyErrorCode::InvalidKey,
        404 if model_missing && !html => ProxyErrorCode::ModelUnavailable,
        404 | 405 => ProxyErrorCode::WrongEndpoint,
        400 | 422 if model_missing => ProxyErrorCode::ModelUnavailable,
        400 | 422 => ProxyErrorCode::InvalidRequest,
        408 | 504 => ProxyErrorCode::Timeout,
        429 => ProxyErrorCode::RateLimited,
        503 if model_missing || lower.contains("channel") => ProxyErrorCode::ModelUnavailable,
        _ => ProxyErrorCode::ProxyUnavailable,
    }
}

/// A short, key-free summary of an upstream error body.
pub fn upstream_message(body: &str, key: &str) -> Option<String> {
    let parsed: Option<Value> = serde_json::from_str(body).ok();
    let message = parsed.as_ref().and_then(|value| {
        value["error"]["message"]
            .as_str()
            .or_else(|| value["error"].as_str())
            .or_else(|| value["message"].as_str())
            .map(str::to_owned)
    })?;
    let mut cleaned: String = message
        .chars()
        .filter(|character| !character.is_control())
        .take(200)
        .collect();
    if !key.is_empty() {
        cleaned = cleaned.replace(key, "[redacted]");
    }
    Some(format!("Proxy said: {cleaned}"))
}

pub(crate) fn map_reqwest(error: &reqwest::Error) -> ProxyError {
    if error.is_timeout() {
        ProxyError::new(ProxyErrorCode::Timeout)
    } else if error.is_redirect() {
        ProxyError::new(ProxyErrorCode::WrongEndpoint)
    } else {
        ProxyError::new(ProxyErrorCode::ProxyUnavailable)
    }
}

pub struct ProbeOk {
    pub model_reported: Option<String>,
}

/// One explicitly requested, small Chat Completions call. It is never retried.
pub async fn probe_chat(
    base: &str,
    key: &str,
    model: &str,
    allow_local: bool,
) -> Result<ProbeOk, ProxyError> {
    let body = json!({
        "model": model,
        "messages": [{ "role": "user", "content": "Connection test. Reply with the single word: ready" }],
        "max_tokens": TEST_MAX_OUTPUT_TOKENS,
        "stream": false,
    });
    let value = complete(base, key, &body, allow_local, Duration::from_secs(45)).await?;
    Ok(ProbeOk {
        model_reported: value["model"].as_str().map(str::to_owned),
    })
}

/// Non-streaming Chat Completions request returning the validated JSON body.
pub async fn complete(
    base: &str,
    key: &str,
    body: &Value,
    allow_local: bool,
    limit: Duration,
) -> Result<Value, ProxyError> {
    check_resolved(base, allow_local).await?;
    let response = proxy_http()
        .post(endpoint(base, "chat/completions"))
        .bearer_auth(key)
        .header(ACCEPT, "application/json")
        .timeout(limit)
        .json(body)
        .send()
        .await
        .map_err(|error| map_reqwest(&error))?;
    let status = response.status();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_ascii_lowercase();
    let text = response.text().await.map_err(|error| map_reqwest(&error))?;
    if !status.is_success() {
        let code = classify_status(status.as_u16(), &text);
        return Err(match upstream_message(&text, key) {
            Some(detail) => ProxyError::with_detail(code, detail),
            None => ProxyError::new(code),
        });
    }
    // Some OpenAI-compatible proxies (ZRoute among them) always answer with an
    // event stream, even for `"stream": false`. The stream is read to the end
    // and folded into the regular Chat Completions shape.
    if content_type.contains("event-stream") {
        return collect_stream_completion(&text, key);
    }
    if !content_type.contains("json") {
        return Err(ProxyError::with_detail(
            ProxyErrorCode::WrongEndpoint,
            "It answered with a non-JSON page (for example HTML), so it was not marked Ready.",
        ));
    }
    let value: Value = serde_json::from_str(&text).map_err(|_| {
        ProxyError::with_detail(
            ProxyErrorCode::WrongEndpoint,
            "The response was not valid JSON.",
        )
    })?;
    if value.get("error").is_some_and(|error| !error.is_null()) {
        let code = classify_status(400, &text);
        return Err(match upstream_message(&text, key) {
            Some(detail) => ProxyError::with_detail(code, detail),
            None => ProxyError::new(code),
        });
    }
    let has_message = value["choices"]
        .as_array()
        .and_then(|choices| choices.first())
        .is_some_and(|choice| choice.get("message").is_some());
    if !has_message {
        return Err(ProxyError::with_detail(
            ProxyErrorCode::WrongEndpoint,
            "The response had no Chat Completions choices.",
        ));
    }
    Ok(value)
}

/// Folds a complete Chat Completions event stream into one non-streaming
/// response body. A stream without any Chat Completions chunk is rejected.
pub fn collect_stream_completion(text: &str, key: &str) -> Result<Value, ProxyError> {
    let mut parser = SseParser::default();
    let mut payloads = parser.push(text.as_bytes());
    payloads.extend(parser.push(b"\n"));
    let mut content = String::new();
    let mut model: Option<String> = None;
    let mut finish_reason: Option<String> = None;
    let mut usage: Option<Value> = None;
    let mut chunks = 0usize;
    for payload in payloads {
        if payload == "[DONE]" {
            break;
        }
        let Ok(chunk) = serde_json::from_str::<Value>(&payload) else {
            continue;
        };
        if chunk.get("error").is_some_and(|error| !error.is_null()) {
            let code = classify_status(400, &payload);
            return Err(match upstream_message(&payload, key) {
                Some(detail) => ProxyError::with_detail(code, detail),
                None => ProxyError::new(code),
            });
        }
        if chunk.get("usage").is_some_and(|value| !value.is_null()) {
            usage = Some(chunk["usage"].clone());
        }
        let Some(choice) = chunk["choices"]
            .as_array()
            .and_then(|choices| choices.first())
        else {
            continue;
        };
        chunks += 1;
        if let Some(reason) = choice["finish_reason"].as_str() {
            finish_reason = Some(reason.to_owned());
        }
        if model.is_none() {
            model = chunk["model"].as_str().map(str::to_owned);
        }
        if let Some(delta) = choice["delta"]["content"].as_str() {
            content.push_str(delta);
        } else if let Some(full) = choice["message"]["content"].as_str() {
            content.push_str(full);
        }
    }
    if chunks == 0 {
        return Err(ProxyError::with_detail(
            ProxyErrorCode::WrongEndpoint,
            "The event stream had no Chat Completions chunks.",
        ));
    }
    Ok(serde_json::json!({
        "model": model,
        "usage": usage,
        "choices": [{
            "index": 0,
            "message": { "role": "assistant", "content": content },
            "finish_reason": finish_reason,
        }],
    }))
}

/// Why the model stopped, when the provider said so. `length` means the
/// output was cut off at the token cap and must not be treated as complete.
pub fn completion_finish_reason(value: &Value) -> Option<String> {
    value["choices"][0]["finish_reason"]
        .as_str()
        .map(str::to_owned)
}

pub fn completion_text(value: &Value) -> String {
    value["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or_default()
        .to_owned()
}

/// Lists model IDs. A failure here never means chat is unsupported; the
/// dialog falls back to manual model entry.
pub async fn list_models(
    base: &str,
    key: &str,
    allow_local: bool,
) -> Result<Vec<String>, ProxyError> {
    check_resolved(base, allow_local).await?;
    let response = proxy_http()
        .get(endpoint(base, "models"))
        .bearer_auth(key)
        .header(ACCEPT, "application/json")
        .timeout(Duration::from_secs(20))
        .send()
        .await
        .map_err(|error| map_reqwest(&error))?;
    let status = response.status();
    let text = response.text().await.map_err(|error| map_reqwest(&error))?;
    if !status.is_success() {
        return Err(ProxyError::new(classify_status(status.as_u16(), &text)));
    }
    let value: Value = serde_json::from_str(&text).map_err(|_| {
        ProxyError::with_detail(
            ProxyErrorCode::WrongEndpoint,
            "The model list was not JSON.",
        )
    })?;
    let entries = value["data"]
        .as_array()
        .or_else(|| value["models"].as_array())
        .or_else(|| value.as_array())
        .cloned()
        .unwrap_or_default();
    let mut ids: Vec<String> = entries
        .iter()
        .filter_map(|entry| {
            entry["id"]
                .as_str()
                .or_else(|| entry.as_str())
                .map(str::to_owned)
        })
        .filter(|id| valid_model_id(id))
        .collect();
    ids.sort();
    ids.dedup();
    Ok(ids)
}

/// Opens a streaming Chat Completions request and checks that the proxy
/// actually answered with an event stream.
pub async fn open_stream(
    base: &str,
    key: &str,
    body: &Value,
    allow_local: bool,
) -> Result<reqwest::Response, ProxyError> {
    check_resolved(base, allow_local).await?;
    let response = proxy_http()
        .post(endpoint(base, "chat/completions"))
        .bearer_auth(key)
        .header(ACCEPT, "text/event-stream")
        .json(body)
        .send()
        .await
        .map_err(|error| map_reqwest(&error))?;
    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        let code = classify_status(status.as_u16(), &text);
        return Err(match upstream_message(&text, key) {
            Some(detail) => ProxyError::with_detail(code, detail),
            None => ProxyError::new(code),
        });
    }
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !content_type.contains("event-stream") {
        return Err(ProxyError::with_detail(
            ProxyErrorCode::WrongEndpoint,
            "The proxy did not answer with a streaming response.",
        ));
    }
    Ok(response)
}

/// Incremental Server-Sent Events parser for Chat Completions streams.
/// Bytes are buffered until a full line arrives, so multi-byte characters split
/// across network chunks are decoded correctly.
#[derive(Default)]
pub struct SseParser {
    buffer: Vec<u8>,
}

impl SseParser {
    pub fn push(&mut self, chunk: &[u8]) -> Vec<String> {
        self.buffer.extend_from_slice(chunk);
        let mut payloads = Vec::new();
        while let Some(position) = self.buffer.iter().position(|byte| *byte == b'\n') {
            let line: Vec<u8> = self.buffer.drain(..=position).collect();
            let line = String::from_utf8_lossy(&line);
            let line = line.trim_end_matches(['\r', '\n']);
            if let Some(data) = line.strip_prefix("data:") {
                payloads.push(data.trim_start().to_owned());
            }
        }
        payloads
    }
}

pub fn valid_model_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .next()
            .is_some_and(|byte| byte.is_ascii_alphanumeric())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"._:/@+-".contains(&byte))
}

/// Rejects state-changing requests that do not come from an allowed browser
/// origin (defence in depth on top of CORS and SameSite cookies).
pub(crate) fn foreign_origin(state: &AppState, headers: &HeaderMap) -> Option<Response> {
    let allowed = headers
        .get(ORIGIN)
        .is_some_and(|origin| crate::browser_origins(&state.config).contains(origin));
    (!allowed).then(|| {
        json_error(
            StatusCode::FORBIDDEN,
            "forbidden_origin",
            "This request must come from the workspace app.",
        )
    })
}

#[derive(Clone)]
pub(crate) struct StoredProxy {
    pub base_url: String,
    pub model_id: String,
    pub key: String,
    pub max_output_tokens: i32,
    pub temperature: Option<f32>,
    pub status: String,
}

#[derive(Debug, Serialize)]
pub struct ModelProxyStatus {
    pub configured: bool,
    pub status: String,
    pub connection_name: Option<String>,
    pub base_url: Option<String>,
    pub model_id: Option<String>,
    pub key_saved: bool,
    pub max_output_tokens: Option<i32>,
    pub temperature: Option<f32>,
    pub last_error_code: Option<String>,
    pub last_error: Option<String>,
    pub last_tested_at: Option<chrono::DateTime<chrono::Utc>>,
    pub last_model_reported: Option<String>,
    pub local_http_exception: bool,
}

#[derive(Debug, Deserialize)]
pub struct SaveModelProxy {
    pub connection_name: String,
    pub base_url: String,
    pub api_key: Option<String>,
    pub model_id: String,
    pub max_output_tokens: Option<i32>,
    pub temperature: Option<f32>,
    /// When true the settings are saved and one small test request is sent.
    #[serde(default)]
    pub test: bool,
}

pub(crate) async fn load_proxy(state: &AppState, user_id: Uuid) -> Result<Option<StoredProxy>, ()> {
    let row = sqlx::query_as::<_, (String, String, Vec<u8>, Vec<u8>, i32, Option<f32>, String)>(
        "SELECT base_url, model_id, key_ciphertext, key_nonce, max_output_tokens, temperature, status
         FROM model_proxy_connections WHERE user_id = $1",
    )
    .bind(user_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ())?;
    let Some((base_url, model_id, ciphertext, nonce, max_output_tokens, temperature, status)) = row
    else {
        return Ok(None);
    };
    let key = decrypt_secret(&state.config.credential_encryption_key, &ciphertext, &nonce)
        .map_err(|_| ())?;
    Ok(Some(StoredProxy {
        base_url,
        model_id,
        key,
        max_output_tokens,
        temperature,
        status,
    }))
}

pub(crate) async fn proxy_status(state: &AppState, user_id: Uuid) -> Result<ModelProxyStatus, ()> {
    let row = sqlx::query_as::<
        _,
        (
            String,
            String,
            String,
            i32,
            Option<f32>,
            String,
            Option<String>,
            Option<String>,
            Option<chrono::DateTime<chrono::Utc>>,
            Option<String>,
        ),
    >(
        "SELECT connection_name, base_url, model_id, max_output_tokens, temperature, status,
                last_error_code, last_error, last_tested_at, last_model_reported
         FROM model_proxy_connections WHERE user_id = $1",
    )
    .bind(user_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ())?;
    Ok(match row {
        Some((
            connection_name,
            base_url,
            model_id,
            max_output_tokens,
            temperature,
            status,
            last_error_code,
            last_error,
            last_tested_at,
            last_model_reported,
        )) => ModelProxyStatus {
            configured: true,
            status,
            connection_name: Some(connection_name),
            base_url: Some(base_url),
            model_id: Some(model_id),
            key_saved: true,
            max_output_tokens: Some(max_output_tokens),
            temperature,
            last_error_code,
            last_error,
            last_tested_at,
            last_model_reported,
            local_http_exception: allow_local_http(),
        },
        None => ModelProxyStatus {
            configured: false,
            status: "not_configured".to_owned(),
            connection_name: None,
            base_url: None,
            model_id: None,
            key_saved: false,
            max_output_tokens: None,
            temperature: None,
            last_error_code: None,
            last_error: None,
            last_tested_at: None,
            last_model_reported: None,
            local_http_exception: allow_local_http(),
        },
    })
}

/// Records the outcome of a real model call on the user's connection.
pub(crate) async fn record_outcome(
    state: &AppState,
    user_id: Uuid,
    outcome: Result<Option<String>, &ProxyError>,
) {
    let (status, code, message, reported) = match outcome {
        Ok(reported) => ("ready", None, None, reported),
        Err(error) => {
            let status = match error.code {
                ProxyErrorCode::ProxyUnavailable | ProxyErrorCode::Timeout => "unavailable",
                _ => "needs_attention",
            };
            (
                status,
                Some(error.code.as_str().to_owned()),
                Some(error.message()),
                None,
            )
        }
    };
    let _ = sqlx::query(
        "UPDATE model_proxy_connections
         SET status = $2, last_error_code = $3, last_error = $4,
             last_model_reported = COALESCE($5, last_model_reported),
             last_tested_at = NOW(), updated_at = NOW()
         WHERE user_id = $1",
    )
    .bind(user_id)
    .bind(status)
    .bind(code)
    .bind(message)
    .bind(reported)
    .execute(&state.pool)
    .await;
}

async fn signed_in(state: &AppState, jar: &CookieJar) -> Result<Uuid, Response> {
    match optional_authenticated_user_id(state, jar).await {
        Ok(Some(user_id)) => Ok(user_id),
        Ok(None) => Err(json_error(
            StatusCode::UNAUTHORIZED,
            "unauthorized",
            "Sign in to the workspace first.",
        )),
        Err(_) => Err(json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "backend_error",
            "The workspace session could not be read.",
        )),
    }
}

async fn status_response(state: &AppState, user_id: Uuid) -> Response {
    match proxy_status(state, user_id).await {
        Ok(status) => Json(status).into_response(),
        Err(()) => json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "backend_error",
            "The model connection could not be read.",
        ),
    }
}

pub async fn get_status(State(state): State<AppState>, jar: CookieJar) -> Response {
    let user_id = match signed_in(&state, &jar).await {
        Ok(user_id) => user_id,
        Err(response) => return response,
    };
    status_response(&state, user_id).await
}

pub async fn save(
    State(state): State<AppState>,
    jar: CookieJar,
    headers: HeaderMap,
    Json(payload): Json<SaveModelProxy>,
) -> Response {
    if let Some(response) = foreign_origin(&state, &headers) {
        return response;
    }
    let user_id = match signed_in(&state, &jar).await {
        Ok(user_id) => user_id,
        Err(response) => return response,
    };
    let allow_local = allow_local_http();
    let connection_name = payload.connection_name.trim();
    if connection_name.is_empty() || connection_name.chars().count() > 60 {
        return json_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_connection_name",
            "Enter a connection name of up to 60 characters.",
        );
    }
    let base_url = match normalize_base_url(&payload.base_url, allow_local) {
        Ok(base_url) => base_url,
        Err(message) => {
            return json_error(
                StatusCode::UNPROCESSABLE_ENTITY,
                "invalid_base_url",
                message,
            );
        }
    };
    let model_id = payload.model_id.trim();
    if !valid_model_id(model_id) {
        return json_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_model_id",
            "Enter a model ID made of letters, numbers and . _ : / @ + -",
        );
    }
    let max_output_tokens = payload
        .max_output_tokens
        .unwrap_or(DEFAULT_MAX_OUTPUT_TOKENS);
    if !(64..=8192).contains(&max_output_tokens) {
        return json_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_max_output_tokens",
            "Maximum output tokens must be between 64 and 8192.",
        );
    }
    if let Some(temperature) = payload.temperature
        && !(0.0..=2.0).contains(&temperature)
    {
        return json_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_temperature",
            "Temperature must be between 0 and 2.",
        );
    }
    let key = match payload
        .api_key
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(key) => {
            if key.len() > 512 || key.chars().any(char::is_whitespace) {
                return json_error(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "invalid_api_key",
                    "The API key looks malformed.",
                );
            }
            key.to_owned()
        }
        None => match load_proxy(&state, user_id).await {
            Ok(Some(existing)) => {
                if !same_host(&existing.base_url, &base_url) {
                    return json_error(
                        StatusCode::UNPROCESSABLE_ENTITY,
                        "key_host_mismatch",
                        "Enter the API key for the new host. The stored key is only reused for the saved host.",
                    );
                }
                existing.key
            }
            Ok(None) => {
                return json_error(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "missing_api_key",
                    "Enter the API key.",
                );
            }
            Err(()) => {
                return json_error(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "backend_error",
                    "The stored key could not be read.",
                );
            }
        },
    };
    let (ciphertext, nonce) = match encrypt_secret(&state.config.credential_encryption_key, &key) {
        Ok(value) => value,
        Err(_) => {
            return json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "backend_error",
                "The API key could not be encrypted.",
            );
        }
    };
    // Saving never marks the connection Ready; only a successful model call does.
    let stored = sqlx::query(
        "INSERT INTO model_proxy_connections
            (user_id, connection_name, base_url, model_id, key_ciphertext, key_nonce, max_output_tokens, temperature, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'untested')
         ON CONFLICT (user_id) DO UPDATE
         SET connection_name = EXCLUDED.connection_name,
             base_url = EXCLUDED.base_url,
             model_id = EXCLUDED.model_id,
             key_ciphertext = EXCLUDED.key_ciphertext,
             key_nonce = EXCLUDED.key_nonce,
             max_output_tokens = EXCLUDED.max_output_tokens,
             temperature = EXCLUDED.temperature,
             status = 'untested',
             last_error_code = NULL,
             last_error = NULL,
             updated_at = NOW()",
    )
    .bind(user_id)
    .bind(connection_name)
    .bind(&base_url)
    .bind(model_id)
    .bind(ciphertext)
    .bind(nonce)
    .bind(max_output_tokens)
    .bind(payload.temperature)
    .execute(&state.pool)
    .await;
    if stored.is_err() {
        return json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "backend_error",
            "The model connection could not be saved.",
        );
    }
    if payload.test {
        let outcome = probe_chat(&base_url, &key, model_id, allow_local).await;
        match &outcome {
            Ok(ok) => record_outcome(&state, user_id, Ok(ok.model_reported.clone())).await,
            Err(error) => record_outcome(&state, user_id, Err(error)).await,
        }
    }
    status_response(&state, user_id).await
}

pub async fn test(State(state): State<AppState>, jar: CookieJar, headers: HeaderMap) -> Response {
    if let Some(response) = foreign_origin(&state, &headers) {
        return response;
    }
    let user_id = match signed_in(&state, &jar).await {
        Ok(user_id) => user_id,
        Err(response) => return response,
    };
    let stored = match load_proxy(&state, user_id).await {
        Ok(Some(stored)) => stored,
        Ok(None) => {
            return json_error(
                StatusCode::CONFLICT,
                "not_configured",
                "Configure the model proxy first.",
            );
        }
        Err(()) => {
            return json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "backend_error",
                "The model connection could not be read.",
            );
        }
    };
    let outcome = probe_chat(
        &stored.base_url,
        &stored.key,
        &stored.model_id,
        allow_local_http(),
    )
    .await;
    match &outcome {
        Ok(ok) => record_outcome(&state, user_id, Ok(ok.model_reported.clone())).await,
        Err(error) => record_outcome(&state, user_id, Err(error)).await,
    }
    status_response(&state, user_id).await
}

pub async fn models(State(state): State<AppState>, jar: CookieJar) -> Response {
    let user_id = match signed_in(&state, &jar).await {
        Ok(user_id) => user_id,
        Err(response) => return response,
    };
    let stored = match load_proxy(&state, user_id).await {
        Ok(Some(stored)) => stored,
        Ok(None) => {
            return json_error(
                StatusCode::CONFLICT,
                "not_configured",
                "Save the API base URL and key first.",
            );
        }
        Err(()) => {
            return json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "backend_error",
                "The model connection could not be read.",
            );
        }
    };
    match list_models(&stored.base_url, &stored.key, allow_local_http()).await {
        Ok(models) => Json(json!({ "available": true, "models": models })).into_response(),
        Err(error) => Json(json!({
            "available": false,
            "models": [],
            "error_code": error.code.as_str(),
            "message": format!("{} You can still type the model ID manually; this does not mean chat is unsupported.", error.message()),
        }))
        .into_response(),
    }
}

#[derive(Debug, Deserialize)]
pub struct DiscoverModels {
    pub base_url: String,
    pub api_key: Option<String>,
}

/// Lists provider models for a draft connection that has not been saved yet.
/// The key is used for this one request and is neither stored nor echoed. When
/// the draft has no key, the stored key is reused only for the same host.
pub async fn discover_models(
    State(state): State<AppState>,
    jar: CookieJar,
    headers: HeaderMap,
    Json(payload): Json<DiscoverModels>,
) -> Response {
    if let Some(response) = foreign_origin(&state, &headers) {
        return response;
    }
    let user_id = match signed_in(&state, &jar).await {
        Ok(user_id) => user_id,
        Err(response) => return response,
    };
    let allow_local = allow_local_http();
    let base_url = match normalize_base_url(&payload.base_url, allow_local) {
        Ok(base_url) => base_url,
        Err(message) => {
            return json_error(
                StatusCode::UNPROCESSABLE_ENTITY,
                "invalid_base_url",
                message,
            );
        }
    };
    let typed = payload
        .api_key
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let key = match typed {
        Some(key) => {
            if key.len() > 512 || key.chars().any(char::is_whitespace) {
                return json_error(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "invalid_api_key",
                    "The API key looks malformed.",
                );
            }
            key.to_owned()
        }
        None => match load_proxy(&state, user_id).await {
            Ok(Some(stored)) if same_host(&stored.base_url, &base_url) => stored.key,
            Ok(Some(_)) => {
                return json_error(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "key_host_mismatch",
                    "Enter the API key for the new host. The stored key is only reused for the saved host.",
                );
            }
            Ok(None) => {
                return json_error(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "missing_api_key",
                    "Enter the API key.",
                );
            }
            Err(()) => {
                return json_error(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "backend_error",
                    "The stored key could not be read.",
                );
            }
        },
    };
    match list_models(&base_url, &key, allow_local).await {
        Ok(models) => Json(json!({ "available": true, "models": models })).into_response(),
        Err(error) => Json(json!({
            "available": false,
            "models": [],
            "error_code": error.code.as_str(),
            "message": format!("{} You can still type the model ID manually; this does not mean chat is unsupported.", error.message()),
        }))
        .into_response(),
    }
}

pub async fn disconnect(
    State(state): State<AppState>,
    jar: CookieJar,
    headers: HeaderMap,
) -> Response {
    if let Some(response) = foreign_origin(&state, &headers) {
        return response;
    }
    let user_id = match signed_in(&state, &jar).await {
        Ok(user_id) => user_id,
        Err(response) => return response,
    };
    if sqlx::query("DELETE FROM model_proxy_connections WHERE user_id = $1")
        .bind(user_id)
        .execute(&state.pool)
        .await
        .is_err()
    {
        return json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "backend_error",
            "The model connection could not be removed.",
        );
    }
    status_response(&state, user_id).await
}

#[cfg(test)]
mod tests {
    use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

    use super::{
        ProxyErrorCode, SseParser, blocked_ip, classify_status, collect_stream_completion,
        completion_text, endpoint, normalize_base_url, upstream_message, valid_model_id,
    };

    #[test]
    fn base_urls_are_normalized_without_inventing_segments() {
        assert_eq!(
            normalize_base_url("https://api-dev.zroute.ai/openai/", false).unwrap(),
            "https://api-dev.zroute.ai/openai"
        );
        assert_eq!(
            normalize_base_url("https://api.example.com/v1", false).unwrap(),
            "https://api.example.com/v1"
        );
        assert_eq!(
            normalize_base_url("https://api.example.com/v1/chat/completions", false).unwrap(),
            "https://api.example.com/v1"
        );
        assert_eq!(
            normalize_base_url("https://api.example.com/v1/models", false).unwrap(),
            "https://api.example.com/v1"
        );
        assert_eq!(
            normalize_base_url("https://api.example.com/v1/v1", false).unwrap(),
            "https://api.example.com/v1"
        );
        assert_eq!(
            normalize_base_url("  https://API.Example.com:8443/openai  ", false).unwrap(),
            "https://api.example.com:8443/openai"
        );
    }

    #[test]
    fn an_event_stream_answer_to_a_plain_request_is_folded_into_one_message() {
        let stream = "data: {\"choices\":[{\"delta\":{\"content\":\"\",\"role\":\"assistant\"},\"index\":0}],\"model\":\"gemini-test\"}\n\n\
data: {\"choices\":[{\"delta\":{\"content\":\"O\"},\"index\":0}],\"model\":\"gemini-test\"}\n\n\
data: {\"choices\":[{\"delta\":{\"content\":\"K\"},\"index\":0}]}\n\ndata: [DONE]\n\n";
        let value = collect_stream_completion(stream, "secret").unwrap();
        assert_eq!(completion_text(&value), "OK");
        assert_eq!(value["model"], "gemini-test");
        assert_eq!(super::completion_finish_reason(&value), None);
        let cut = collect_stream_completion(
            "data: {\"choices\":[{\"delta\":{\"content\":\"{\\\"fa\"}}],\"model\":\"m\"}\n\ndata: {\"choices\":[{\"delta\":{},\"finish_reason\":\"length\"}],\"usage\":{\"completion_tokens\":23}}\n\ndata: [DONE]\n\n",
            "secret",
        )
        .unwrap();
        assert_eq!(
            super::completion_finish_reason(&cut).as_deref(),
            Some("length")
        );
        assert_eq!(cut["usage"]["completion_tokens"], 23);
        let empty = collect_stream_completion("data: {\"hello\":1}\n\n", "secret").unwrap_err();
        assert_eq!(empty.code, ProxyErrorCode::WrongEndpoint);
        let failed = collect_stream_completion(
            "data: {\"error\":{\"message\":\"Invalid API key secret\"}}\n\n",
            "secret",
        )
        .unwrap_err();
        assert_ne!(failed.code, ProxyErrorCode::WrongEndpoint);
    }

    #[test]
    fn endpoints_join_with_one_slash_and_never_duplicate_v1() {
        let base = normalize_base_url("https://api.example.com/v1/", false).unwrap();
        assert_eq!(
            endpoint(&base, "chat/completions"),
            "https://api.example.com/v1/chat/completions"
        );
        assert_eq!(
            endpoint(&base, "/models"),
            "https://api.example.com/v1/models"
        );
        let zroute = normalize_base_url("https://api-dev.zroute.ai/openai", false).unwrap();
        assert_eq!(
            endpoint(&zroute, "chat/completions"),
            "https://api-dev.zroute.ai/openai/chat/completions"
        );
    }

    #[test]
    fn destinations_must_be_https_and_public() {
        assert!(normalize_base_url("http://api.example.com/v1", false).is_err());
        assert!(normalize_base_url("ftp://api.example.com", false).is_err());
        assert!(normalize_base_url("https://user:pass@api.example.com", false).is_err());
        assert!(normalize_base_url("https://api.example.com/v1?key=1", false).is_err());
        assert!(normalize_base_url("https://169.254.169.254/latest", false).is_err());
        assert!(normalize_base_url("https://10.0.0.5/v1", false).is_err());
        assert!(normalize_base_url("https://192.168.1.10/v1", false).is_err());
        assert!(normalize_base_url("https://[fd00::1]/v1", false).is_err());
        assert!(normalize_base_url("https://metadata.google.internal/v1", false).is_err());
        assert!(normalize_base_url("https://intranet/v1", false).is_err());
        assert!(normalize_base_url("http://localhost:9000/v1", false).is_err());
        assert!(normalize_base_url("http://127.0.0.1:9000/v1", false).is_err());
    }

    #[test]
    fn the_local_development_exception_allows_loopback_only() {
        assert_eq!(
            normalize_base_url("http://127.0.0.1:9000/v1", true).unwrap(),
            "http://127.0.0.1:9000/v1"
        );
        assert!(normalize_base_url("http://localhost:9000/v1", true).is_ok());
        assert!(normalize_base_url("http://10.0.0.5/v1", true).is_err());
        assert!(normalize_base_url("http://api.example.com/v1", true).is_err());
        assert!(normalize_base_url("https://169.254.169.254/", true).is_err());
    }

    #[test]
    fn internal_addresses_are_blocked() {
        assert!(blocked_ip(
            IpAddr::V4(Ipv4Addr::new(169, 254, 169, 254)),
            true
        ));
        assert!(blocked_ip(IpAddr::V4(Ipv4Addr::new(172, 16, 0, 1)), false));
        assert!(blocked_ip(IpAddr::V4(Ipv4Addr::new(100, 64, 0, 1)), false));
        assert!(blocked_ip(IpAddr::V4(Ipv4Addr::LOCALHOST), false));
        assert!(!blocked_ip(IpAddr::V4(Ipv4Addr::LOCALHOST), true));
        assert!(blocked_ip(
            IpAddr::V6("::ffff:10.0.0.1".parse::<Ipv6Addr>().unwrap()),
            false
        ));
        assert!(!blocked_ip(IpAddr::V4(Ipv4Addr::new(104, 18, 1, 1)), false));
    }

    #[test]
    fn upstream_errors_map_to_user_facing_classes() {
        assert_eq!(
            classify_status(401, r#"{"error":{"code":"invalid_api_key"}}"#),
            ProxyErrorCode::InvalidKey
        );
        assert_eq!(
            classify_status(404, r#"{"error":{"message":"model 'nope' not found"}}"#),
            ProxyErrorCode::ModelUnavailable
        );
        assert_eq!(
            classify_status(400, r#"{"error":{"message":"Unsupported model: nope"}}"#),
            ProxyErrorCode::ModelUnavailable
        );
        assert_eq!(
            classify_status(
                503,
                r#"{"error":{"message":"No available channel for model x"}}"#
            ),
            ProxyErrorCode::ModelUnavailable
        );
        assert_eq!(
            classify_status(404, "<html>Not Found</html>"),
            ProxyErrorCode::WrongEndpoint
        );
        assert_eq!(classify_status(301, ""), ProxyErrorCode::WrongEndpoint);
        assert_eq!(classify_status(429, ""), ProxyErrorCode::RateLimited);
        assert_eq!(classify_status(504, ""), ProxyErrorCode::Timeout);
        assert_eq!(classify_status(502, ""), ProxyErrorCode::ProxyUnavailable);
    }

    #[test]
    fn upstream_messages_never_echo_the_key() {
        let message = upstream_message(
            r#"{"error":{"message":"bad key sk-secret-123"}}"#,
            "sk-secret-123",
        )
        .unwrap();
        assert!(!message.contains("sk-secret-123"));
        assert!(message.contains("[redacted]"));
    }

    #[test]
    fn sse_parser_handles_split_chunks_and_multibyte_text() {
        let mut parser = SseParser::default();
        let event = "data: {\"choices\":[{\"delta\":{\"content\":\"héllo\"}}]}\n\n".as_bytes();
        let (first, second) = event.split_at(36);
        assert!(parser.push(first).is_empty());
        let payloads = parser.push(second);
        assert_eq!(payloads.len(), 1);
        assert!(payloads[0].contains("héllo"));
        assert_eq!(
            parser.push(b"data: [DONE]\r\n\r\n"),
            vec!["[DONE]".to_owned()]
        );
    }

    #[test]
    fn model_ids_are_restricted() {
        assert!(valid_model_id("gemini-3.8-flash"));
        assert!(valid_model_id("openai/gpt-4o-mini"));
        assert!(!valid_model_id(""));
        assert!(!valid_model_id("has space"));
        assert!(!valid_model_id("-leading"));
    }
}
