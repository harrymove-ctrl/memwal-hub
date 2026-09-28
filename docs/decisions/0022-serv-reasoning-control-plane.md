# ADR 0022: SERV Reasoning Control Plane and Memwal Boundary Guard

## Status
Accepted

## Context
Memwal Hub provides an OpenAI/Anthropic-compatible gateway, pooled multi-provider failover, and repository harnesses/skills that define what an agent is allowed to touch.

However, complex autonomous agent tasks require planning, dynamic contract selection, action boundary gating, and outcome verification. Rather than routing high-volume tokens (file reads, edits, diffs) through expensive reasoning APIs, we integrate **SERV Reasoning** as a specialized reasoning control plane operating at three strategic decision checkpoints:

1. **Plan Checkpoint (`POST /reasoning/plan`)**:
   SERV synthesizes the user task, available skills, and file contexts into a structured `ExecutionPlan` containing `required_contracts`, dependency-ordered `steps`, `prohibited_actions`, and `verification_criteria`.
2. **Boundary Checkpoint (`POST /reasoning/authorize`)**:
   Memwal intercepts critical actions (such as `push_without_authorization` or file edits outside the declared boundary) and validates them against SERV's active policy constraints.
3. **Verification Checkpoint (`POST /reasoning/verify`)**:
   Before a task is considered complete or a reviewable change opened, SERV verifies the execution evidence and test suite outputs against the initial acceptance criteria.

## Decision
1. Implemented `ServReasonerClient` in `apps/api/src/reasoning.rs` to communicate with SERV Reasoning API (`/v1/chat/completions`) with a deterministic offline fallback engine for development and local testing.
2. Exposed OpenAPI endpoints:
   - `POST /reasoning/plan`
   - `POST /reasoning/authorize`
   - `POST /reasoning/verify`
3. Exported the OpenAPI specifications and regenerated TypeScript definitions in `apps/frontend/src/services/api.generated.ts`.
4. Created `reasoningService` in `apps/frontend/src/services/reasoning.ts` with error handling conforming to strict project TypeScript rules.
5. Implemented `ReasoningControlPlane` UI in `apps/frontend/src/components/reasoning-control-plane.tsx` and enabled the `/activities` section to demonstrate both:
   - **With SERV Guard**: Structured contract planning, Memwal boundary enforcement, and evidence verification.
   - **Without SERV**: Uncontrolled agent failure modes (rule violations, out-of-scope modifications, missing test evidence).

## Consequences
- Cost efficiency: Only decision and verification checkpoints use reasoning tokens; bulk code edits and executions remain local or use standard gateway providers.
- Bounded autonomy: Coding agents operate within strict machine-enforced contracts.
- Auditable execution: Full trace of plan, action decisions, and verification findings available in UI telemetry.
