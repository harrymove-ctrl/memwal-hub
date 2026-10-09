//! Isolated database tests. `sqlx::test` creates a throwaway database and runs
//! migrations. It does not use the demo or production database.
//!
//! Revision policy: each new chat request loads the newest saved instructions
//! once, before the provider call. A save that happens after that load does
//! not change the request already sent.

use std::sync::{Arc, Mutex};
use std::time::Duration;

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
use tokio::sync::Notify;
use tower::ServiceExt;
use uuid::Uuid;

use crate::{AppConfig, AppState, app};

const ORIGIN: &str = "http://localhost:5173";
const KEY: &str = "test-proxy-key-0123456789abcdef";
const ALPHA: &str = "Begin each answer with the heading MEMWAL-QA-ALPHA.";
const BETA: &str = "Begin each answer with the heading MEMWAL-QA-BETA.";

#[derive(Clone)]
struct SeenLog(Arc<Mutex<Vec<Value>>>);

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
    unsafe { std::env::set_var("MODEL_PROXY_ALLOW_LOCAL_HTTP", "true") };
    AppState {
        config: AppConfig::default(),
        pool,
        http: reqwest::Client::new(),
        gateway_http: reqwest::Client::new(),
    }
}

async fn mock_proxy(seen: SeenLog, started: Arc<Notify>, release: Arc<Notify>) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move {
        let app = Router::new().route(
            "/v1/chat/completions",
            post(move |headers: HeaderMap, Json(body): Json<Value>| {
                let seen = seen.clone();
                let started = started.clone();
                let release = release.clone();
                async move {
                    assert!(headers.get("authorization").is_some());
                    assert!(!headers.contains_key("cookie"));
                    let hold = {
                        let mut calls = seen.0.lock().unwrap();
                        calls.push(body);
                        calls.len() == 2
                    };
                    if hold {
                        started.notify_waiters();
                        release.notified().await;
                    }
                    (
                        [("content-type", "text/event-stream")],
                        "data: {\"model\":\"mock-model-v1\",\"choices\":[{\"delta\":{\"content\":\"ok\"},\"finish_reason\":\"stop\"}]}\n\n\
                         data: [DONE]\n\n",
                    )
                        .into_response()
                }
            }),
        );
        axum::serve(listener, app).await.unwrap();
    });
    format!("http://{address}")
}

fn request(method: &str, uri: &str, cookie: &str, body: Option<Value>) -> Request<Body> {
    let mut builder = Request::builder()
        .method(method)
        .uri(uri)
        .header("cookie", cookie)
        .header("origin", ORIGIN);
    if body.is_some() {
        builder = builder.header("content-type", "application/json");
    }
    builder
        .body(Body::from(
            body.map(|value| value.to_string()).unwrap_or_default(),
        ))
        .unwrap()
}

async fn send(router: &Router, request: Request<Body>) -> (StatusCode, String) {
    let response = router.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 1 << 20).await.unwrap();
    (status, String::from_utf8(bytes.to_vec()).unwrap())
}

fn system_text(body: &Value) -> String {
    body["messages"]
        .as_array()
        .and_then(|messages| messages.first())
        .and_then(|message| message["content"].as_str())
        .unwrap_or("")
        .to_owned()
}

#[sqlx::test]
async fn saved_revision_reaches_the_provider_and_other_users_do_not(pool: PgPool) {
    let seen = SeenLog(Arc::default());
    let started = Arc::new(Notify::new());
    let release = Arc::new(Notify::new());
    let base = mock_proxy(seen.clone(), started.clone(), release.clone()).await;
    let state = state(pool);
    let alice = user(&state.pool).await;
    let bob = user(&state.pool).await;
    let router = app(state);

    let (status, body) = send(
        &router,
        request(
            "POST",
            "/model-proxy",
            &alice,
            Some(json!({
                "connection_name": "Mock proxy",
                "base_url": format!("{base}/v1"),
                "api_key": KEY,
                "model_id": "mock-model",
                "max_output_tokens": 400,
                "test": true
            })),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        seen.0.lock().unwrap().len(),
        1,
        "Test connection sends exactly one provider request and nothing else does"
    );

    let (status, body) = send(
        &router,
        request(
            "POST",
            "/projects",
            &alice,
            Some(json!({"name": "QA", "request_id": "qa-project-1"})),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let project_id = serde_json::from_str::<Value>(&body).unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let (status, again) = send(
        &router,
        request(
            "POST",
            "/projects",
            &alice,
            Some(json!({"name": "QA again", "request_id": "qa-project-1"})),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{again}");
    assert_eq!(
        serde_json::from_str::<Value>(&again).unwrap()["id"],
        project_id
    );

    let (status, body) = send(
        &router,
        request(
            "GET",
            &format!("/projects/{project_id}/conversations"),
            &bob,
            None,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{body}");

    let (status, body) = send(
        &router,
        request(
            "POST",
            "/builder-agents",
            &alice,
            Some(json!({
                "agent_key": "qa-agent",
                "name": "QA agent",
                "instructions": ALPHA,
                "request_id": "qa-revision-a",
                "project_id": project_id,
                "tools": ["upload_file"]
            })),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert!(body.contains("unsupported_tool"));

    let (status, body) = send(
        &router,
        request(
            "POST",
            "/builder-agents",
            &alice,
            Some(json!({
                "agent_key": "qa-agent",
                "name": "QA agent",
                "instructions": ALPHA,
                "request_id": "qa-revision-a",
                "project_id": project_id,
                "tools": ["memwal_recall"]
            })),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    assert_eq!(serde_json::from_str::<Value>(&body).unwrap()["revision"], 1);

    let (status, _) = send(
        &router,
        request("GET", "/builder-agents/qa-agent", &bob, None),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    let missing = Uuid::new_v4();
    let before = seen.0.lock().unwrap().len();
    let (status, _) = send(
        &router,
        request(
            "POST",
            "/discovery/chat",
            &alice,
            Some(json!({
                "messages": [{"role": "user", "content": "hello"}],
                "use_memory": false,
                "project_id": missing,
                "agent_key": "qa-agent"
            })),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(
        seen.0.lock().unwrap().len(),
        before,
        "a bad project must not reach the provider"
    );

    let router_for_chat = router.clone();
    let alice_for_chat = alice.clone();
    let project_for_chat = project_id.clone();
    let chat = tokio::spawn(async move {
        send(
            &router_for_chat,
            request(
                "POST",
                "/discovery/chat",
                &alice_for_chat,
                Some(json!({
                    "messages": [{"role": "user", "content": "Say hello."}],
                    "use_memory": false,
                    "project_id": project_for_chat,
                    "agent_key": "qa-agent"
                })),
            ),
        )
        .await
    });
    tokio::time::timeout(Duration::from_secs(5), started.notified())
        .await
        .expect("the provider should receive revision A");
    let (status, body) = send(
        &router,
        request(
            "POST",
            "/builder-agents",
            &alice,
            Some(json!({
                "agent_key": "qa-agent",
                "name": "QA agent",
                "instructions": BETA,
                "request_id": "qa-revision-b",
                "project_id": project_id
            })),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    release.notify_waiters();
    let (status, body) = chat.await.unwrap();
    assert_eq!(status, StatusCode::OK, "{body}");
    // Call 0 is the connection test; call 1 is the chat that resolved revision A.
    let first = seen.0.lock().unwrap()[1].clone();
    let first_system = system_text(&first);
    assert!(first_system.contains(ALPHA), "{first_system}");
    assert!(!first_system.contains(BETA), "{first_system}");
    assert!(!first["messages"].to_string().contains("upload_file"));

    let (status, body) = send(
        &router,
        request(
            "POST",
            "/discovery/chat",
            &alice,
            Some(json!({
                "messages": [{"role": "user", "content": "Say hello again."}],
                "use_memory": false,
                "project_id": project_id,
                "agent_key": "qa-agent"
            })),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let calls = seen.0.lock().unwrap();
    let second_system = system_text(calls.last().unwrap());
    assert!(second_system.contains(BETA), "{second_system}");
    assert!(
        !second_system.contains("MEMWAL-QA-ALPHA"),
        "{second_system}"
    );
}

// ---------------------------------------------------------------------------
// Memory scope, recall relevance, extraction and revision pinning.
//
// The Walrus Memory bridge is replaced by `tests/fixtures/fake-memwal.mjs`,
// which records every adapter call per account. A denied request must leave
// that log empty. The model provider is a local mock that records each
// outgoing request, so assertions look at what would really be sent.
// ---------------------------------------------------------------------------

use std::collections::VecDeque;
use std::path::PathBuf;

struct Provider {
    base: String,
    seen: SeenLog,
    scripted: Arc<Mutex<VecDeque<Value>>>,
}

async fn provider() -> Provider {
    let seen = SeenLog(Arc::default());
    let scripted: Arc<Mutex<VecDeque<Value>>> = Arc::default();
    let (record, queue) = (seen.clone(), scripted.clone());
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move {
        let app = Router::new().route(
            "/v1/chat/completions",
            post(move |Json(body): Json<Value>| {
                let record = record.clone();
                let queue = queue.clone();
                async move {
                    record.0.lock().unwrap().push(body.clone());
                    if body["stream"] == true {
                        return (
                            [("content-type", "text/event-stream")],
                            "data: {\"model\":\"mock-model-v1\",\"choices\":[{\"delta\":{\"content\":\"Hello \"}}]}\n\n\
                             data: {\"model\":\"mock-model-v1\",\"choices\":[{\"delta\":{\"content\":\"there\"},\"finish_reason\":\"stop\"}]}\n\n\
                             data: [DONE]\n\n",
                        )
                            .into_response();
                    }
                    let next = queue.lock().unwrap().pop_front();
                    match next {
                        Some(reply) => Json(reply).into_response(),
                        None => Json(json!({
                            "model": "mock-model-v1",
                            "choices": [{ "message": { "role": "assistant", "content": "ok" }, "finish_reason": "stop" }]
                        }))
                        .into_response(),
                    }
                }
            }),
        );
        axum::serve(listener, app).await.unwrap();
    });
    Provider {
        base: format!("http://{address}"),
        seen,
        scripted,
    }
}

fn completion(content: &str, finish: &str) -> Value {
    json!({
        "model": "mock-model-v1",
        "choices": [{ "message": { "role": "assistant", "content": content }, "finish_reason": finish }]
    })
}

fn fake_memory_env() -> PathBuf {
    static ONCE: std::sync::Once = std::sync::Once::new();
    let dir = std::env::temp_dir().join("memwal-fake-logs");
    ONCE.call_once(|| {
        std::fs::create_dir_all(&dir).unwrap();
        let script =
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/fake-memwal.mjs");
        // SAFETY: set once, before any test spawns the bridge.
        unsafe {
            std::env::set_var("MEMWAL_SDK_SCRIPT", script);
            std::env::set_var("MEMWAL_FAKE_LOG_DIR", &dir);
        }
    });
    dir
}

/// A signed-in user with a Ready model connection and a verified Memory
/// connection whose *account* namespace is the legacy one. Returns the cookie,
/// the user id and the fake account id used to find the adapter log.
struct Rig {
    cookie: String,
    user_id: Uuid,
    account: String,
}

async fn rig(state: &AppState, router: &Router, provider: &Provider) -> Rig {
    fake_memory_env();
    let cookie = user(&state.pool).await;
    let user_id: Uuid = sqlx::query_scalar("SELECT user_id FROM sessions WHERE token_hash = $1")
        .bind(format!(
            "{:x}",
            Sha256::digest(cookie.trim_start_matches("hub_session=").as_bytes())
        ))
        .fetch_one(&state.pool)
        .await
        .unwrap();
    let (status, body) = send(
        router,
        request(
            "POST",
            "/model-proxy",
            &cookie,
            Some(json!({
                "connection_name": "Mock", "base_url": format!("{}/v1", provider.base),
                "api_key": KEY, "model_id": "mock-model", "max_output_tokens": 800, "test": true
            })),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let account = format!("acct-{}", user_id.simple());
    let (ciphertext, nonce) =
        crate::memory::encrypt_secret(&state.config.credential_encryption_key, "fake-delegate")
            .unwrap();
    sqlx::query(
        "INSERT INTO storage_connections (id, user_id, provider, account_id, server_url, namespace, key_ciphertext, key_nonce, status)
         VALUES ($1, $2, 'walrus_memory', $3, 'https://relayer.invalid', 'bew-harness/product-discovery', $4, $5, 'verified')",
    )
    .bind(Uuid::new_v4())
    .bind(user_id)
    .bind(&account)
    .bind(ciphertext)
    .bind(nonce)
    .execute(&state.pool)
    .await
    .unwrap();
    Rig {
        cookie,
        user_id,
        account,
    }
}

fn adapter_calls(rig: &Rig) -> Vec<Value> {
    let path = std::env::temp_dir()
        .join("memwal-fake-logs")
        .join(format!("{}.jsonl", rig.account));
    std::fs::read_to_string(path)
        .map(|text| {
            text.lines()
                .filter(|l| !l.is_empty())
                .map(|l| serde_json::from_str(l).unwrap())
                .collect()
        })
        .unwrap_or_default()
}

async fn make_project(router: &Router, cookie: &str, name: &str) -> String {
    let (status, body) = send(
        router,
        request(
            "POST",
            "/projects",
            cookie,
            Some(json!({"name": name, "request_id": format!("proj-{}", Uuid::new_v4())})),
        ),
    )
    .await;
    assert!(status.is_success(), "{body}");
    serde_json::from_str::<Value>(&body).unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned()
}

async fn make_chat(router: &Router, cookie: &str, project: &str, text: &str) -> (String, String) {
    let (status, body) = send(
        router,
        request(
            "POST",
            &format!("/projects/{project}/conversations"),
            cookie,
            Some(json!({"request_id": format!("chat-{}", Uuid::new_v4())})),
        ),
    )
    .await;
    assert!(status.is_success(), "{body}");
    let chat = serde_json::from_str::<Value>(&body).unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let request_id = format!("turn-{}", Uuid::new_v4());
    let (status, body) = send(
        router,
        request(
            "POST",
            &format!("/conversations/{chat}/messages"),
            cookie,
            Some(json!({"request_id": request_id, "content": text})),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    (chat, request_id)
}

fn events(body: &str) -> Vec<(String, Value)> {
    body.split("\n\n")
        .filter_map(|frame| {
            let event = frame.lines().find_map(|l| l.strip_prefix("event: "))?;
            let data = frame.lines().find_map(|l| l.strip_prefix("data: "))?;
            Some((event.to_owned(), serde_json::from_str(data).ok()?))
        })
        .collect()
}

fn event<'a>(all: &'a [(String, Value)], name: &str) -> Option<&'a Value> {
    all.iter().find(|(n, _)| n == name).map(|(_, v)| v)
}

fn chat_body(project: Option<&str>, text: &str, extra: Value) -> Value {
    let mut body = json!({"messages": [{"role": "user", "content": text}], "use_memory": true});
    if let Some(project) = project {
        body["project_id"] = json!(project);
    }
    for (key, value) in extra.as_object().cloned().unwrap_or_default() {
        body[key] = value;
    }
    body
}

#[sqlx::test]
async fn memory_chat_without_an_owned_project_never_reaches_the_adapter_or_the_provider(
    pool: PgPool,
) {
    let provider = provider().await;
    let state = state(pool);
    let router = app(state.clone());
    let alice = rig(&state, &router, &provider).await;
    let bob = rig(&state, &router, &provider).await;
    let mine = make_project(&router, &alice.cookie, "Mine").await;
    let other = make_project(&router, &alice.cookie, "Other").await;
    let bobs = make_project(&router, &bob.cookie, "Bob's").await;
    let (chat, request_id) = make_chat(&router, &alice.cookie, &mine, "hello").await;
    let provider_calls_before = provider.seen.0.lock().unwrap().len();

    // (project, conversation, expected status, expected code)
    let missing = Uuid::new_v4().to_string();
    // (label, project, conversation, expected status, expected code)
    type Case<'a> = (
        &'a str,
        Option<&'a str>,
        Option<&'a str>,
        StatusCode,
        &'a str,
    );
    let cases: Vec<Case> = vec![
        (
            "no project, no conversation",
            None,
            None,
            StatusCode::UNPROCESSABLE_ENTITY,
            "project_required",
        ),
        (
            "unknown project",
            Some(missing.as_str()),
            None,
            StatusCode::NOT_FOUND,
            "not_found",
        ),
        (
            "another user's project",
            Some(bobs.as_str()),
            None,
            StatusCode::NOT_FOUND,
            "not_found",
        ),
        (
            "chat of a different project",
            Some(other.as_str()),
            Some(chat.as_str()),
            StatusCode::CONFLICT,
            "scope_mismatch",
        ),
        (
            "unknown conversation",
            None,
            Some(missing.as_str()),
            StatusCode::NOT_FOUND,
            "not_found",
        ),
    ];
    for (label, project, conversation, status, code) in cases {
        let mut extra = json!({});
        if let Some(conversation) = conversation {
            extra["conversation_id"] = json!(conversation);
            extra["request_id"] = json!(request_id);
        }
        let (got, body) = send(
            &router,
            request(
                "POST",
                "/discovery/chat",
                &alice.cookie,
                Some(chat_body(project, "What should we build next?", extra)),
            ),
        )
        .await;
        assert_eq!(got, status, "{label}: {body}");
        assert!(body.contains(code), "{label}: {body}");
    }
    assert!(
        adapter_calls(&alice).is_empty(),
        "denied requests must make zero Memory adapter calls: {:?}",
        adapter_calls(&alice)
    );
    assert!(adapter_calls(&bob).is_empty());
    assert_eq!(
        provider.seen.0.lock().unwrap().len(),
        provider_calls_before,
        "and zero provider calls"
    );
}

#[sqlx::test]
async fn project_chat_recalls_only_from_the_project_namespace_never_the_legacy_one(pool: PgPool) {
    let provider = provider().await;
    let state = state(pool);
    let router = app(state.clone());
    let alice = rig(&state, &router, &provider).await;
    let project = make_project(&router, &alice.cookie, "LaunchLens").await;
    let (chat, request_id) = make_chat(
        &router,
        &alice.cookie,
        &project,
        "Should we build team workspaces?",
    )
    .await;

    // Scope derived from the saved conversation alone (no project_id sent).
    let (status, body) = send(
        &router,
        request(
            "POST",
            "/discovery/chat",
            &alice.cookie,
            Some(chat_body(
                None,
                "Should we build team workspaces?",
                json!({"conversation_id": chat, "request_id": request_id}),
            )),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let calls = adapter_calls(&alice);
    assert_eq!(calls.len(), 1, "{calls:?}");
    assert_eq!(calls[0]["action"], "recall");
    assert_eq!(calls[0]["namespace"], format!("project/{project}"));
    assert_ne!(
        calls[0]["namespace"], "bew-harness/product-discovery",
        "the account/legacy namespace is never searched"
    );
}

#[sqlx::test]
async fn an_unrelated_question_injects_nothing_and_a_related_one_discloses_exactly_what_was_injected(
    pool: PgPool,
) {
    let provider = provider().await;
    let state = state(pool);
    let router = app(state.clone());
    let alice = rig(&state, &router, &provider).await;
    let project = make_project(&router, &alice.cookie, "LaunchLens").await;
    let before = provider.seen.0.lock().unwrap().len();

    let (status, body) = send(
        &router,
        request(
            "POST",
            "/discovery/chat",
            &alice.cookie,
            Some(chat_body(
                Some(&project),
                "What is the capital of France?",
                json!({}),
            )),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let all = events(&body);
    let memory = event(&all, "memory")
        .and_then(|_| {
            all.iter()
                .rev()
                .find(|(n, _)| n == "memory")
                .map(|(_, v)| v)
        })
        .unwrap();
    assert_eq!(memory["state"], "none", "{memory}");
    assert_eq!(memory["facts"], json!([]));
    assert_eq!(
        memory["candidates"], 4,
        "the adapter did return candidates; the policy dropped them"
    );
    let sent = provider.seen.0.lock().unwrap()[before].clone();
    let roles: Vec<&str> = sent["messages"]
        .as_array()
        .unwrap()
        .iter()
        .map(|m| m["role"].as_str().unwrap())
        .collect();
    assert_eq!(roles, vec!["system", "user"], "no memory_context message");
    assert!(
        !sent.to_string().contains("LaunchLens"),
        "no stored fact text reached the provider: {sent}"
    );

    let (status, body) = send(
        &router,
        request(
            "POST",
            "/discovery/chat",
            &alice.cookie,
            Some(chat_body(
                Some(&project),
                "Should we prioritize team workspaces next?",
                json!({}),
            )),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let all = events(&body);
    let memory = all
        .iter()
        .rev()
        .find(|(n, _)| n == "memory")
        .map(|(_, v)| v)
        .unwrap();
    assert_eq!(memory["state"], "included", "{memory}");
    let shown: Vec<String> = memory["facts"]
        .as_array()
        .unwrap()
        .iter()
        .map(|f| f["text"].as_str().unwrap().to_owned())
        .collect();
    assert_eq!(shown.len(), 4);
    let sent = provider.seen.0.lock().unwrap()[before + 1].clone();
    let context = sent["messages"][1]["content"].as_str().unwrap();
    for text in &shown {
        assert!(
            context.contains(text.as_str()),
            "disclosed fact missing from the model context: {text}"
        );
    }
    assert_eq!(
        context.matches(" [saved ").count(),
        shown.len(),
        "nothing injected that was not disclosed"
    );
    assert_eq!(memory["namespace"], format!("project/{project}"));
}

#[sqlx::test]
async fn fact_saves_and_job_status_need_an_owned_project_and_report_pending_before_saved(
    pool: PgPool,
) {
    let provider = provider().await;
    let state = state(pool);
    let router = app(state.clone());
    let alice = rig(&state, &router, &provider).await;
    let bob = rig(&state, &router, &provider).await;
    let mine = make_project(&router, &alice.cookie, "Mine").await;
    let bobs = make_project(&router, &bob.cookie, "Bob's").await;
    let fact_id = Uuid::new_v4();
    let fact = |project: Option<&str>| {
        let mut body =
            json!({"facts": [{"client_id": fact_id, "text": "The priority is onboarding."}]});
        if let Some(project) = project {
            body["project_id"] = json!(project);
        }
        body
    };

    for (label, project, status) in [
        ("no project", None, StatusCode::UNPROCESSABLE_ENTITY),
        (
            "someone else's project",
            Some(bobs.as_str()),
            StatusCode::NOT_FOUND,
        ),
    ] {
        let (got, body) = send(
            &router,
            request(
                "POST",
                "/discovery/memories",
                &alice.cookie,
                Some(fact(project)),
            ),
        )
        .await;
        assert_eq!(got, status, "{label}: {body}");
        let (got, body) = send(
            &router,
            request(
                "POST",
                "/discovery/memories/status",
                &alice.cookie,
                Some(json!({"client_ids": [fact_id], "project_id": project})),
            ),
        )
        .await;
        assert_eq!(got, status, "status {label}: {body}");
    }
    assert!(
        adapter_calls(&alice).is_empty(),
        "{:?}",
        adapter_calls(&alice)
    );
    let rows: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM memory_write_jobs WHERE user_id = $1")
        .bind(alice.user_id)
        .fetch_one(&state.pool)
        .await
        .unwrap();
    assert_eq!(rows, 0, "a denied save records no write job");

    let (status, body) = send(
        &router,
        request(
            "POST",
            "/discovery/memories",
            &alice.cookie,
            Some(fact(Some(&mine))),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let job = &serde_json::from_str::<Value>(&body).unwrap()["jobs"][0];
    assert_eq!(job["state"], "pending", "accepted is not stored: {job}");
    assert!(job["blob_id"].is_null());
    let submit = adapter_calls(&alice);
    assert_eq!(submit.len(), 1);
    assert_eq!(submit[0]["namespace"], format!("project/{mine}"));

    // First status look: still pending. Second: done with a blob, only now "saved".
    let ask = json!({"client_ids": [fact_id], "project_id": mine});
    let (_, body) = send(
        &router,
        request(
            "POST",
            "/discovery/memories/status",
            &alice.cookie,
            Some(ask.clone()),
        ),
    )
    .await;
    assert_eq!(
        serde_json::from_str::<Value>(&body).unwrap()["jobs"][0]["state"],
        "pending"
    );
    let (_, body) = send(
        &router,
        request(
            "POST",
            "/discovery/memories/status",
            &alice.cookie,
            Some(ask.clone()),
        ),
    )
    .await;
    let done = serde_json::from_str::<Value>(&body).unwrap();
    assert_eq!(done["jobs"][0]["state"], "saved", "{done}");
    assert!(done["jobs"][0]["blob_id"].is_string());

    // The same job asked about under a different project is not visible.
    let other = make_project(&router, &alice.cookie, "Other").await;
    let (_, body) = send(
        &router,
        request(
            "POST",
            "/discovery/memories/status",
            &alice.cookie,
            Some(json!({"client_ids": [fact_id], "project_id": other})),
        ),
    )
    .await;
    assert_eq!(
        serde_json::from_str::<Value>(&body).unwrap()["jobs"],
        json!([])
    );
}

#[sqlx::test]
async fn the_removed_account_wide_memory_endpoints_stay_removed(pool: PgPool) {
    let provider = provider().await;
    let state = state(pool);
    let router = app(state.clone());
    let alice = rig(&state, &router, &provider).await;
    for path in ["/memory/recall", "/memory/remember"] {
        let (status, _) = send(
            &router,
            request(
                "POST",
                path,
                &alice.cookie,
                Some(json!({"query": "x", "text": "x"})),
            ),
        )
        .await;
        assert!(
            matches!(
                status,
                StatusCode::NOT_FOUND | StatusCode::METHOD_NOT_ALLOWED
            ),
            "{path} -> {status}"
        );
    }
    assert!(adapter_calls(&alice).is_empty());
}

#[sqlx::test]
async fn extraction_reports_truncation_and_bad_output_as_retryable_errors_and_never_writes(
    pool: PgPool,
) {
    let provider = provider().await;
    let state = state(pool);
    let router = app(state.clone());
    let alice = rig(&state, &router, &provider).await;
    let project = make_project(&router, &alice.cookie, "LaunchLens").await;
    // Suggestions lead to Memory writes, so they carry the same project scope as a save.
    let ask = || {
        request(
            "POST",
            "/discovery/suggest",
            &alice.cookie,
            Some(
                json!({"user_message": "LaunchLens serves solo SaaS founders.", "assistant_message": "Noted.", "project_id": project}),
            ),
        )
    };
    let good = "{\"facts\":[{\"text\":\"LaunchLens serves solo SaaS founders.\",\"category\":\"audience\"}]}";

    provider
        .scripted
        .lock()
        .unwrap()
        .push_back(completion(good, "stop"));
    let (status, body) = send(&router, ask()).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let ok = serde_json::from_str::<Value>(&body).unwrap();
    assert_eq!(ok["status"], "ok");
    assert_eq!(ok["facts"].as_array().unwrap().len(), 1);

    provider
        .scripted
        .lock()
        .unwrap()
        .push_back(completion("{\"facts\":[]}", "stop"));
    let (_, body) = send(&router, ask()).await;
    let empty = serde_json::from_str::<Value>(&body).unwrap();
    assert_eq!(empty["status"], "ok");
    assert_eq!(
        empty["facts"],
        json!([]),
        "a valid empty answer is ok and empty"
    );

    // Truncated twice: a visible, retryable failure, after exactly two calls.
    let before = provider.seen.0.lock().unwrap().len();
    provider.scripted.lock().unwrap().extend([
        completion("{\"facts\":[{\"te", "length"),
        completion("{\"facts\":[{\"te", "length"),
    ]);
    let (status, body) = send(&router, ask()).await;
    assert_eq!(status, StatusCode::BAD_GATEWAY, "{body}");
    let truncated = serde_json::from_str::<Value>(&body).unwrap();
    assert_eq!(truncated["code"], "extraction_truncated");
    assert_eq!(truncated["retryable"], true);
    assert_eq!(provider.seen.0.lock().unwrap().len() - before, 2);

    provider
        .scripted
        .lock()
        .unwrap()
        .push_back(completion("Here are some facts you might like.", "stop"));
    let (status, body) = send(&router, ask()).await;
    assert_eq!(status, StatusCode::BAD_GATEWAY, "{body}");
    assert_eq!(
        serde_json::from_str::<Value>(&body).unwrap()["code"],
        "extraction_invalid"
    );

    assert!(
        adapter_calls(&alice).is_empty(),
        "extraction never writes to or reads from Memory"
    );
    let jobs: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM memory_write_jobs")
        .fetch_one(&state.pool)
        .await
        .unwrap();
    assert_eq!(jobs, 0);
}

#[sqlx::test]
async fn suggest_without_an_owned_project_never_reaches_the_provider_or_memory(pool: PgPool) {
    let provider = provider().await;
    let state = state(pool);
    let router = app(state.clone());
    let alice = rig(&state, &router, &provider).await;
    let bob = rig(&state, &router, &provider).await;
    let mine = make_project(&router, &alice.cookie, "Mine").await;
    let bobs = make_project(&router, &bob.cookie, "Bob's").await;
    let (chat, _) = make_chat(&router, &alice.cookie, &mine, "hello").await;
    let other = make_project(&router, &alice.cookie, "Other").await;
    let missing = Uuid::new_v4().to_string();
    let provider_calls_before = provider.seen.0.lock().unwrap().len();

    let cases: Vec<(&str, Value, StatusCode, &str)> = vec![
        (
            "no project",
            json!({}),
            StatusCode::UNPROCESSABLE_ENTITY,
            "project_required",
        ),
        (
            "unknown project",
            json!({"project_id": missing}),
            StatusCode::NOT_FOUND,
            "not_found",
        ),
        (
            "another user's project",
            json!({"project_id": bobs}),
            StatusCode::NOT_FOUND,
            "not_found",
        ),
        (
            "chat of a different project",
            json!({"project_id": other, "conversation_id": chat}),
            StatusCode::CONFLICT,
            "scope_mismatch",
        ),
        (
            "unknown conversation",
            json!({"conversation_id": missing}),
            StatusCode::NOT_FOUND,
            "not_found",
        ),
    ];
    for (label, scope, status, code) in cases {
        let mut body = json!({"user_message": "LaunchLens serves solo SaaS founders.", "assistant_message": "Noted."});
        for (key, value) in scope.as_object().unwrap() {
            body[key] = value.clone();
        }
        let (got, text) = send(
            &router,
            request("POST", "/discovery/suggest", &alice.cookie, Some(body)),
        )
        .await;
        assert_eq!(got, status, "{label}: {text}");
        assert!(text.contains(code), "{label}: {text}");
    }
    assert_eq!(
        provider.seen.0.lock().unwrap().len(),
        provider_calls_before,
        "a denied suggestion must not call the model"
    );
    assert!(adapter_calls(&alice).is_empty(), "nor read or write Memory");
    assert!(adapter_calls(&bob).is_empty());
}

#[sqlx::test]
async fn the_memory_connect_endpoint_verifies_before_it_reports_verified(pool: PgPool) {
    fake_memory_env();
    let provider = provider().await;
    let state = state(pool);
    let router = app(state.clone());
    let cookie = user(&state.pool).await;
    let _ = &provider;
    // Unique per run: the fake adapter appends to one log file per account id.
    let unique = Uuid::new_v4().simple().to_string();
    let good_account = format!("0x{}{}", unique, "1".repeat(32));
    let bad_account = format!("0x{}{}bad", unique, "2".repeat(29));
    let delegate = "ab".repeat(32);

    // Before anything is connected the session says so.
    let (status, body) = send(&router, request("GET", "/memory/session", &cookie, None)).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        serde_json::from_str::<Value>(&body).unwrap()["walrus"]["status"],
        "not_connected"
    );

    // Malformed input is rejected before any adapter call.
    for (label, payload, code) in [
        (
            "short account id",
            json!({"account_id": "0x12", "delegate_key": delegate}),
            "invalid_account_id",
        ),
        (
            "owner-style key",
            json!({"account_id": good_account, "delegate_key": "not-a-key"}),
            "invalid_delegate_key",
        ),
        (
            "wrong network",
            json!({"account_id": good_account, "delegate_key": delegate, "network": "testnet"}),
            "wrong_network",
        ),
        (
            "relayer off the allowlist",
            json!({"account_id": good_account, "delegate_key": delegate, "server_url": "https://evil.example"}),
            "relayer_not_allowed",
        ),
    ] {
        let (got, text) = send(
            &router,
            request("POST", "/memory/walrus", &cookie, Some(payload)),
        )
        .await;
        assert_eq!(got, StatusCode::UNPROCESSABLE_ENTITY, "{label}: {text}");
        assert!(text.contains(code), "{label}: {text}");
    }
    let (_, body) = send(&router, request("GET", "/memory/session", &cookie, None)).await;
    assert_eq!(
        serde_json::from_str::<Value>(&body).unwrap()["walrus"]["status"],
        "not_connected"
    );

    // The adapter rejects an unknown account: the app must not call it verified.
    let (_, body) = send(
        &router,
        request(
            "POST",
            "/memory/walrus",
            &cookie,
            Some(json!({"account_id": bad_account, "delegate_key": delegate})),
        ),
    )
    .await;
    let value: Value = serde_json::from_str(&body).unwrap_or(Value::Null);
    assert_ne!(value["walrus"]["status"], "verified", "{body}");
    assert!(
        !body.contains(&delegate),
        "the delegate key must never be echoed: {body}"
    );
    let (_, body) = send(&router, request("GET", "/memory/session", &cookie, None)).await;
    assert_ne!(
        serde_json::from_str::<Value>(&body).unwrap()["walrus"]["status"],
        "verified",
        "{body}"
    );

    // A valid account verifies through the adapter, and the key stays server-side.
    let (status, body) = send(
        &router,
        request(
            "POST",
            "/memory/walrus",
            &cookie,
            Some(json!({"account_id": good_account, "delegate_key": delegate})),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(!body.contains(&delegate), "{body}");
    let (_, body) = send(&router, request("GET", "/memory/session", &cookie, None)).await;
    let session: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(session["walrus"]["status"], "verified", "{body}");
    assert_eq!(session["walrus"]["account_id"], good_account);
    assert!(!body.contains(&delegate), "{body}");

    let log = std::env::temp_dir()
        .join("memwal-fake-logs")
        .join(format!("{good_account}.jsonl"));
    let calls: Vec<Value> = std::fs::read_to_string(log)
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    assert_eq!(
        calls
            .iter()
            .filter(|call| call["action"] == "verify")
            .count(),
        1
    );
    assert!(
        calls.iter().all(|call| call["action"] == "verify"),
        "connecting never writes: {calls:?}"
    );
}

#[sqlx::test]
async fn a_stored_model_key_is_only_reused_for_the_host_it_was_saved_for(pool: PgPool) {
    let provider = provider().await;
    let state = state(pool);
    let router = app(state.clone());
    let alice = rig(&state, &router, &provider).await;
    let save = |base: String, key: Value| {
        request(
            "POST",
            "/model-proxy",
            &alice.cookie,
            Some(
                json!({"connection_name": "Mock", "base_url": base, "api_key": key, "model_id": "mock-model", "test": false}),
            ),
        )
    };
    // rig() already saved a key for the mock provider host.
    let same_host_other_path = format!("{}/v1/", provider.base);
    let (status, body) = send(&router, save(same_host_other_path, Value::Null)).await;
    assert_eq!(status, StatusCode::OK, "reuse on the saved host: {body}");

    let (status, body) = send(
        &router,
        save("https://other.example.com/v1".to_owned(), Value::Null),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert!(body.contains("key_host_mismatch"), "{body}");
    let (_, body) = send(&router, request("GET", "/model-proxy", &alice.cookie, None)).await;
    assert!(
        body.contains(&provider.base),
        "a refused save leaves the saved URL untouched: {body}"
    );

    // Discovery follows the same rule and never echoes the key.
    let (status, body) = send(
        &router,
        request(
            "POST",
            "/model-proxy/models",
            &alice.cookie,
            Some(json!({"base_url": "https://other.example.com/v1"})),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert!(body.contains("key_host_mismatch"), "{body}");
    assert!(!body.contains(KEY));
}

#[sqlx::test]
async fn a_run_uses_exactly_the_requested_revision_and_a_tool_less_agent_never_recalls(
    pool: PgPool,
) {
    let provider = provider().await;
    let state = state(pool);
    let router = app(state.clone());
    let alice = rig(&state, &router, &provider).await;
    let project = make_project(&router, &alice.cookie, "LaunchLens").await;
    let save = |request_id: &str, text: &str, tools: Value| {
        request(
            "POST",
            "/builder-agents",
            &alice.cookie,
            Some(
                json!({"agent_key": "pin-agent", "name": "Pin", "instructions": text, "request_id": request_id, "project_id": project, "tools": tools}),
            ),
        )
    };
    let (status, body) = send(
        &router,
        save("pin-rev-one-aaa", ALPHA, json!(["memwal_recall"])),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    assert_eq!(serde_json::from_str::<Value>(&body).unwrap()["name"], "Pin");
    let (status, body) = send(&router, save("pin-rev-two-bbb", BETA, json!([]))).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    assert_eq!(serde_json::from_str::<Value>(&body).unwrap()["revision"], 2);

    // Revision 1 explicitly: ALPHA reaches the provider and recall is allowed.
    let before = provider.seen.0.lock().unwrap().len();
    let (status, body) = send(
        &router,
        request(
            "POST",
            "/discovery/chat",
            &alice.cookie,
            Some(chat_body(
                Some(&project),
                "Should we prioritize team workspaces next?",
                json!({"agent_key": "pin-agent", "agent_revision": 1}),
            )),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let sent = provider.seen.0.lock().unwrap()[before].clone();
    assert_eq!(sent["messages"][0]["content"], ALPHA);
    assert_eq!(
        event(&events(&body), "request").unwrap()["agent"]["revision"],
        1
    );
    assert_eq!(adapter_calls(&alice).len(), 1);

    // Newest (revision 2) saved with no tools: BETA is sent, recall never runs.
    let before = provider.seen.0.lock().unwrap().len();
    let (status, body) = send(
        &router,
        request(
            "POST",
            "/discovery/chat",
            &alice.cookie,
            Some(chat_body(
                Some(&project),
                "Should we prioritize team workspaces next?",
                json!({"agent_key": "pin-agent"}),
            )),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let sent = provider.seen.0.lock().unwrap()[before].clone();
    assert_eq!(sent["messages"][0]["content"], BETA);
    assert_eq!(
        adapter_calls(&alice).len(),
        1,
        "the tool-less revision made no further adapter call"
    );
    let all = events(&body);
    let memory = all
        .iter()
        .find(|(n, _)| n == "memory")
        .map(|(_, v)| v)
        .unwrap();
    assert_eq!(memory["state"], "off");
    assert_eq!(memory["reason"], "agent_recall_disabled");

    // A revision that does not exist runs nothing.
    let before = provider.seen.0.lock().unwrap().len();
    let (status, _) = send(
        &router,
        request(
            "POST",
            "/discovery/chat",
            &alice.cookie,
            Some(chat_body(
                Some(&project),
                "hi",
                json!({"agent_key": "pin-agent", "agent_revision": 9}),
            )),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(provider.seen.0.lock().unwrap().len(), before);
}

#[sqlx::test]
async fn the_server_keeps_a_finished_reply_and_never_downgrades_it_to_interrupted(pool: PgPool) {
    let provider = provider().await;
    let state = state(pool);
    let router = app(state.clone());
    let alice = rig(&state, &router, &provider).await;
    let project = make_project(&router, &alice.cookie, "LaunchLens").await;
    let (chat, request_id) = make_chat(&router, &alice.cookie, &project, "Say hello.").await;
    let chat_id: Uuid = chat.parse().unwrap();

    // Partial text from a chat that was switched away from is kept, as interrupted.
    crate::conversations::store_reply(
        &state,
        alice.user_id,
        chat_id,
        &request_id,
        "Partial rep",
        "interrupted",
    )
    .await
    .unwrap();
    let (_, body) = send(
        &router,
        request(
            "GET",
            &format!("/conversations/{chat}"),
            &alice.cookie,
            None,
        ),
    )
    .await;
    let stored = serde_json::from_str::<Value>(&body).unwrap();
    let reply = stored["messages"]
        .as_array()
        .unwrap()
        .iter()
        .find(|m| m["role"] == "assistant")
        .unwrap();
    assert_eq!(reply["content"], "Partial rep");
    assert_eq!(reply["status"], "interrupted");

    // A completed generation for the same turn replaces it; one row, same turn.
    let (status, body) = send(
        &router,
        request(
            "POST",
            "/discovery/chat",
            &alice.cookie,
            Some(chat_body(
                Some(&project),
                "Say hello.",
                json!({"conversation_id": chat, "request_id": request_id, "use_memory": false}),
            )),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (_, body) = send(
        &router,
        request(
            "GET",
            &format!("/conversations/{chat}"),
            &alice.cookie,
            None,
        ),
    )
    .await;
    let stored = serde_json::from_str::<Value>(&body).unwrap();
    let replies: Vec<&Value> = stored["messages"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|m| m["role"] == "assistant")
        .collect();
    assert_eq!(replies.len(), 1, "retrying a turn never duplicates it");
    assert_eq!(replies[0]["content"], "Hello there");
    assert_eq!(replies[0]["status"], "complete");

    // A late interrupted write cannot downgrade the finished reply.
    crate::conversations::store_reply(
        &state,
        alice.user_id,
        chat_id,
        &request_id,
        "Hel",
        "interrupted",
    )
    .await
    .unwrap();
    let (_, body) = send(
        &router,
        request(
            "GET",
            &format!("/conversations/{chat}"),
            &alice.cookie,
            None,
        ),
    )
    .await;
    let stored = serde_json::from_str::<Value>(&body).unwrap();
    let reply = stored["messages"]
        .as_array()
        .unwrap()
        .iter()
        .find(|m| m["role"] == "assistant")
        .unwrap();
    assert_eq!(reply["status"], "complete");
    assert_eq!(reply["content"], "Hello there");

    // Another user's conversation cannot be written through this path.
    let bob = rig(&state, &router, &provider).await;
    assert!(
        crate::conversations::store_reply(
            &state,
            bob.user_id,
            chat_id,
            &request_id,
            "x",
            "interrupted"
        )
        .await
        .is_err()
    );
}
