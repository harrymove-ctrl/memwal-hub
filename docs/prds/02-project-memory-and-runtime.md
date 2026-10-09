# PRD 02 — Relevant project memory across conversations and models

Status: proposed. Priority: submission-critical. Date: 8 October 2026.
Depends on: [PRD 01](01-projects-and-conversations.md).

## Outcome

MemWal recalls the right approved product context in a new conversation, explains which saved context was provided, and improves advice without exposing another user's or project's information.

## Product boundary

MemWal manages application identity, project permissions, agent configuration, conversations and model connections. The Product Discovery runtime coordinates message handling, optional recall, model generation, extraction and reviewed writes. Walrus Memory stores and retrieves durable project context on Mainnet.

The repository harness is a developer workflow layer, not evidence of runtime orchestration. Keep it for development quality. A future tool adapter for local harness-driven agents is a separate deliverable; do not claim it exists merely because both products are present in the repository.

Do not silently alter the transparent gateway to inject recall into unrelated model requests. Keep memory participation explicit in this chatbot.

## Memory types

| Type | Example | Handling |
| --- | --- | --- |
| Product fact | LaunchLens serves solo SaaS founders | Save after user review or explicit auto-save consent |
| Constraint | Four engineers; six weeks to release | Recall for planning; handle corrections |
| Decision | Team workspaces are deferred | Preserve decision provenance and later changes |
| Research observation | Three test users missed the setup action | Preserve source and distinguish from broad market conclusions |
| Hypothesis | Concierge onboarding may improve activation | Label as a hypothesis, not established evidence |
| Temporary instruction | Answer this message in two bullets | Keep in current chat; do not automatically promote to durable memory |
| Secret | API key or delegate private key | Exclude from memory extraction, fixtures, logs and demo evidence |

## Core stories and acceptance criteria

| ID | Story | Acceptance |
| --- | --- | --- |
| M01 | Review proposed memories | Suggestions remain editable and unsaved until approved when auto-save is off |
| M02 | Confirm remote storage | Stored state requires actual remote completion evidence and blob reference |
| M03 | Recall in new chat | B has no A transcript, but retrieves relevant A-derived facts through Walrus |
| M04 | Skip irrelevant memory | No arbitrary fallback list when nothing relevant is found |
| M05 | Isolate projects | Query/save use the server-resolved namespace for the authorized project |
| M06 | Isolate users | Another signed-in user cannot retrieve memories by changing project/chat IDs |
| M07 | Change model | Switching Gemini/Grok/Claude retains the same authorized project memory scope |
| M08 | Correct facts | New explicit corrections are reflected in subsequent answers; contradictory old facts are handled transparently |
| M09 | Disable memory | Memory off stops both retrieval and new memory writes; current-chat conversation context still works |
| M10 | Recover remote jobs | Leaving Chat or restarting the app does not lose accepted write-job status |
| M11 | Handle recall failure | Show a truthful failure with retry or an explicit continue-without-memory path |
| M12 | Resist memory instructions | Stored text cannot override system instructions or bypass authorization |

## Scope rules

Default durable-memory scope: authenticated owner + authorized project + configured Walrus connection. Conversation IDs are provenance; they must not isolate memories so tightly that another chat in the same project cannot recall them.

Project names, route parameters and client-provided namespaces are not authorization. Resolve the immutable namespace from a server-owned project record after verifying access. Apply the same scope to recall, reviewed writes, correction handling, history disclosures and job status.

Namespaces are organizational boundaries within an account. They do not stop a delegate with account-wide access from accessing another namespace. Prefer user-owned connections; document the trust boundary accurately. Never infer memory access from shared model-pool access.

Do not automatically reuse old unscoped memory in every new project. Provide an explicit legacy association/import process. Preserve source identifiers and describe what becomes visible before executing it.

## Runtime flow

1. Authenticate and authorize the conversation and project.
2. Persist the current user turn with a replay-safe request ID.
3. Determine whether retrieval is useful for this request and enabled.
4. Build a contextual query using the current message and only necessary context from the current chat.
5. Recall within the project's server-resolved scope.
6. Filter/deduplicate and resolve known superseded facts; treat score thresholds as tested heuristics, not universal truth.
7. Provide relevant memories to the model as clearly delimited untrusted reference data.
8. Generate and persist the response using the configured upstream model.
9. Extract candidate durable facts; keep generated suggestions separate from user-confirmed facts.
10. Let the user review and save, or use explicitly enabled auto-save.
11. Track acceptance, storage and indexing separately. Preserve receipts and source provenance.

Use stable request/job IDs and retry-safe writes. Do not submit duplicate memories on polling retries. A model response can succeed while recall or saving fails; show independent outcomes.

## Honest memory UI

- “Checking saved context…” appears only during actual recall.
- “2 saved memories provided as context” describes injection, not a proven causal explanation of model reasoning.
- Show relevant snippets and source chat/date when actually available.
- Keep scores, namespaces, raw IDs and payloads in developer details.
- “No relevant saved context found” is valid; do not decorate it with unrelated facts.
- “Saving…” means pending; “Stored” requires completion; “Search indexing pending” may still follow storage.
- Never show “Connected” or “Ready” based only on a user clicking a button.

## Corrections and forgetting

Use source timestamps and explicit correction relationships when supported by application metadata. Do not assume semantic similarity identifies the authoritative current value. Test corrections such as two engineers → four engineers while unchanged constraints remain intact.

Do not invent an upstream in-place update operation. If a correction is a new blob, preserve the old/new relationship. Local suppression of an old fact is not permanent erasure from Walrus. Use precise labels for archive, hide from recall, disconnect and remote deletion.

## Optional local-agent integration: later phase

A separately authorized adapter could expose project-scoped recall and reviewed save to MemWal's local tooling. Authentication must map the local client to a MemWal user and project permission. Responses carry provenance; writes return durable job IDs. This adapter must not expose a shared delegate key or bypass the browser/API policy.

Do not build this before the web chatbot, isolation tests and Mainnet proof are complete. The submission rules require a working chatbot, not an MCP server or Walrus Console integration.

## Tests and evidence

Use a versioned synthetic fixture with expected facts, irrelevant distractors, a correction and an adversarial instruction embedded in stored text.

Verify relevance with paraphrases, generic questions, follow-ups and unrelated topics. Verify no transcript replay by inspecting the outgoing model request and retrieval trace. Run Memory-on and Memory-off comparisons in separate new conversations, keeping the question and model settings comparable.

Separate mocked recall/write tests from actual Mainnet tests. Track actual accepted facts and confirmed blobs independently. The competition requirement is ten blobs written by the submitting agent, not ten UI cards.

## Release gates

- Current-chat context and cross-chat memory have demonstrably separate sources.
- Scope is enforced server-side on all relevant paths.
- Relevant recall works in a fresh session with a different conversation ID.
- Negative isolation and irrelevant-query tests pass.
- Save receipts reflect real remote storage state.
- Secrets never appear in UI evidence or source fixtures.
