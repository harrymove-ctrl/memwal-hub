//! Server-owned product projects and their chats.
//!
//! The browser never supplies a user id. A project or chat the caller cannot
//! access is a 404 with no row contents. Archiving a chat only hides it from
//! the default list; it does not delete Walrus memories.

use axum::{
    Json,
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::FromRow;
use uuid::Uuid;

use crate::{
    AppState, auth::optional_authenticated_user_id, memory::json_error, model_proxy::foreign_origin,
};

const MAX_NAME: usize = 80;
const MAX_CONTENT: usize = 8_000;
const PAGE: i64 = 30;

#[derive(Debug, Deserialize)]
pub struct CreateProject {
    pub name: String,
    pub request_id: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateConversation {
    pub request_id: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateConversation {
    pub title: Option<String>,
    pub archived: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct AppendUser {
    pub request_id: String,
    pub content: String,
}

#[derive(Debug, Deserialize)]
pub struct AppendReply {
    pub request_id: String,
    pub content: String,
    pub status: String,
}

#[derive(Debug, Deserialize)]
pub struct ListQuery {
    pub cursor: Option<String>,
}

#[derive(Debug, Serialize, FromRow)]
pub struct ProjectRow {
    pub id: Uuid,
    pub name: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, FromRow)]
pub struct ConversationRow {
    pub id: Uuid,
    pub project_id: Uuid,
    pub title: String,
    pub archived_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, FromRow)]
struct MessageRow {
    id: Uuid,
    request_id: String,
    role: String,
    content: String,
    status: String,
    sequence: i32,
    created_at: DateTime<Utc>,
}

/// First line of the user's message, capped. Never calls a model.
pub fn chat_title(message: &str) -> String {
    let line = message.split_whitespace().collect::<Vec<_>>().join(" ");
    let count = line.chars().count();
    if count == 0 {
        return "New chat".to_owned();
    }
    if count <= 60 {
        return line;
    }
    let mut title: String = line.chars().take(59).collect();
    title.push('…');
    title
}

fn clean_label(value: &str, empty: &'static str) -> Result<String, &'static str> {
    let name = value.trim();
    if name.is_empty() || name.chars().count() > MAX_NAME || name.chars().any(char::is_control) {
        return Err(empty);
    }
    Ok(name.to_owned())
}

fn clean_request_id(value: &str) -> Result<String, &'static str> {
    let id = value.trim();
    if (8..=80).contains(&id.len())
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        Ok(id.to_owned())
    } else {
        Err("The request id must be 8 to 80 letters, numbers, hyphens or underscores.")
    }
}

fn clean_content(value: &str) -> Result<String, &'static str> {
    let content = value.trim();
    if content.is_empty() || content.chars().count() > MAX_CONTENT {
        return Err("A message must be between 1 and 8000 characters.");
    }
    Ok(content.to_owned())
}

async fn signed_in(
    state: &AppState,
    jar: &axum_extra::extract::CookieJar,
) -> Result<Uuid, Response> {
    match optional_authenticated_user_id(state, jar).await {
        Ok(Some(user_id)) => Ok(user_id),
        Ok(None) => Err(json_error(
            StatusCode::UNAUTHORIZED,
            "sign_in_required",
            "Sign in to use projects and chats.",
        )),
        Err(_) => Err(json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "backend_error",
            "The workspace session could not be read.",
        )),
    }
}

fn not_found() -> Response {
    json_error(
        StatusCode::NOT_FOUND,
        "not_found",
        "That project or chat was not found.",
    )
}

pub async fn list_projects(
    State(state): State<AppState>,
    jar: axum_extra::extract::CookieJar,
    headers: HeaderMap,
) -> Response {
    if let Some(response) = foreign_origin(&state, &headers) {
        return response;
    }
    let user_id = match signed_in(&state, &jar).await {
        Ok(user_id) => user_id,
        Err(response) => return response,
    };
    match sqlx::query_as::<_, ProjectRow>(
        "SELECT id, name, created_at, updated_at FROM projects WHERE user_id = $1 ORDER BY updated_at DESC, id DESC",
    )
    .bind(user_id)
    .fetch_all(&state.pool)
    .await
    {
        Ok(projects) => Json(projects).into_response(),
        Err(_) => json_error(StatusCode::INTERNAL_SERVER_ERROR, "backend_error", "Projects could not be loaded."),
    }
}

pub async fn create_project(
    State(state): State<AppState>,
    jar: axum_extra::extract::CookieJar,
    headers: HeaderMap,
    Json(body): Json<CreateProject>,
) -> Response {
    if let Some(response) = foreign_origin(&state, &headers) {
        return response;
    }
    let user_id = match signed_in(&state, &jar).await {
        Ok(user_id) => user_id,
        Err(response) => return response,
    };
    let name = match clean_label(
        &body.name,
        "Use a project name between 1 and 80 characters.",
    ) {
        Ok(name) => name,
        Err(message) => {
            return json_error(StatusCode::UNPROCESSABLE_ENTITY, "invalid_project", message);
        }
    };
    let request_id = match clean_request_id(&body.request_id) {
        Ok(id) => id,
        Err(message) => {
            return json_error(StatusCode::UNPROCESSABLE_ENTITY, "invalid_request", message);
        }
    };
    let id = Uuid::new_v4();
    let namespace = format!("project/{id}");
    let inserted = sqlx::query_as::<_, ProjectRow>(
        "INSERT INTO projects (id, user_id, name, creation_request_id, memory_namespace)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (user_id, creation_request_id) DO NOTHING
         RETURNING id, name, created_at, updated_at",
    )
    .bind(id)
    .bind(user_id)
    .bind(&name)
    .bind(&request_id)
    .bind(&namespace)
    .fetch_optional(&state.pool)
    .await;
    match inserted {
        Ok(Some(project)) => (StatusCode::CREATED, Json(project)).into_response(),
        Ok(None) => match sqlx::query_as::<_, ProjectRow>(
            "SELECT id, name, created_at, updated_at FROM projects WHERE user_id = $1 AND creation_request_id = $2",
        )
        .bind(user_id)
        .bind(&request_id)
        .fetch_one(&state.pool)
        .await
        {
            Ok(project) => Json(project).into_response(),
            Err(_) => json_error(StatusCode::INTERNAL_SERVER_ERROR, "backend_error", "The project could not be saved."),
        },
        Err(_) => json_error(StatusCode::INTERNAL_SERVER_ERROR, "backend_error", "The project could not be saved."),
    }
}

async fn owned_project(state: &AppState, user_id: Uuid, project_id: Uuid) -> Result<(), Response> {
    match sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM projects WHERE id = $1 AND user_id = $2)",
    )
    .bind(project_id)
    .bind(user_id)
    .fetch_optional(&state.pool)
    .await
    {
        Ok(Some(true)) => Ok(()),
        Ok(Some(false) | None) => Err(not_found()),
        Err(_) => Err(json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "backend_error",
            "The project could not be read.",
        )),
    }
}
/// The Walrus scope a memory operation is allowed to touch, resolved on the
/// server from records the caller owns. It is never the account-level
/// connection namespace: a request with no resolvable project has no scope and
/// must not reach the Memory adapter at all.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MemoryScope {
    pub project_id: Uuid,
    pub namespace: String,
    /// Set when the scope was derived from a saved conversation.
    pub conversation_id: Option<Uuid>,
}

/// Resolves the project scope for a memory operation.
///
/// * a conversation (when given) must belong to the caller; its project is the
///   scope, and a different `project_id` is a 409 `scope_mismatch`;
/// * otherwise `project_id` must be a project the caller owns;
/// * neither given is a 422 `project_required`, never an account-wide scope;
/// * anything not owned is a 404 with no row contents.
pub async fn resolve_scope(
    state: &AppState,
    user_id: Uuid,
    project_id: Option<Uuid>,
    conversation_id: Option<Uuid>,
) -> Result<MemoryScope, Response> {
    let derived = match conversation_id {
        Some(conversation_id) => {
            match sqlx::query_scalar::<_, Uuid>(
                "SELECT project_id FROM conversations WHERE id = $1 AND user_id = $2",
            )
            .bind(conversation_id)
            .bind(user_id)
            .fetch_optional(&state.pool)
            .await
            {
                Ok(Some(owner_project)) => Some(owner_project),
                Ok(None) => return Err(not_found()),
                Err(_) => {
                    return Err(json_error(
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "backend_error",
                        "The chat memory scope could not be read.",
                    ));
                }
            }
        }
        None => None,
    };
    if let (Some(derived), Some(given)) = (derived, project_id)
        && derived != given
    {
        return Err(json_error(
            StatusCode::CONFLICT,
            "scope_mismatch",
            "That chat belongs to a different project. Nothing was read or written.",
        ));
    }
    let Some(project_id) = derived.or(project_id) else {
        return Err(json_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "project_required",
            "Choose a project first. Memory is scoped to a project, so nothing was read or written.",
        ));
    };
    match sqlx::query_scalar::<_, String>(
        "SELECT memory_namespace FROM projects WHERE id = $1 AND user_id = $2",
    )
    .bind(project_id)
    .bind(user_id)
    .fetch_optional(&state.pool)
    .await
    {
        Ok(Some(namespace)) => Ok(MemoryScope {
            project_id,
            namespace,
            conversation_id,
        }),
        Ok(None) => Err(not_found()),
        Err(_) => Err(json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "backend_error",
            "The project memory scope could not be read.",
        )),
    }
}

/// How a second write for the same assistant turn is merged. The browser and
/// the server can both write a reply (the server keeps a partial reply when
/// the browser disconnects). A complete reply is never downgraded, and an
/// unfinished reply only grows: a late, shorter write cannot erase text.
const MERGE_REPLY: &str = "ON CONFLICT (conversation_id, request_id, role) DO UPDATE
         SET content = CASE
                 WHEN conversation_messages.status = 'complete' AND EXCLUDED.status <> 'complete' THEN conversation_messages.content
                 WHEN EXCLUDED.status = 'complete' THEN EXCLUDED.content
                 WHEN length(EXCLUDED.content) >= length(conversation_messages.content) THEN EXCLUDED.content
                 ELSE conversation_messages.content
             END,
             status = CASE
                 WHEN conversation_messages.status = 'complete' THEN 'complete'
                 ELSE EXCLUDED.status
             END";

/// Stores the assistant side of a turn from the server, so a reply that was
/// being generated when the browser disconnected (tab closed, chat switched)
/// is kept with its own conversation as `interrupted` instead of being lost.
/// The row is keyed by the same request id as the user turn, so a later
/// browser `append_reply` for the same turn updates it rather than duplicating.
pub async fn store_reply(
    state: &AppState,
    user_id: Uuid,
    conversation_id: Uuid,
    request_id: &str,
    content: &str,
    status: &str,
) -> Result<(), ()> {
    let content: String = content.trim().chars().take(MAX_CONTENT).collect();
    let owned = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM conversation_messages m JOIN conversations c ON c.id = m.conversation_id
         WHERE m.conversation_id = $1 AND c.user_id = $2 AND m.request_id = $3 AND m.role = 'user')",
    )
    .bind(conversation_id)
    .bind(user_id)
    .bind(request_id)
    .fetch_one(&state.pool)
    .await
    .map_err(|_| ())?;
    if !owned {
        return Err(());
    }
    sqlx::query(&format!(
        "INSERT INTO conversation_messages (id, conversation_id, request_id, role, content, status, sequence)
         VALUES ($1, $2, $3, 'assistant', $4, $5,
                 (SELECT COALESCE(MAX(sequence), 0) + 1 FROM conversation_messages WHERE conversation_id = $2))
         {MERGE_REPLY}"
    ))
    .bind(Uuid::new_v4())
    .bind(conversation_id)
    .bind(request_id)
    .bind(&content)
    .bind(status)
    .execute(&state.pool)
    .await
    .map(|_| ())
    .map_err(|_| ())
}

pub async fn list_conversations(
    State(state): State<AppState>,
    jar: axum_extra::extract::CookieJar,
    headers: HeaderMap,
    Path(project_id): Path<Uuid>,
    Query(query): Query<ListQuery>,
) -> Response {
    if let Some(response) = foreign_origin(&state, &headers) {
        return response;
    }
    let user_id = match signed_in(&state, &jar).await {
        Ok(user_id) => user_id,
        Err(response) => return response,
    };
    if let Err(response) = owned_project(&state, user_id, project_id).await {
        return response;
    }
    let cursor = query.cursor.as_deref().and_then(parse_cursor);
    let rows = sqlx::query_as::<_, ConversationRow>(
        "SELECT id, project_id, title, archived_at, created_at, updated_at
         FROM conversations
         WHERE project_id = $1 AND user_id = $2 AND archived_at IS NULL
           AND ($3::timestamptz IS NULL OR (updated_at, id) < ($3, $4))
         ORDER BY updated_at DESC, id DESC
         LIMIT $5",
    )
    .bind(project_id)
    .bind(user_id)
    .bind(cursor.map(|(time, _)| time))
    .bind(cursor.map(|(_, id)| id))
    .bind(PAGE)
    .fetch_all(&state.pool)
    .await;
    match rows {
        Ok(conversations) => {
            let next = conversations
                .last()
                .map(|row| format!("{}|{}", row.updated_at.to_rfc3339(), row.id));
            Json(json!({ "conversations": conversations, "next_cursor": next.filter(|_| conversations.len() as i64 == PAGE) })).into_response()
        }
        Err(_) => json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "backend_error",
            "Chats could not be loaded.",
        ),
    }
}

fn parse_cursor(value: &str) -> Option<(DateTime<Utc>, Uuid)> {
    let (time, id) = value.split_once('|')?;
    Some((time.parse().ok()?, id.parse().ok()?))
}

pub async fn create_conversation(
    State(state): State<AppState>,
    jar: axum_extra::extract::CookieJar,
    headers: HeaderMap,
    Path(project_id): Path<Uuid>,
    Json(body): Json<CreateConversation>,
) -> Response {
    if let Some(response) = foreign_origin(&state, &headers) {
        return response;
    }
    let user_id = match signed_in(&state, &jar).await {
        Ok(user_id) => user_id,
        Err(response) => return response,
    };
    if let Err(response) = owned_project(&state, user_id, project_id).await {
        return response;
    }
    let request_id = match clean_request_id(&body.request_id) {
        Ok(id) => id,
        Err(message) => {
            return json_error(StatusCode::UNPROCESSABLE_ENTITY, "invalid_request", message);
        }
    };
    let id = Uuid::new_v4();
    let inserted = sqlx::query_as::<_, ConversationRow>(
        "INSERT INTO conversations (id, project_id, user_id, title, creation_request_id)
         VALUES ($1, $2, $3, 'New chat', $4)
         ON CONFLICT (user_id, creation_request_id) DO NOTHING
         RETURNING id, project_id, title, archived_at, created_at, updated_at",
    )
    .bind(id)
    .bind(project_id)
    .bind(user_id)
    .bind(&request_id)
    .fetch_optional(&state.pool)
    .await;
    match inserted {
        Ok(Some(chat)) => (StatusCode::CREATED, Json(chat)).into_response(),
        Ok(None) => match sqlx::query_as::<_, ConversationRow>(
            "SELECT id, project_id, title, archived_at, created_at, updated_at
             FROM conversations WHERE user_id = $1 AND creation_request_id = $2",
        )
        .bind(user_id)
        .bind(&request_id)
        .fetch_optional(&state.pool)
        .await
        {
            Ok(Some(chat)) if chat.project_id == project_id => Json(chat).into_response(),
            Ok(Some(_)) => json_error(
                StatusCode::CONFLICT,
                "request_reused",
                "That request id already belongs to another project.",
            ),
            Ok(None) => json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "backend_error",
                "The chat could not be created.",
            ),
            Err(_) => json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "backend_error",
                "The chat could not be created.",
            ),
        },
        Err(_) => json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "backend_error",
            "The chat could not be created.",
        ),
    }
}

pub async fn get_conversation(
    State(state): State<AppState>,
    jar: axum_extra::extract::CookieJar,
    headers: HeaderMap,
    Path(conversation_id): Path<Uuid>,
) -> Response {
    if let Some(response) = foreign_origin(&state, &headers) {
        return response;
    }
    let user_id = match signed_in(&state, &jar).await {
        Ok(user_id) => user_id,
        Err(response) => return response,
    };
    let chat = match sqlx::query_as::<_, ConversationRow>(
        "SELECT id, project_id, title, archived_at, created_at, updated_at
         FROM conversations WHERE id = $1 AND user_id = $2",
    )
    .bind(conversation_id)
    .bind(user_id)
    .fetch_optional(&state.pool)
    .await
    {
        Ok(Some(chat)) => chat,
        Ok(None) => return not_found(),
        Err(_) => {
            return json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "backend_error",
                "The chat could not be loaded.",
            );
        }
    };
    let messages = match sqlx::query_as::<_, MessageRow>(
        "SELECT id, request_id, role, content, status, sequence, created_at
         FROM conversation_messages WHERE conversation_id = $1 ORDER BY sequence ASC",
    )
    .bind(conversation_id)
    .fetch_all(&state.pool)
    .await
    {
        Ok(messages) => messages,
        Err(_) => {
            return json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "backend_error",
                "The chat could not be loaded.",
            );
        }
    };
    Json(json!({
        "conversation": chat,
        "messages": messages,
        "history": "saved"
    }))
    .into_response()
}

pub async fn update_conversation(
    State(state): State<AppState>,
    jar: axum_extra::extract::CookieJar,
    headers: HeaderMap,
    Path(conversation_id): Path<Uuid>,
    Json(body): Json<UpdateConversation>,
) -> Response {
    if let Some(response) = foreign_origin(&state, &headers) {
        return response;
    }
    let user_id = match signed_in(&state, &jar).await {
        Ok(user_id) => user_id,
        Err(response) => return response,
    };
    let title = match body.title.as_deref() {
        Some(title) => match clean_label(title, "Use a title between 1 and 80 characters.") {
            Ok(title) => Some(title),
            Err(message) => {
                return json_error(StatusCode::UNPROCESSABLE_ENTITY, "invalid_title", message);
            }
        },
        None => None,
    };
    let updated = sqlx::query_as::<_, ConversationRow>(
        "UPDATE conversations
         SET title = COALESCE($3, title),
             title_edited = title_edited OR $3 IS NOT NULL,
             archived_at = CASE
                 WHEN $4::bool IS NULL THEN archived_at
                 WHEN $4 THEN COALESCE(archived_at, NOW())
                 ELSE NULL
             END,
             updated_at = NOW()
         WHERE id = $1 AND user_id = $2
         RETURNING id, project_id, title, archived_at, created_at, updated_at",
    )
    .bind(conversation_id)
    .bind(user_id)
    .bind(&title)
    .bind(body.archived)
    .fetch_optional(&state.pool)
    .await;
    match updated {
        Ok(Some(chat)) => Json(json!({
            "conversation": chat,
            "memory_retained": true,
            "note": "Archiving a chat hides it here. It does not delete Walrus memories."
        }))
        .into_response(),
        Ok(None) => not_found(),
        Err(_) => json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "backend_error",
            "The chat could not be updated.",
        ),
    }
}

pub async fn append_user(
    State(state): State<AppState>,
    jar: axum_extra::extract::CookieJar,
    headers: HeaderMap,
    Path(conversation_id): Path<Uuid>,
    Json(body): Json<AppendUser>,
) -> Response {
    if let Some(response) = foreign_origin(&state, &headers) {
        return response;
    }
    let user_id = match signed_in(&state, &jar).await {
        Ok(user_id) => user_id,
        Err(response) => return response,
    };
    let request_id = match clean_request_id(&body.request_id) {
        Ok(id) => id,
        Err(message) => {
            return json_error(StatusCode::UNPROCESSABLE_ENTITY, "invalid_request", message);
        }
    };
    let content = match clean_content(&body.content) {
        Ok(content) => content,
        Err(message) => {
            return json_error(StatusCode::UNPROCESSABLE_ENTITY, "invalid_message", message);
        }
    };
    if owned_conversation(&state, user_id, conversation_id)
        .await
        .is_err()
    {
        return not_found();
    }
    let mut tx = match state.pool.begin().await {
        Ok(tx) => tx,
        Err(_) => {
            return json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "backend_error",
                "The message could not be saved.",
            );
        }
    };
    let existing = sqlx::query_as::<_, MessageRow>(
        "SELECT id, request_id, role, content, status, sequence, created_at
         FROM conversation_messages WHERE conversation_id = $1 AND request_id = $2 AND role = 'user'",
    )
    .bind(conversation_id)
    .bind(&request_id)
    .fetch_optional(&mut *tx)
    .await;
    let message = match existing {
        Ok(Some(message)) => message,
        Ok(None) => {
            let sequence: i32 = match sqlx::query_scalar("SELECT COALESCE(MAX(sequence), 0) + 1 FROM conversation_messages WHERE conversation_id = $1")
                .bind(conversation_id)
                .fetch_one(&mut *tx)
                .await
            {
                Ok(sequence) => sequence,
                Err(_) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, "backend_error", "The message could not be saved."),
            };
            match sqlx::query_as::<_, MessageRow>(
                "INSERT INTO conversation_messages (id, conversation_id, request_id, role, content, status, sequence)
                 VALUES ($1, $2, $3, 'user', $4, 'complete', $5)
                 RETURNING id, request_id, role, content, status, sequence, created_at",
            )
            .bind(Uuid::new_v4())
            .bind(conversation_id)
            .bind(&request_id)
            .bind(&content)
            .bind(sequence)
            .fetch_one(&mut *tx)
            .await
            {
                Ok(message) => message,
                Err(_) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, "backend_error", "The message could not be saved."),
            }
        }
        Err(_) => {
            return json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "backend_error",
                "The message could not be saved.",
            );
        }
    };
    let title = chat_title(&message.content);
    if sqlx::query(
        "UPDATE conversations
         SET title = CASE WHEN title_edited OR title <> 'New chat' THEN title ELSE $2 END,
             updated_at = NOW()
         WHERE id = $1 AND user_id = $3",
    )
    .bind(conversation_id)
    .bind(&title)
    .bind(user_id)
    .execute(&mut *tx)
    .await
    .is_err()
    {
        return json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "backend_error",
            "The message could not be saved.",
        );
    }
    if tx.commit().await.is_err() {
        return json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "backend_error",
            "The message could not be saved.",
        );
    }
    Json(json!({ "message": message, "history": "saved" })).into_response()
}

pub async fn append_reply(
    State(state): State<AppState>,
    jar: axum_extra::extract::CookieJar,
    headers: HeaderMap,
    Path(conversation_id): Path<Uuid>,
    Json(body): Json<AppendReply>,
) -> Response {
    if let Some(response) = foreign_origin(&state, &headers) {
        return response;
    }
    let user_id = match signed_in(&state, &jar).await {
        Ok(user_id) => user_id,
        Err(response) => return response,
    };
    let request_id = match clean_request_id(&body.request_id) {
        Ok(id) => id,
        Err(message) => {
            return json_error(StatusCode::UNPROCESSABLE_ENTITY, "invalid_request", message);
        }
    };
    if !matches!(body.status.as_str(), "complete" | "interrupted" | "error") {
        return json_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_status",
            "Reply status must be complete, interrupted or error.",
        );
    }
    let content = body.content.trim();
    if content.chars().count() > MAX_CONTENT {
        return json_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_message",
            "A message must be between 1 and 8000 characters.",
        );
    }
    if owned_conversation(&state, user_id, conversation_id)
        .await
        .is_err()
    {
        return not_found();
    }
    let user_exists = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM conversation_messages WHERE conversation_id = $1 AND request_id = $2 AND role = 'user')",
    )
    .bind(conversation_id)
    .bind(&request_id)
    .fetch_optional(&state.pool)
    .await;
    if !matches!(user_exists, Ok(Some(true))) {
        return json_error(
            StatusCode::CONFLICT,
            "missing_user_turn",
            "Save the user message before its reply.",
        );
    }
    let sequence: i32 = match sqlx::query_scalar(
        "SELECT COALESCE(MAX(sequence), 0) + 1 FROM conversation_messages WHERE conversation_id = $1",
    )
    .bind(conversation_id)
    .fetch_one(&state.pool)
    .await
    {
        Ok(sequence) => sequence,
        Err(_) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, "backend_error", "The reply could not be saved."),
    };
    let saved = sqlx::query_as::<_, MessageRow>(&format!(
        "INSERT INTO conversation_messages (id, conversation_id, request_id, role, content, status, sequence)
         VALUES ($1, $2, $3, 'assistant', $4, $5, $6)
         {MERGE_REPLY}
         RETURNING id, request_id, role, content, status, sequence, created_at"
    ))
    .bind(Uuid::new_v4())
    .bind(conversation_id)
    .bind(&request_id)
    .bind(content)
    .bind(&body.status)
    .bind(sequence)
    .fetch_one(&state.pool)
    .await;
    match saved {
        Ok(message) => {
            let _ = sqlx::query(
                "UPDATE conversations SET updated_at = NOW() WHERE id = $1 AND user_id = $2",
            )
            .bind(conversation_id)
            .bind(user_id)
            .execute(&state.pool)
            .await;
            Json(json!({ "message": message, "history": "saved" })).into_response()
        }
        Err(_) => json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "backend_error",
            "The reply could not be saved.",
        ),
    }
}

async fn owned_conversation(
    state: &AppState,
    user_id: Uuid,
    conversation_id: Uuid,
) -> Result<(), ()> {
    sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM conversations WHERE id = $1 AND user_id = $2)",
    )
    .bind(conversation_id)
    .bind(user_id)
    .fetch_optional(&state.pool)
    .await
    .ok()
    .flatten()
    .filter(|found| *found)
    .map(|_| ())
    .ok_or(())
}

#[cfg(test)]
mod tests {
    use super::chat_title;

    #[test]
    fn titles_come_from_the_first_message_without_a_model_call() {
        assert_eq!(chat_title("   "), "New chat");
        assert_eq!(
            chat_title("Help me\nvalidate a product idea"),
            "Help me validate a product idea"
        );
        let long = "a".repeat(80);
        assert_eq!(chat_title(&long).chars().count(), 60);
        assert!(chat_title(&long).ends_with('…'));
    }
}
