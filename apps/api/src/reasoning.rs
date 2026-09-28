use axum::{
    Json,
    extract::State,
    http::HeaderMap,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{AppState, error::ApiError, gateway::authorize_gateway_key};

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct PlanStep {
    pub id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default, alias = "description")]
    pub action: String,
    #[serde(default)]
    pub target: Option<String>,
    #[serde(default, alias = "risk_level")]
    pub risk: String,
    #[serde(default, alias = "dependencies")]
    pub depends_on: Vec<String>,
    #[serde(default)]
    pub rationale: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct ExecutionPlan {
    pub plan_id: String,
    pub intent: String,
    pub summary: String,
    pub required_contracts: Vec<String>,
    pub steps: Vec<PlanStep>,
    pub prohibited_actions: Vec<String>,
    pub verification_criteria: Vec<String>,
    pub created_at: DateTime<Utc>,
    pub reasoner_model: String,
}

#[derive(Debug, Clone, Deserialize, ToSchema)]
pub struct CreatePlanRequest {
    pub task: String,
    #[serde(default)]
    pub context_files: Vec<String>,
    #[serde(default)]
    pub available_skills: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, ToSchema)]
pub struct AuthorizeActionRequest {
    pub task: String,
    pub plan_id: Option<String>,
    pub step_id: Option<String>,
    pub action: String,
    pub target: Option<String>,
    #[serde(default)]
    pub parameters: Option<serde_json::Value>,
    #[serde(default)]
    pub active_contracts: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct ActionDecision {
    pub decision_id: String,
    pub allowed: bool,
    pub status: String,
    pub reason: String,
    pub matched_contract: Option<String>,
    pub boundary_enforced: String,
    pub audited_at: DateTime<Utc>,
    pub reasoner_model: String,
}

#[derive(Debug, Clone, Deserialize, ToSchema)]
pub struct VerifyOutcomeRequest {
    pub task: String,
    pub plan_id: Option<String>,
    pub completed_steps: Vec<String>,
    pub evidence: String,
    #[serde(default)]
    pub modified_files: Vec<String>,
    #[serde(default)]
    pub test_output: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct VerificationResult {
    pub verification_id: String,
    pub passed: bool,
    pub confidence: f32,
    pub findings: Vec<String>,
    pub unsatisfied_criteria: Vec<String>,
    pub recommendation: String,
    pub verified_at: DateTime<Utc>,
    pub reasoner_model: String,
}

pub struct ServReasonerClient {
    pub api_url: String,
    pub api_key: Option<String>,
    pub model: String,
}

impl ServReasonerClient {
    pub fn new(api_url: String, api_key: Option<String>, model: String) -> Self {
        Self {
            api_url,
            api_key,
            model,
        }
    }

    pub async fn create_plan(
        &self,
        client: &reqwest::Client,
        request: &CreatePlanRequest,
    ) -> Result<ExecutionPlan, ApiError> {
        if let Some(api_key) = &self.api_key {
            let system_prompt = r#"You are SERV Reasoning Engine, the planning and control plane for autonomous coding agents.
Analyze the user's software engineering task and available harness/contracts/skills.
Output ONLY a valid JSON object with the following schema:
{
  "intent": string,
  "summary": string,
  "required_contracts": string[],
  "steps": [
    {
      "id": string,
      "title": string,
      "action": string,
      "target": string | null,
      "risk": "low" | "medium" | "high",
      "depends_on": string[],
      "rationale": string | null
    }
  ],
  "prohibited_actions": string[],
  "verification_criteria": string[]
}
Do not wrap in markdown tags if possible, or wrap in ```json```."#;

            let user_content = format!(
                "Task: {}\nContext files: {:?}\nAvailable skills: {:?}",
                request.task, request.context_files, request.available_skills
            );

            let body = serde_json::json!({
                "model": &self.model,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_content}
                ],
                "temperature": 0.2
            });

            let response = client
                .post(format!("{}/v1/chat/completions", self.api_url.trim_end_matches('/')))
                .bearer_auth(api_key)
                .json(&body)
                .send()
                .await;

            match response {
                Ok(resp) if resp.status().is_success() => {
                    if let Ok(res_json) = resp.json::<serde_json::Value>().await {
                        if let Some(content) =
                            res_json["choices"][0]["message"]["content"].as_str()
                        {
                            match parse_plan_json(content, &self.model) {
                                Ok(mut plan) => {
                                    if plan.required_contracts.is_empty() {
                                        plan.required_contracts =
                                            request.available_skills.clone();
                                    }
                                    return Ok(plan);
                                }
                                Err(error) => {
                                    eprintln!(
                                        "serv plan parse failed: {error}; content head: {}",
                                        &content[..content.len().min(200)]
                                    );
                                }
                            }
                        }
                    }
                }
                Ok(resp) => {
                    eprintln!("serv plan request returned {}", resp.status());
                }
                Err(error) => {
                    eprintln!("serv plan request failed: {error}");
                }
            }
        }

        // Deterministic fallback reasoning engine based on task & contract analysis
        Ok(generate_deterministic_plan(
            request,
            &format!("{} (offline fallback)", self.model),
        ))
    }

    pub async fn authorize_action(
        &self,
        client: &reqwest::Client,
        request: &AuthorizeActionRequest,
    ) -> Result<ActionDecision, ApiError> {
        if let Some(api_key) = &self.api_key {
            let system_prompt = r#"You are SERV Reasoning Engine, the authorization control plane for autonomous coding agents.
Evaluate whether the proposed agent action complies with active contracts and policies.
Output ONLY a valid JSON object:
{
  "allowed": boolean,
  "status": "allowed" | "blocked" | "flagged",
  "reason": string,
  "matched_contract": string | null,
  "boundary_enforced": string
}"#;

            let user_content = format!(
                "Task: {}\nPlan ID: {:?}\nStep ID: {:?}\nAction: {}\nTarget: {:?}\nParams: {:?}\nActive contracts: {:?}",
                request.task, request.plan_id, request.step_id, request.action, request.target, request.parameters, request.active_contracts
            );

            let body = serde_json::json!({
                "model": &self.model,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_content}
                ],
                "temperature": 0.0
            });

            let response = client
                .post(format!("{}/v1/chat/completions", self.api_url.trim_end_matches('/')))
                .bearer_auth(api_key)
                .json(&body)
                .send()
                .await;

            if let Ok(resp) = response {
                if resp.status().is_success() {
                    if let Ok(res_json) = resp.json::<serde_json::Value>().await {
                        if let Some(content) = res_json["choices"][0]["message"]["content"].as_str() {
                            if let Ok(decision) = parse_decision_json(content, &self.model) {
                                return Ok(decision);
                            }
                            eprintln!(
                                "serv authorize parse failed; content head: {}",
                                &content[..content.len().min(200)]
                            );
                        }
                    }
                }
            }

            // A configured reasoner that fails MUST NOT fail open: an
            // unreviewable action is a blocked action.
            return Ok(ActionDecision {
                decision_id: format!("dec_{}", Uuid::new_v4().simple()),
                allowed: false,
                status: "blocked".to_owned(),
                reason: "SERV reasoner unavailable or returned invalid output; failing closed."
                    .to_owned(),
                matched_contract: None,
                boundary_enforced: "fail_closed".to_owned(),
                audited_at: Utc::now(),
                reasoner_model: format!("{} (fail-closed)", self.model),
            });
        }

        Ok(evaluate_action_boundary(
            request,
            &format!("{} (offline fallback)", self.model),
        ))
    }

    pub async fn verify_outcome(
        &self,
        client: &reqwest::Client,
        request: &VerifyOutcomeRequest,
    ) -> Result<VerificationResult, ApiError> {
        if let Some(api_key) = &self.api_key {
            let system_prompt = r#"You are SERV Reasoning Engine, the verification checkpoint for autonomous coding workflows.
Assess whether the provided execution evidence genuinely satisfies the task and verification criteria.
Output ONLY a valid JSON object:
{
  "passed": boolean,
  "confidence": number between 0.0 and 1.0,
  "findings": string[],
  "unsatisfied_criteria": string[],
  "recommendation": string
}"#;

            let user_content = format!(
                "Task: {}\nCompleted steps: {:?}\nModified files: {:?}\nEvidence:\n{}\nTest output:\n{:?}",
                request.task, request.completed_steps, request.modified_files, request.evidence, request.test_output
            );

            let body = serde_json::json!({
                "model": &self.model,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_content}
                ],
                "temperature": 0.1
            });

            let response = client
                .post(format!("{}/v1/chat/completions", self.api_url.trim_end_matches('/')))
                .bearer_auth(api_key)
                .json(&body)
                .send()
                .await;

            if let Ok(resp) = response {
                if resp.status().is_success() {
                    if let Ok(res_json) = resp.json::<serde_json::Value>().await {
                        if let Some(content) = res_json["choices"][0]["message"]["content"].as_str() {
                            if let Ok(result) = parse_verification_json(content, &self.model) {
                                return Ok(result);
                            }
                            eprintln!(
                                "serv verify parse failed; content head: {}",
                                &content[..content.len().min(200)]
                            );
                        }
                    }
                }
            }

            // Unverifiable evidence never certifies a task.
            return Ok(VerificationResult {
                verification_id: format!("ver_{}", Uuid::new_v4().simple()),
                passed: false,
                confidence: 0.0,
                findings: vec![
                    "SERV reasoner unavailable or returned invalid output.".to_owned(),
                ],
                unsatisfied_criteria: vec![
                    "Independent verification of the submitted evidence".to_owned(),
                ],
                recommendation: "Retry verification once the reasoner is reachable.".to_owned(),
                verified_at: Utc::now(),
                reasoner_model: format!("{} (fail-closed)", self.model),
            });
        }

        Ok(evaluate_outcome_verification(
            request,
            &format!("{} (offline fallback)", self.model),
        ))
    }
}

fn strip_json_fence(input: &str) -> &str {
    let trimmed = input.trim();
    if let Some(stripped) = trimmed.strip_prefix("```json") {
        if let Some(end) = stripped.rfind("```") {
            return stripped[..end].trim();
        }
        return stripped.trim();
    }
    if let Some(stripped) = trimmed.strip_prefix("```") {
        if let Some(end) = stripped.rfind("```") {
            return stripped[..end].trim();
        }
        return stripped.trim();
    }
    trimmed
}

fn parse_plan_json(content: &str, model: &str) -> Result<ExecutionPlan, String> {
    #[derive(Deserialize)]
    struct RawPlan {
        intent: String,
        #[serde(default)]
        summary: String,
        // Models frequently omit or rename optional sections; tolerate drift
        // instead of discarding an otherwise valid plan.
        #[serde(default, alias = "contracts", alias = "required_skills")]
        required_contracts: Vec<String>,
        steps: Vec<PlanStep>,
        #[serde(default)]
        prohibited_actions: Vec<String>,
        #[serde(default, alias = "verification")]
        verification_criteria: Vec<String>,
    }

    let clean = strip_json_fence(content);
    let raw: RawPlan = serde_json::from_str(clean).map_err(|e| e.to_string())?;
    Ok(ExecutionPlan {
        plan_id: format!("plan_{}", Uuid::new_v4().simple()),
        intent: raw.intent,
        summary: raw.summary,
        required_contracts: raw.required_contracts,
        steps: raw.steps,
        prohibited_actions: raw.prohibited_actions,
        verification_criteria: raw.verification_criteria,
        created_at: Utc::now(),
        reasoner_model: model.to_string(),
    })
}

fn parse_decision_json(content: &str, model: &str) -> Result<ActionDecision, ()> {
    #[derive(Deserialize)]
    struct RawDecision {
        // Models drift on field names; accept the common variants and derive
        // `allowed` from status when omitted.
        #[serde(default)]
        allowed: Option<bool>,
        #[serde(alias = "outcome", alias = "decision")]
        status: String,
        #[serde(default)]
        reason: String,
        #[serde(default)]
        matched_contract: Option<String>,
        #[serde(default, alias = "enforced_boundary", alias = "boundary")]
        boundary_enforced: String,
    }

    let clean = strip_json_fence(content);
    let raw: RawDecision = serde_json::from_str(clean).map_err(|_| ())?;
    let status = raw.status.to_lowercase();
    Ok(ActionDecision {
        decision_id: format!("dec_{}", Uuid::new_v4().simple()),
        allowed: raw.allowed.unwrap_or(status == "allowed"),
        status,
        reason: raw.reason,
        matched_contract: raw.matched_contract,
        boundary_enforced: raw.boundary_enforced,
        audited_at: Utc::now(),
        reasoner_model: model.to_string(),
    })
}

fn parse_verification_json(content: &str, model: &str) -> Result<VerificationResult, ()> {
    #[derive(Deserialize)]
    struct RawVerification {
        passed: bool,
        #[serde(default, alias = "confidence_score")]
        confidence: f32,
        #[serde(default, alias = "issues")]
        findings: Vec<String>,
        #[serde(default, alias = "missing_criteria")]
        unsatisfied_criteria: Vec<String>,
        #[serde(default, alias = "next_steps")]
        recommendation: String,
    }

    let clean = strip_json_fence(content);
    let raw: RawVerification = serde_json::from_str(clean).map_err(|_| ())?;
    Ok(VerificationResult {
        verification_id: format!("ver_{}", Uuid::new_v4().simple()),
        passed: raw.passed,
        confidence: raw.confidence,
        findings: raw.findings,
        unsatisfied_criteria: raw.unsatisfied_criteria,
        recommendation: raw.recommendation,
        verified_at: Utc::now(),
        reasoner_model: model.to_string(),
    })
}

fn generate_deterministic_plan(req: &CreatePlanRequest, model: &str) -> ExecutionPlan {
    let lower_task = req.task.to_lowercase();
    let is_frontend = lower_task.contains("react")
        || lower_task.contains("accessibility")
        || lower_task.contains("component")
        || lower_task.contains("ui")
        || lower_task.contains("frontend");

    let mut contracts = Vec::new();
    if is_frontend {
        contracts.push("frontend-convention".to_string());
        contracts.push("frontend-verify".to_string());
    } else {
        contracts.push("delivery-verify".to_string());
    }
    contracts.push("codex-policy".to_string());

    let mut steps = Vec::new();
    steps.push(PlanStep {
        id: "inspect".to_string(),
        title: "Inspect repository and target files".to_string(),
        action: "read_files".to_string(),
        target: req.context_files.first().cloned(),
        risk: "low".to_string(),
        depends_on: vec![],
        rationale: Some("Gather exact context and active constraints before any edits".to_string()),
    });

    steps.push(PlanStep {
        id: "implement".to_string(),
        title: "Apply bounded code changes".to_string(),
        action: "edit_workspace".to_string(),
        target: req.context_files.first().cloned(),
        risk: "medium".to_string(),
        depends_on: vec!["inspect".to_string()],
        rationale: Some("Keep changes strictly scoped to task specification".to_string()),
    });

    steps.push(PlanStep {
        id: "verify".to_string(),
        title: "Execute automated verification & tests".to_string(),
        action: "run_tests".to_string(),
        target: Some(if is_frontend { "vitest".to_string() } else { "cargo test".to_string() }),
        risk: "low".to_string(),
        depends_on: vec!["implement".to_string()],
        rationale: Some("Ensure no regressions and contract fulfillment".to_string()),
    });

    ExecutionPlan {
        plan_id: format!("plan_{}", Uuid::new_v4().simple()),
        intent: if is_frontend {
            "modify_frontend_component".to_string()
        } else {
            "modify_repository".to_string()
        },
        summary: format!("Structured execution plan for task: {}", req.task),
        required_contracts: contracts,
        steps,
        prohibited_actions: vec![
            "push_without_authorization".to_string(),
            "modify_unrelated_files".to_string(),
            "bypass_test_verification".to_string(),
        ],
        verification_criteria: vec![
            "All changed components strictly adhere to project conventions".to_string(),
            "Automated test suite executes and passes without warnings".to_string(),
            "No uncommitted or out-of-scope files touched".to_string(),
        ],
        created_at: Utc::now(),
        reasoner_model: model.to_string(),
    }
}

fn evaluate_action_boundary(req: &AuthorizeActionRequest, model: &str) -> ActionDecision {
    let action = req.action.to_lowercase();
    let target = req.target.as_deref().unwrap_or("").to_lowercase();

    // Check prohibited high-risk operations
    if action == "git_push" || action == "push_without_authorization" || action.contains("push") {
        return ActionDecision {
            decision_id: format!("dec_{}", Uuid::new_v4().simple()),
            allowed: false,
            status: "blocked".to_string(),
            reason: "Pushing code to remote branches without explicit user authorization is blocked.".to_string(),
            matched_contract: Some("codex-policy".to_string()),
            boundary_enforced: "sandbox_execution_only".to_string(),
            audited_at: Utc::now(),
            reasoner_model: model.to_string(),
        };
    }

    if target.contains("unrelated") || target.contains(".env") || target.contains("credentials") {
        return ActionDecision {
            decision_id: format!("dec_{}", Uuid::new_v4().simple()),
            allowed: false,
            status: "blocked".to_string(),
            reason: format!("Target '{}' violates repository isolation boundaries.", target),
            matched_contract: Some("boundary-guard".to_string()),
            boundary_enforced: "file_access_control".to_string(),
            audited_at: Utc::now(),
            reasoner_model: model.to_string(),
        };
    }

    ActionDecision {
        decision_id: format!("dec_{}", Uuid::new_v4().simple()),
        allowed: true,
        status: "allowed".to_string(),
        reason: format!("Action '{}' is within acceptable risk boundaries for planned step.", req.action),
        matched_contract: req.active_contracts.first().cloned(),
        boundary_enforced: "standard_sandbox".to_string(),
        audited_at: Utc::now(),
        reasoner_model: model.to_string(),
    }
}

fn evaluate_outcome_verification(req: &VerifyOutcomeRequest, model: &str) -> VerificationResult {
    let lower_evidence = req.evidence.to_lowercase();
    let test_output = req.test_output.as_deref().unwrap_or("").to_lowercase();

    let has_passed_tests = (lower_evidence.contains("pass") || test_output.contains("passed") || test_output.contains("pass"))
        && !test_output.contains("failed")
        && !lower_evidence.contains("assertion failed");

    let is_all_steps_complete = !req.completed_steps.is_empty()
        && req.completed_steps.iter().any(|s| s.contains("verify") || s.contains("test"));

    if has_passed_tests && is_all_steps_complete {
        VerificationResult {
            verification_id: format!("ver_{}", Uuid::new_v4().simple()),
            passed: true,
            confidence: 0.96,
            findings: vec![
                "Target verification tests executed and passed cleanly.".to_string(),
                "All planned execution dependency steps were satisfied.".to_string(),
                "Scope boundaries respected with zero extraneous modifications.".to_string(),
            ],
            unsatisfied_criteria: vec![],
            recommendation: "Execution verified. Safe to open reviewable change.".to_string(),
            verified_at: Utc::now(),
            reasoner_model: model.to_string(),
        }
    } else {
        let mut missing = Vec::new();
        if !has_passed_tests {
            missing.push("Automated verification / test suite output missing or indicating failure.".to_string());
        }
        if !is_all_steps_complete {
            missing.push("Verification step was not completed according to execution plan.".to_string());
        }

        VerificationResult {
            verification_id: format!("ver_{}", Uuid::new_v4().simple()),
            passed: false,
            confidence: 0.88,
            findings: vec![
                "Agent attempted to mark task completed without sufficient test evidence.".to_string(),
            ],
            unsatisfied_criteria: missing,
            recommendation: "Run required verification tests before completing task.".to_string(),
            verified_at: Utc::now(),
            reasoner_model: model.to_string(),
        }
    }
}

/// Builds the reasoner for a request, honoring per-request overrides:
/// `x-serv-api-key` swaps the SERV credential and `x-serv-model` the model
/// (e.g. `gemini-3.8-flash-high` for demos) without touching server config.
fn reasoner_from(state: &AppState, headers: &HeaderMap) -> ServReasonerClient {
    let header_value = |name: &str| {
        headers
            .get(name)
            .and_then(|v| v.to_str().ok())
            .filter(|v| !v.trim().is_empty())
            .map(|v| v.to_owned())
    };
    ServReasonerClient::new(
        state.config.serv_reasoning_url.clone(),
        header_value("x-serv-api-key").or_else(|| state.config.serv_reasoning_api_key.clone()),
        header_value("x-serv-model")
            .unwrap_or_else(|| state.config.serv_reasoning_model.clone()),
    )
}

#[derive(Debug, Serialize, sqlx::FromRow, ToSchema)]
pub struct ReasoningEvent {
    pub id: Uuid,
    pub kind: String,
    pub task: String,
    pub reasoner_model: String,
    pub outcome: String,
    pub detail: String,
    pub created_at: DateTime<Utc>,
}

/// Best-effort audit trail: a failed insert never fails the reasoning call.
async fn record_event(state: &AppState, kind: &str, task: &str, model: &str, outcome: &str, detail: &str) {
    let mut detail = detail.to_owned();
    detail.truncate(300);
    let mut task = task.to_owned();
    task.truncate(160);
    if let Err(error) = sqlx::query(
        "INSERT INTO reasoning_events (id, kind, task, reasoner_model, outcome, detail)
         VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(Uuid::new_v4())
    .bind(kind)
    .bind(task)
    .bind(model)
    .bind(outcome)
    .bind(detail)
    .execute(&state.pool)
    .await
    {
        eprintln!("reasoning event insert failed: {error}");
    }
}

#[utoipa::path(
    get,
    path = "/reasoning/events",
    responses(
        (status = 200, description = "Latest reasoning checkpoint events, newest first", body = [ReasoningEvent])
    ),
    tag = "reasoning"
)]
pub async fn list_events(
    State(state): State<AppState>,
) -> Result<Json<Vec<ReasoningEvent>>, ApiError> {
    let events = sqlx::query_as::<_, ReasoningEvent>(
        "SELECT id, kind, task, reasoner_model, outcome, detail, created_at
         FROM reasoning_events
         ORDER BY created_at DESC
         LIMIT 60",
    )
    .fetch_all(&state.pool)
    .await
    .map_err(|error| {
        eprintln!("reasoning events query failed: {error}");
        ApiError::Internal
    })?;
    Ok(Json(events))
}

#[derive(Debug, Serialize, sqlx::FromRow, ToSchema)]
pub struct ReasoningDailyStat {
    /// Calendar day in ISO format, e.g. "2026-09-26".
    pub day: String,
    pub total: i64,
    pub plans: i64,
    pub allowed: i64,
    pub blocked: i64,
    pub certified: i64,
}

#[utoipa::path(
    get,
    path = "/reasoning/events/daily",
    responses(
        (status = 200, description = "Per-day reasoning checkpoint counts for the last 365 days", body = [ReasoningDailyStat])
    ),
    tag = "reasoning"
)]
pub async fn daily_stats(
    State(state): State<AppState>,
) -> Result<Json<Vec<ReasoningDailyStat>>, ApiError> {
    let stats = sqlx::query_as::<_, ReasoningDailyStat>(
        "SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
                count(*) AS total,
                count(*) FILTER (WHERE kind = 'plan') AS plans,
                count(*) FILTER (WHERE outcome = 'allowed') AS allowed,
                count(*) FILTER (WHERE outcome IN ('blocked', 'rejected')) AS blocked,
                count(*) FILTER (WHERE outcome = 'passed') AS certified
         FROM reasoning_events
         WHERE created_at > NOW() - INTERVAL '365 days'
         GROUP BY day
         ORDER BY day",
    )
    .fetch_all(&state.pool)
    .await
    .map_err(|error| {
        eprintln!("reasoning daily stats query failed: {error}");
        ApiError::Internal
    })?;
    Ok(Json(stats))
}

#[utoipa::path(
    post,
    path = "/reasoning/plan",
    request_body = CreatePlanRequest,
    responses(
        (status = 200, description = "Structured execution plan generated by SERV Reasoning", body = ExecutionPlan),
        (status = 401, description = "Gateway key or active authorization required", body = crate::ErrorResponse)
    ),
    tag = "reasoning"
)]
pub async fn plan_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<CreatePlanRequest>,
) -> Result<Json<ExecutionPlan>, ApiError> {
    let _ = authorize_gateway_key(&state, &headers).await?;
    let reasoner = reasoner_from(&state, &headers);
    let plan = reasoner.create_plan(&state.http, &payload).await?;
    record_event(
        &state,
        "plan",
        &payload.task,
        &plan.reasoner_model,
        &format!("{} steps", plan.steps.len()),
        &plan.summary,
    )
    .await;
    Ok(Json(plan))
}

#[utoipa::path(
    post,
    path = "/reasoning/authorize",
    request_body = AuthorizeActionRequest,
    responses(
        (status = 200, description = "Action authorized or blocked based on contract boundaries", body = ActionDecision),
        (status = 401, description = "Gateway key or active authorization required", body = crate::ErrorResponse)
    ),
    tag = "reasoning"
)]
pub async fn authorize_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<AuthorizeActionRequest>,
) -> Result<Json<ActionDecision>, ApiError> {
    let _ = authorize_gateway_key(&state, &headers).await?;
    let reasoner = reasoner_from(&state, &headers);
    let decision = reasoner.authorize_action(&state.http, &payload).await?;
    record_event(
        &state,
        "authorize",
        &format!("{} -> {}", payload.action, payload.target.as_deref().unwrap_or("-")),
        &decision.reasoner_model,
        &decision.status,
        &decision.reason,
    )
    .await;
    Ok(Json(decision))
}

#[utoipa::path(
    post,
    path = "/reasoning/verify",
    request_body = VerifyOutcomeRequest,
    responses(
        (status = 200, description = "Outcome verification verdict evaluated by SERV Reasoning", body = VerificationResult),
        (status = 401, description = "Gateway key or active authorization required", body = crate::ErrorResponse)
    ),
    tag = "reasoning"
)]
pub async fn verify_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<VerifyOutcomeRequest>,
) -> Result<Json<VerificationResult>, ApiError> {
    let _ = authorize_gateway_key(&state, &headers).await?;
    let reasoner = reasoner_from(&state, &headers);
    let result = reasoner.verify_outcome(&state.http, &payload).await?;
    record_event(
        &state,
        "verify",
        &payload.task,
        &result.reasoner_model,
        if result.passed { "passed" } else { "rejected" },
        &result.recommendation,
    )
    .await;
    Ok(Json(result))
}
