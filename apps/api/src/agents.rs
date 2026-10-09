//! Saved assistant instructions. The browser does not choose the user, and a
//! missing revision is not a fabricated default configuration.

use axum::{
    Json,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

use crate::{
    AppState, auth::optional_authenticated_user_id, memory::json_error, model_proxy::foreign_origin,
};

#[derive(Debug, Deserialize)]
pub struct SaveRevision {
    pub agent_key: String,
    pub name: String,
    pub instructions: String,
    pub request_id: String,
    #[serde(default)]
    pub project_id: Option<Uuid>,
    #[serde(default)]
    pub tools: Vec<String>,
}

const ALLOWED_TOOLS: &[&str] = &["memwal_recall", "memwal_remember"];

pub fn unknown_tools(tools: &[String]) -> Vec<String> {
    tools
        .iter()
        .filter(|tool| !ALLOWED_TOOLS.contains(&tool.as_str()))
        .cloned()
        .collect()
}

fn clean_key(value: &str) -> Result<String, &'static str> {
    let key = value.trim();
    if (1..=80).contains(&key.len())
        && key
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        Ok(key.to_owned())
    } else {
        Err("Use an agent id of 1 to 80 letters, numbers, hyphens or underscores.")
    }
}

fn clean_text(value: &str, max: usize, empty: &'static str) -> Result<String, &'static str> {
    let text = value.trim();
    if text.is_empty()
        || text.chars().count() > max
        || text
            .chars()
            .any(|c| c.is_control() && c != '\n' && c != '\r' && c != '\t')
    {
        return Err(empty);
    }
    Ok(text.to_owned())
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
            "Sign in to save an agent.",
        )),
        Err(_) => Err(json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "backend_error",
            "The workspace session could not be read.",
        )),
    }
}

/// One immutable saved revision, resolved once at the start of a run. A save
/// that lands afterwards does not change a run that already resolved.
#[derive(Debug, Clone)]
pub struct ResolvedAgent {
    pub key: String,
    pub revision: i32,
    pub name: String,
    pub instructions: String,
    pub tools: Vec<String>,
}

impl ResolvedAgent {
    pub fn allows(&self, tool: &str) -> bool {
        self.tools.iter().any(|allowed| allowed == tool)
    }
}

/// Newest revision when `revision` is `None`, otherwise exactly that revision.
/// `Ok(None)` means the agent (or that revision) does not exist for this user.
pub async fn resolve(
    state: &AppState,
    user_id: Uuid,
    agent_key: &str,
    revision: Option<i32>,
) -> Result<Option<ResolvedAgent>, ()> {
    sqlx::query_as::<_, (String, i32, String, String, Vec<String>)>(
        "SELECT agent_key, revision, name, instructions, tools FROM agent_revisions
         WHERE user_id = $1 AND agent_key = $2 AND ($3::int IS NULL OR revision = $3)
         ORDER BY revision DESC LIMIT 1",
    )
    .bind(user_id)
    .bind(agent_key)
    .bind(revision)
    .fetch_optional(&state.pool)
    .await
    .map(|row| {
        row.map(|(key, revision, name, instructions, tools)| ResolvedAgent {
            key,
            revision,
            name,
            instructions,
            tools,
        })
    })
    .map_err(|_| ())
}

pub async fn save_revision(
    State(state): State<AppState>,
    jar: axum_extra::extract::CookieJar,
    headers: HeaderMap,
    Json(body): Json<SaveRevision>,
) -> Response {
    if let Some(response) = foreign_origin(&state, &headers) {
        return response;
    }
    let user_id = match signed_in(&state, &jar).await {
        Ok(user_id) => user_id,
        Err(response) => return response,
    };
    let agent_key = match clean_key(&body.agent_key) {
        Ok(key) => key,
        Err(message) => {
            return json_error(StatusCode::UNPROCESSABLE_ENTITY, "invalid_agent", message);
        }
    };
    let name = match clean_text(
        &body.name,
        80,
        "Use an agent name between 1 and 80 characters.",
    ) {
        Ok(name) => name,
        Err(message) => {
            return json_error(StatusCode::UNPROCESSABLE_ENTITY, "invalid_agent", message);
        }
    };
    let instructions = match clean_text(
        &body.instructions,
        4_000,
        "Instructions must be between 1 and 4000 characters.",
    ) {
        Ok(text) => text,
        Err(message) => {
            return json_error(StatusCode::UNPROCESSABLE_ENTITY, "invalid_agent", message);
        }
    };
    let bad = unknown_tools(&body.tools);
    if !bad.is_empty() {
        return json_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "unsupported_tool",
            format!("Unsupported tools: {}", bad.join(", ")),
        );
    }
    let request_id = body.request_id.trim();
    if !(8..=80).contains(&request_id.len()) {
        return json_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_request",
            "The request id must be 8 to 80 characters.",
        );
    }
    // An agent may only be tied to a project the caller owns.
    if let Some(project_id) = body.project_id {
        match sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM projects WHERE id = $1 AND user_id = $2)",
        )
        .bind(project_id)
        .bind(user_id)
        .fetch_one(&state.pool)
        .await
        {
            Ok(true) => {}
            Ok(false) => {
                return json_error(
                    StatusCode::NOT_FOUND,
                    "not_found",
                    "That project was not found.",
                );
            }
            Err(_) => {
                return json_error(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "backend_error",
                    "The project could not be read.",
                );
            }
        }
    }
    let mut tools: Vec<String> = Vec::new();
    for tool in &body.tools {
        if !tools.contains(tool) {
            tools.push(tool.clone());
        }
    }
    let existing = sqlx::query_as::<_, (i32, String, String, Vec<String>)>(
        "SELECT revision, instructions, name, tools FROM agent_revisions WHERE user_id = $1 AND request_id = $2",
    )
    .bind(user_id)
    .bind(request_id)
    .fetch_optional(&state.pool)
    .await;
    if let Ok(Some((revision, saved, saved_name, saved_tools))) = existing {
        return Json(json!({ "agent_key": agent_key, "revision": revision, "name": saved_name, "instructions": saved, "tools": saved_tools, "replayed": true })).into_response();
    }
    // Two saves can race for the same next revision number; the loser retries
    // with a fresh number instead of failing. A replay of the same request id
    // returns the row that request already created.
    for _ in 0..3 {
        let next: i32 = match sqlx::query_scalar(
            "SELECT COALESCE(MAX(revision), 0) + 1 FROM agent_revisions WHERE user_id = $1 AND agent_key = $2",
        )
        .bind(user_id)
        .bind(&agent_key)
        .fetch_one(&state.pool)
        .await
        {
            Ok(next) => next,
            Err(_) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, "backend_error", "The agent revision could not be saved."),
        };
        let saved = sqlx::query_as::<_, (i32,)>(
            "INSERT INTO agent_revisions (id, user_id, agent_key, project_id, name, instructions, revision, request_id, tools)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT DO NOTHING
             RETURNING revision",
        )
        .bind(Uuid::new_v4())
        .bind(user_id)
        .bind(&agent_key)
        .bind(body.project_id)
        .bind(&name)
        .bind(&instructions)
        .bind(next)
        .bind(request_id)
        .bind(&tools)
        .fetch_optional(&state.pool)
        .await;
        match saved {
            Ok(Some((revision,))) => {
                return (StatusCode::CREATED, Json(json!({ "agent_key": agent_key, "revision": revision, "name": name, "instructions": instructions, "tools": tools, "project_id": body.project_id, "replayed": false }))).into_response();
            }
            Ok(None) => {
                if let Ok(Some((revision, saved, saved_name, saved_tools))) = sqlx::query_as::<_, (i32, String, String, Vec<String>)>(
                    "SELECT revision, instructions, name, tools FROM agent_revisions WHERE user_id = $1 AND request_id = $2",
                )
                .bind(user_id)
                .bind(request_id)
                .fetch_optional(&state.pool)
                .await
                {
                    return Json(json!({ "agent_key": agent_key, "revision": revision, "name": saved_name, "instructions": saved, "tools": saved_tools, "replayed": true })).into_response();
                }
                // The revision number was taken by a concurrent save: try the next one.
            }
            Err(_) => {
                return json_error(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "backend_error",
                    "The agent revision could not be saved.",
                );
            }
        }
    }
    json_error(
        StatusCode::CONFLICT,
        "save_conflict",
        "Another save for this agent happened at the same time. Nothing was changed; save again.",
    )
}

pub async fn get_revision(
    State(state): State<AppState>,
    jar: axum_extra::extract::CookieJar,
    headers: HeaderMap,
    Path(agent_key): Path<String>,
) -> Response {
    if let Some(response) = foreign_origin(&state, &headers) {
        return response;
    }
    let user_id = match signed_in(&state, &jar).await {
        Ok(user_id) => user_id,
        Err(response) => return response,
    };
    let key = match clean_key(&agent_key) {
        Ok(key) => key,
        Err(message) => {
            return json_error(StatusCode::UNPROCESSABLE_ENTITY, "invalid_agent", message);
        }
    };
    match sqlx::query_as::<_, (String, String, i32, Vec<String>, Option<Uuid>)>(
        "SELECT name, instructions, revision, tools, project_id FROM agent_revisions WHERE user_id = $1 AND agent_key = $2 ORDER BY revision DESC LIMIT 1",
    )
    .bind(user_id)
    .bind(&key)
    .fetch_optional(&state.pool)
    .await
    {
        Ok(Some((name, instructions, revision, tools, project_id))) => Json(json!({ "agent_key": key, "name": name, "instructions": instructions, "revision": revision, "tools": tools, "project_id": project_id })).into_response(),
        Ok(None) => json_error(StatusCode::NOT_FOUND, "not_found", "That agent was not found."),
        Err(_) => json_error(StatusCode::INTERNAL_SERVER_ERROR, "backend_error", "The agent could not be loaded."),
    }
}

#[cfg(test)]
mod tests {
    use super::unknown_tools;

    #[test]
    fn only_allowlisted_memory_tools_are_accepted() {
        assert!(unknown_tools(&["memwal_recall".into()]).is_empty());
        assert_eq!(
            unknown_tools(&["upload_file".into()]),
            vec!["upload_file".to_owned()]
        );
    }
}
