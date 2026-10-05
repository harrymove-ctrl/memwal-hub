use hub_william_backend::{
    reasoning::{
        AuthorizeActionRequest, CreatePlanRequest, ServReasonerClient, VerifyOutcomeRequest,
    },
};

#[tokio::test]
async fn deterministic_reasoner_creates_bounded_plan_for_frontend_task() {
    let client = reqwest::Client::new();
    let reasoner = ServReasonerClient::new(
        "https://api.serv.ai".to_string(),
        None,
        "serv-reason-1".to_string(),
    );

    let plan = reasoner
        .create_plan(
            &client,
            &CreatePlanRequest {
                task: "Fix accessibility issues in this React component and open a reviewable change.".to_string(),
                context_files: vec!["apps/frontend/src/button.tsx".to_string()],
                available_skills: vec!["frontend-convention".to_string(), "delivery-verify".to_string()],
            },
        )
        .await
        .expect("plan generation should succeed");

    assert_eq!(plan.intent, "modify_frontend_component");
    assert!(plan.required_contracts.contains(&"frontend-convention".to_string()));
    assert!(plan.prohibited_actions.contains(&"push_without_authorization".to_string()));
    assert_eq!(plan.steps.len(), 3);
    assert_eq!(plan.steps[0].id, "inspect");
    assert_eq!(plan.steps[1].id, "implement");
    assert_eq!(plan.steps[2].id, "verify");
}

#[tokio::test]
async fn action_boundary_blocks_unauthorized_git_push() {
    let client = reqwest::Client::new();
    let reasoner = ServReasonerClient::new(
        "https://api.serv.ai".to_string(),
        None,
        "serv-reason-1".to_string(),
    );

    let decision = reasoner
        .authorize_action(
            &client,
            &AuthorizeActionRequest {
                task: "Fix button".to_string(),
                plan_id: Some("plan_123".to_string()),
                step_id: Some("implement".to_string()),
                action: "git_push".to_string(),
                target: Some("origin/main".to_string()),
                parameters: None,
                active_contracts: vec!["codex-policy".to_string()],
            },
        )
        .await
        .expect("authorization check should succeed");

    assert!(!decision.allowed);
    assert_eq!(decision.status, "blocked");
    assert_eq!(decision.boundary_enforced, "sandbox_execution_only");
}

#[tokio::test]
async fn outcome_verification_requires_test_evidence() {
    let client = reqwest::Client::new();
    let reasoner = ServReasonerClient::new(
        "https://api.serv.ai".to_string(),
        None,
        "serv-reason-1".to_string(),
    );

    let failed_res = reasoner
        .verify_outcome(
            &client,
            &VerifyOutcomeRequest {
                task: "Fix button".to_string(),
                plan_id: Some("plan_123".to_string()),
                completed_steps: vec!["inspect".to_string(), "implement".to_string()],
                evidence: "Code is edited without tests".to_string(),
                modified_files: vec!["button.tsx".to_string()],
                test_output: None,
            },
        )
        .await
        .expect("verification check should succeed");

    assert!(!failed_res.passed);
    assert!(!failed_res.unsatisfied_criteria.is_empty());

    let passed_res = reasoner
        .verify_outcome(
            &client,
            &VerifyOutcomeRequest {
                task: "Fix button".to_string(),
                plan_id: Some("plan_123".to_string()),
                completed_steps: vec!["inspect".to_string(), "implement".to_string(), "verify".to_string()],
                evidence: "All tests passed with zero failures".to_string(),
                modified_files: vec!["button.tsx".to_string()],
                test_output: Some("12 passed".to_string()),
            },
        )
        .await
        .expect("verification check should succeed");

    assert!(passed_res.passed);
    assert_eq!(passed_res.unsatisfied_criteria.len(), 0);
}
