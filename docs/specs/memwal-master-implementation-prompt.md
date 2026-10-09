# Full implementation prompt — MemWal workspace, conversations and canvas

You are implementing MemWal, a Product Discovery chatbot that uses Walrus Memory on Mainnet. Your task is to turn the current mixture of example UI and live chat into a coherent, working product. Complete the core flows and verify them; do not stop at visual mockups or a plan.

## Read the evidence and requirements first

Read these documentation artifacts in full:

- `docs/specs/builder-interaction-audit.md`
- `docs/specs/memwal-conversations-submission.md`
- `docs/prds/01-projects-and-conversations.md`
- `docs/prds/02-project-memory-and-runtime.md`
- `docs/prds/03-demo-and-submission.md`
- `docs/prds/04-agent-builder-and-canvas.md`

These files describe proposed behavior and distinguish it from inspected functionality. They are not claims that the requested features already exist.

The documentation checkout is `/Users/harryphan/orca/memwal-hub`. The last verified frontend serving port 5188 ran from `/Users/harryphan/orca/workspaces/memwal-hub/branch/apps/frontend`. Verify the currently running checkout before editing. Preserve unrelated work and follow applicable repository instructions. Do not assume a patch to one checkout changes the other.

Local entry points:

- http://127.0.0.1:5188/builder/chat
- http://127.0.0.1:5188/builder/agents/product-discovery
- http://127.0.0.1:5188/builder/agents/research-companion
- http://127.0.0.1:5188/builder/integrations

Visual reference: https://agent-builder-ui-one.vercel.app/#/agents/product-discovery

Animation source: https://ascii.rest/

Inspect the reference if available. Preserve its useful proportions and interaction quality while adapting content and capabilities to MemWal. Do not copy browser chrome, fake metrics or unsupported features.

## Product objective

Help solo founders and small product teams resume discovery without repeating product context. Users create projects, configure assistants, create multiple persistent conversations, save selected durable facts to Walrus, and recall relevant facts in later conversations or with another model.

MemWal manages application identity, project permissions, conversations and model connections. Walrus Memory stores and retrieves durable project context on Mainnet. The repository's development harness is an internal engineering workflow, not the product name and not an already implemented agent runtime.

Prioritize a working Product Discovery submission. Gemini or Grok may be the primary model for the alternative-model category. Record the actual model/version and runtime; using a proxy does not change the underlying model provider. Console and additional templates are optional.

## Confirmed problems to recheck and address

1. New agent, More agents, Templates, Search and several menu items currently only show demo notices.
2. Research Companion shows the hardcoded `product-discovery-agent` label and `Past 7 days` text.
3. Its initial run panel is blank because introductory actions are special-cased to Product Discovery.
4. Save agent uses browser-local state and a simulated delay, not server persistence; storage errors can be swallowed.
5. Renaming updates configuration but may leave the separate navigation name unchanged.
6. Canvas cards mostly display fixture configuration. Heading clicks expand/collapse; background/card dragging pans the world.
7. Tool/file rows do not invoke their displayed capabilities. Editing memory names does not bind a namespace. Editing tools can drop metadata.
8. The files inspector can offer Apply without a meaningful editable field or apply operation.
9. Fit uses a fixed width instead of all visible node bounds.
10. Builder runs use `createDemoRunService`; Product Discovery's preview progresses through example stages. Real Chat is a separate path.
11. The inspected live Chat backend has fixed Product Discovery instructions; canvas configuration is not passed through as a saved executable revision.
12. New chat resets React state. Persistent IDs, history and a conversation list are missing from that path.
13. Walrus settings are per user, but Chat does not currently bind a server-authorized project scope.

Reproduce each relevant issue, then classify every visible control as working, intentionally unavailable, example-only or defective. Produce an interaction matrix showing handler, state change, API request, persistence and feedback. Do not say every file was reviewed unless it actually was; state audit coverage precisely.

## Implement projects and persistent conversations

- Reuse existing authenticated sessions.
- Add or reuse server-owned projects and explicit ownership checks.
- New chat creates a unique server record and stable URL, even when the current conversation is empty or the model is disconnected.
- Show project-scoped conversation history with titles, ordering, pagination, rename and reversible archive.
- Persist messages and completion states; restore after refresh and sign-in.
- Use idempotent creation/message requests and concurrency protection.
- Preserve drafts on recoverable failures and avoid duplicate user messages on retry.
- Keep late stream events attached to their original conversation after navigation.
- Clear private cache and cancel outstanding work on logout/account change.
- A new conversation must not replay the previous conversation's transcript. Archiving chat does not delete durable Walrus memories.

Do not use unscoped localStorage as the authoritative conversation store. Load authorized history from the server. Do not silently substitute historical transcript replay for Walrus recall.

## Implement agent creation and meaningful canvas configuration

New agent opens a real form with name, project and template. Create an authorized server record, navigate to its ID and show its starter canvas. Creation should succeed without a model connection; readiness to run is a separate state.

Use a bounded supported pipeline:

User message → optional relevant project-memory recall → configured model → candidate memories → review/explicit auto-save → confirmed Walrus storage.

The canvas is a view/editor for that configuration. Do not pretend it supports arbitrary executable graphs.

- Open an inspector when selecting a node; use clear expand/collapse controls.
- Use stable tool IDs and server-allowlisted handlers, not freeform tool names as executable bindings.
- Show capability availability and required connections per tool.
- Preserve metadata when renaming or reordering tools.
- Replace inert Apply buttons with meaningful actions or Close.
- Keep node layout and viewport separate from execution configuration.
- Fit all visible nodes using measured bounds in both dimensions.
- Provide keyboard and mobile alternatives to spatial navigation.
- Use one authoritative agent name throughout navigation, canvas and runs.
- Save creates a confirmed server revision. Show failures and revision conflicts truthfully.
- Start chat/Test executes a specific saved revision. If there are unsaved changes, offer Save and start, Use saved version, or Cancel.

Wire builder testing and ordinary Chat to one shared authorized runtime that consumes saved instructions, model and tool policies. Verify this by inspecting the actual model request after changing and saving an instruction. A visual edit alone is not evidence of runtime wiring.

Do not add real Console uploads, scheduling, external channels or sub-agent execution unless supported by a complete backend path. Remove unavailable tools from default runnable configurations and explain optional limitations persistently.

## Make Walrus memory do real work

- Store all durable cross-conversation memory payloads on Walrus Mainnet.
- Resolve project ownership, connection and namespace server-side for both recall and writes.
- Treat namespaces as organization, not cryptographic isolation; enforce application authorization and prefer user-owned accounts.
- Keep provider pool access separate from memory access.
- Retain the same authorized memory scope when changing models.
- Use the current query and necessary current-chat context; filter irrelevant results and do not populate arbitrary fallback memories.
- Save durable facts, constraints, decisions and clearly labeled hypotheses. Exclude secrets and temporary chat instructions.
- Default to review before saving; auto-save requires explicit selection and accurate copy.
- Handle corrections and superseded facts without inventing an unsupported remote update/delete API.
- Show pending, confirmed storage and search-indexing states separately.
- Recover accepted jobs after navigation/restart; retries must be replay-safe.
- Label context disclosure accurately, such as “Saved context provided.” Do not assert causal use that was not established.
- Treat recalled text as untrusted reference data.

The event says all memory must be on Walrus. Document where operational transcripts live and where semantic memory lives. Do not claim all historical messages are Walrus-backed unless you implement and verify that archival path. Do not promise eligibility based on an unconfirmed interpretation of operational transcript storage.

## Fix UX without hiding missing functionality

Enabled actions must have a useful outcome. Implement core actions; hide or clearly disable optional unavailable features with a persistent explanation. A disappearing “demo only” toast is not a satisfactory primary interaction.

Use a calm empty state with a concise introduction, useful starters and a visible composer. Replace the plain blue mascot with a small suitable ASCII.rest asset using its real integration instructions and license. Respect reduced motion, settle decorative animation, avoid layout shifts and clean up animation resources.

Use one accessible composer focus treatment, not conflicting inner/outer outlines. Support Enter, Shift+Enter and IME composition. Keep Send/Stop behavior and draft recovery predictable.

Show operation progress only from actual events. Do not animate fabricated file reads, findings, tokens or success. If example mode remains, make its label persistent and prohibit remote writes from it.

Audit duplicated status, incorrect template labels, irrelevant hardcoded project names, clipped canvas nodes, hover-only controls and mobile layout. Keep technical diagnostics outside the default user flow.

## Verification

The prior targeted audit passed type checking and 34 tests across four Chat/Integrations/service test files. These do not prove canvas creation, runtime configuration or full submission readiness. Re-run appropriate checks against your actual final implementation.

Required tests:

1. Create a project and agent; refresh and reopen both.
2. Rename agent and verify all names agree.
3. Save changed instructions and verify the actual runtime request uses that revision.
4. Create chat A, send messages, reload and reopen.
5. Create chat B with a distinct ID and empty transcript.
6. Save synthetic project facts from A to Walrus and recall relevant ones in B without replaying A's transcript.
7. Ask an unrelated question and verify unrelated facts are not shown.
8. Correct a fact and recall its current value in another new chat.
9. Switch models without changing memory ownership.
10. Test another project and another user; tampered IDs must be rejected server-side.
11. Test duplicate requests, stale tabs, failed saves, cancellation, navigation during streaming and logout cache clearing.
12. Test canvas editing, Fit, keyboard use, reduced motion and 390/768/1440 px layouts.
13. Verify unsupported integrations never show fake Ready, Connected or Saved states.

Use deterministic mocked tests for failure cases, database-backed authorization tests and real integration checks separately. Run relevant formatting, lint, type checking, tests and production build. Report existing failures separately from regressions. Do not expose credentials in screenshots or logs.

## Submission and final handoff

Prepare the human recording script and evidence checklist from PRD 03. Verify ten actual Mainnet blobs attributable to the submitting agent; ten messages/facts are not automatically ten blobs. Record actual agent public key, account ID, model ID, public deployment and repository links. No fabricated counts or users.

Prepare reproducible setup docs and an article draft describing the before/after behavior, real integration friction and limitations. Distinguish synthetic demo evidence from real-user adoption.

Do not publish posts, issues, articles, send messages or submit forms without the user's explicit instruction. Do not expose or reuse private keys pasted in earlier conversations as public fixture data.

Final report: confirmed root causes, completed core flows, changed files, actual test results, browser evidence, migration/setup steps, remaining unavailable features and separately identified unverified Mainnet/deployment evidence. Never call the task complete solely because the UI looks polished.
