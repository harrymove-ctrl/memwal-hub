//! Database-backed tests for the ZRouter connection and Product Discovery chat.
//! Run with `DATABASE_URL=... cargo test --features database-tests`.
//! The model proxy is a local mock server; nothing here calls a live service.

use std::sync::{Arc, Mutex};

use axum::{
    Json, Router,
    body::{Body, to_bytes},
    http::{HeaderMap, Request, StatusCode},
    response::IntoResponse,
    routing::post,
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use tokio::net::TcpListener;
use tower::ServiceExt;
use uuid::Uuid;

use crate::{AppConfig, AppState, app};

const ORIGIN: &str = "http://localhost:5173";
const KEY: &str = "test-proxy-key-0123456789abcdef";

#[derive(Debug, Clone)]
struct Seen {
    authorization: Option<String>,
    cookie: bool,
    body: Value,
}

type SeenLog = Arc<Mutex<Vec<Seen>>>;

async fn user(pool: &PgPool) -> String {
    let id = Uuid::new_v4();
    sqlx::query("INSERT INTO users (id, username, password_hash) VALUES ($1, $2, 'test-only')")
        .bind(id)
        .bind(id.simple().to_string())
        .execute(pool)
        .await
        .unwrap();
    let token = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, NOW() + INTERVAL '1 hour')")
        .bind(Uuid::new_v4())
        .bind(id)
        .bind(format!("{:x}", Sha256::digest(token.as_bytes())))
        .execute(pool)
        .await
        .unwrap();
    format!("hub_session={token}")
}

fn state(pool: PgPool) -> AppState {
    // Loopback mock servers need the explicit local development exception.
    unsafe { std::env::set_var("MODEL_PROXY_ALLOW_LOCAL_HTTP", "true") };
    AppState {
        config: AppConfig::default(),
        pool,
        http: reqwest::Client::new(),
        gateway_http: reqwest::Client::new(),
    }
}

async fn mock_proxy(seen: SeenLog) -> String {
    let record = move |headers: HeaderMap, Json(body): Json<Value>| {
        let seen = seen.clone();
        async move {
            seen.lock().unwrap().push(Seen {
                authorization: headers
                    .get("authorization")
                    .and_then(|value| value.to_str().ok())
                    .map(str::to_owned),
                cookie: headers.contains_key("cookie"),
                body: body.clone(),
            });
            if body["model"] == "unavailable-model" {
                return (
                    StatusCode::SERVICE_UNAVAILABLE,
                    Json(json!({ "error": { "message": "no eligible provider account" } })),
                )
                    .into_response();
            }
            if body["stream"] == true {
                (
                    [("content-type", "text/event-stream")],
                    "data: {\"model\":\"mock-model-v1\",\"choices\":[{\"delta\":{\"content\":\"Hello \"}}]}\n\n\
                     data: {\"model\":\"mock-model-v1\",\"choices\":[{\"delta\":{\"content\":\"there\"},\"finish_reason\":\"stop\"}]}\n\n\
                     data: [DONE]\n\n",
                )
                    .into_response()
            } else {
                Json(json!({
                    "model": "mock-model-v1",
                    "choices": [{ "message": { "role": "assistant", "content": "ok" }, "finish_reason": "stop" }]
                }))
                .into_response()
            }
        }
    };
    let router = Router::new()
        .route("/v1/chat/completions", post(record))
        .route(
            "/html/chat/completions",
            post(|| async { ([("content-type", "text/html")], "<html>sign in</html>") }),
        );
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    format!("http://{address}")
}

fn request(
    method: &str,
    uri: &str,
    cookie: &str,
    origin: &str,
    body: Option<Value>,
) -> Request<Body> {
    let mut builder = Request::builder()
        .method(method)
        .uri(uri)
        .header("cookie", cookie)
        .header("origin", origin);
    if body.is_some() {
        builder = builder.header("content-type", "application/json");
    }
    builder
        .body(
            body.map(|value| Body::from(value.to_string()))
                .unwrap_or_else(Body::empty),
        )
        .unwrap()
}

async fn send(router: &Router, request: Request<Body>) -> (StatusCode, String) {
    let response = router.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 1 << 20).await.unwrap();
    (status, String::from_utf8_lossy(&bytes).into_owned())
}

fn proxy_payload(base: &str, test: bool) -> Value {
    json!({
        "connection_name": "Mock proxy",
        "base_url": base,
        "api_key": KEY,
        "model_id": "mock-model",
        "max_output_tokens": 400,
        "test": test,
    })
}

#[sqlx::test]
async fn proxy_credentials_are_isolated_encrypted_and_never_returned(pool: PgPool) {
    let seen: SeenLog = Arc::default();
    let base = mock_proxy(seen.clone()).await;
    let state = state(pool);
    let alice = user(&state.pool).await;
    let bob = user(&state.pool).await;
    let router = app(state.clone());

    let (status, body) = send(
        &router,
        request(
            "POST",
            "/model-proxy",
            &alice,
            "https://attacker.example",
            Some(proxy_payload(&format!("{base}/v1"), true)),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
    assert!(seen.lock().unwrap().is_empty());

    let (status, body) = send(
        &router,
        request(
            "POST",
            "/model-proxy",
            &alice,
            ORIGIN,
            Some(proxy_payload(&format!("{base}/v1/chat/completions"), true)),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(!body.contains(KEY));
    let saved: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(saved["status"], "ready");
    assert_eq!(saved["base_url"], format!("{base}/v1"));
    assert_eq!(saved["last_model_reported"], "mock-model-v1");
    assert_eq!(saved["key_saved"], true);

    {
        let calls = seen.lock().unwrap();
        assert_eq!(calls.len(), 1, "Test connection sends exactly one request");
        assert_eq!(
            calls[0].authorization.as_deref(),
            Some(format!("Bearer {KEY}").as_str())
        );
        assert!(!calls[0].cookie, "browser cookies are never forwarded");
        assert!(calls[0].body["max_tokens"].as_u64().unwrap() <= 32);
        assert_eq!(calls[0].body["stream"], false);
    }

    let (_, body) = send(
        &router,
        request("GET", "/model-proxy", &alice, ORIGIN, None),
    )
    .await;
    assert!(!body.contains(KEY));
    assert!(body.contains("\"status\":\"ready\""));

    let (_, body) = send(&router, request("GET", "/model-proxy", &bob, ORIGIN, None)).await;
    assert!(body.contains("\"configured\":false"), "{body}");
    let (status, body) = send(
        &router,
        request(
            "POST",
            "/discovery/chat",
            &bob,
            ORIGIN,
            Some(json!({"messages":[{"role":"user","content":"hi"}],"use_memory":false})),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert!(body.contains("model_not_configured"));

    let stored: Vec<Vec<u8>> =
        sqlx::query_scalar("SELECT key_ciphertext FROM model_proxy_connections")
            .fetch_all(&state.pool)
            .await
            .unwrap();
    assert_eq!(stored.len(), 1);
    assert!(
        !stored[0]
            .windows(KEY.len())
            .any(|window| window == KEY.as_bytes())
    );

    let (status, _) = send(
        &router,
        request("DELETE", "/model-proxy", &alice, ORIGIN, None),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (_, body) = send(
        &router,
        request("GET", "/model-proxy", &alice, ORIGIN, None),
    )
    .await;
    assert!(body.contains("\"configured\":false"));
}

#[sqlx::test]
async fn an_html_200_or_a_plain_save_never_marks_the_proxy_ready(pool: PgPool) {
    let seen: SeenLog = Arc::default();
    let base = mock_proxy(seen.clone()).await;
    let state = state(pool);
    let alice = user(&state.pool).await;
    let router = app(state);

    let (_, body) = send(
        &router,
        request(
            "POST",
            "/model-proxy",
            &alice,
            ORIGIN,
            Some(proxy_payload(&format!("{base}/v1"), false)),
        ),
    )
    .await;
    assert!(body.contains("\"status\":\"untested\""), "{body}");
    assert!(
        seen.lock().unwrap().is_empty(),
        "Save alone sends nothing upstream"
    );

    let (_, body) = send(
        &router,
        request(
            "POST",
            "/model-proxy",
            &alice,
            ORIGIN,
            Some(proxy_payload(&format!("{base}/html"), true)),
        ),
    )
    .await;
    assert!(!body.contains("\"status\":\"ready\""), "{body}");
    assert!(body.contains("wrong_endpoint"), "{body}");
    assert!(!body.contains(KEY));
}

#[sqlx::test]
async fn chat_streams_a_real_reply_and_sends_only_the_current_conversation(pool: PgPool) {
    let seen: SeenLog = Arc::default();
    let base = mock_proxy(seen.clone()).await;
    let state = state(pool);
    let alice = user(&state.pool).await;
    let router = app(state);
    send(
        &router,
        request(
            "POST",
            "/model-proxy",
            &alice,
            ORIGIN,
            Some(proxy_payload(&format!("{base}/v1"), true)),
        ),
    )
    .await;

    let (status, body) = send(
        &router,
        request(
            "POST",
            "/discovery/chat",
            &alice,
            ORIGIN,
            Some(json!({
                "messages": [{ "role": "user", "content": "Fresh question" }],
                "use_memory": false
            })),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        body.contains("event: memory\ndata: {\"state\":\"off\"}"),
        "{body}"
    );
    assert!(body.contains("event: request"));
    assert!(body.contains("\"memory_context_included\":false"));
    assert!(body.contains("event: delta\ndata: {\"text\":\"Hello \"}"));
    assert!(body.contains("event: done"));
    assert!(body.contains("mock-model-v1"));
    assert!(!body.contains(KEY));

    let calls = seen.lock().unwrap();
    let chat = calls.last().unwrap();
    let messages = chat.body["messages"].as_array().unwrap();
    assert_eq!(messages.len(), 2, "system prompt plus the one user message");
    assert_eq!(messages[0]["role"], "system");
    assert_eq!(messages[1]["content"], "Fresh question");
    assert_eq!(chat.body["stream"], true);
    assert_eq!(chat.body["max_tokens"], 400);
}

#[sqlx::test]
async fn a_per_conversation_model_is_used_and_its_failure_keeps_the_saved_connection_ready(
    pool: PgPool,
) {
    let seen: SeenLog = Arc::default();
    let base = mock_proxy(seen.clone()).await;
    let state = state(pool);
    let alice = user(&state.pool).await;
    let router = app(state);
    send(
        &router,
        request(
            "POST",
            "/model-proxy",
            &alice,
            ORIGIN,
            Some(proxy_payload(&format!("{base}/v1"), true)),
        ),
    )
    .await;
    let chat = |model: &str| {
        json!({
            "messages": [{ "role": "user", "content": "Which model?" }],
            "use_memory": false,
            "model": model
        })
    };

    let (status, body) = send(
        &router,
        request(
            "POST",
            "/discovery/chat",
            &alice,
            ORIGIN,
            Some(chat("other-model-2")),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(body.contains("event: done"), "{body}");
    assert_eq!(
        seen.lock().unwrap().last().unwrap().body["model"],
        "other-model-2"
    );

    let (_, body) = send(
        &router,
        request(
            "POST",
            "/discovery/chat",
            &alice,
            ORIGIN,
            Some(chat("unavailable-model")),
        ),
    )
    .await;
    assert!(body.contains("event: error"), "{body}");
    assert!(!body.contains("event: done"));
    let (_, status_body) = send(
        &router,
        request("GET", "/model-proxy", &alice, ORIGIN, None),
    )
    .await;
    let saved: Value = serde_json::from_str(&status_body).unwrap();
    assert_eq!(saved["status"], "ready", "{saved}");

    let (status, _) = send(
        &router,
        request(
            "POST",
            "/discovery/chat",
            &alice,
            ORIGIN,
            Some(chat("bad model id!")),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
}

#[sqlx::test]
async fn memory_failures_are_never_reported_as_success(pool: PgPool) {
    let seen: SeenLog = Arc::default();
    let base = mock_proxy(seen.clone()).await;
    let state = state(pool);
    let alice = user(&state.pool).await;
    let router = app(state);
    send(
        &router,
        request(
            "POST",
            "/model-proxy",
            &alice,
            ORIGIN,
            Some(proxy_payload(&format!("{base}/v1"), true)),
        ),
    )
    .await;
    let calls_before = seen.lock().unwrap().len();

    let (_, body) = send(
        &router,
        request(
            "POST",
            "/discovery/chat",
            &alice,
            ORIGIN,
            Some(json!({
                "messages": [{ "role": "user", "content": "What do you remember?" }],
                "use_memory": true
            })),
        ),
    )
    .await;
    assert!(body.contains("memory_unavailable"), "{body}");
    assert!(!body.contains("event: delta"));
    assert!(!body.contains("\"state\":\"included\""));
    assert_eq!(
        seen.lock().unwrap().len(),
        calls_before,
        "no model call after a Memory failure"
    );

    let (status, body) = send(
        &router,
        request(
            "POST",
            "/discovery/memories",
            &alice,
            ORIGIN,
            Some(json!({
                "facts": [{ "client_id": Uuid::new_v4(), "text": "We have two engineers." }]
            })),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert!(body.contains("memory_not_ready"));

    let (_, body) = send(
        &router,
        request("GET", "/memory/session", &alice, ORIGIN, None),
    )
    .await;
    assert!(body.contains("\"status\":\"not_connected\""), "{body}");
    assert!(body.contains("\"signed_in\":true"));
}
