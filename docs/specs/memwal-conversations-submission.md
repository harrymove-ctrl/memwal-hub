# MemWal Product Discovery: conversations and submission specification

Status: proposed implementation contract, not a claim that these features have shipped.
Reviewed: 8 October 2026. Source of event requirements: the rules pasted by the user.

## Product goal

MemWal helps solo founders and small product teams continue product discovery across conversations and models. It remembers approved product facts, research findings, constraints and decisions through Walrus Memory on Mainnet. A new conversation starts with its own transcript and can selectively recall relevant project memories.

MemWal manages application identity, project permissions, conversations and model connections. Walrus Memory stores and retrieves durable project context on Mainnet. The repository's development harness is an internal engineering workflow; it is not the product name, a required product dependency, or a chatbot runtime. Do not describe a runtime harness integration as shipped without implementing and demonstrating it.

Keep Product Discovery as the primary submission. Gemini or Grok can be the primary model for the alternative-model category; record the actual upstream model/version and runtime/proxy. Claude can be an additional supported option, but a proxy alone does not change the model's underlying provider.

## Confirmed implementation gaps

The inspected active implementation was under `/Users/harryphan/orca/workspaces/memwal-hub/branch`; confirm the running checkout again before editing.

- `ChatPage.tsx` keeps the transcript in React state.
- `newChat()` clears that state and the draft. It does not create a persistent conversation record.
- The New chat button is disabled when both the transcript and draft are empty.
- Sidebar navigation points to `/builder/chat`, with no list of saved conversations.
- `ChatRequest` carries messages, a memory flag and an optional model; it does not identify a project or conversation.
- Walrus settings are loaded using the authenticated user. A configurable namespace exists, but Chat currently does not resolve project membership or a project namespace.
- Memory write jobs already track acceptance and confirmed blob IDs. Preserve that distinction.

These findings are from source inspection, not a successful live end-to-end test.

## Required user experience

1. Sign in and select a project. Start with private projects; team sharing requires explicit membership and permission checks.
2. Click New chat to create a server-issued conversation ID in that project. Model connectivity must not prevent creating an empty conversation.
3. Navigate to its stable URL and show an editable empty state. Prevent duplicate creation while the request is pending; preserve the current chat if creation fails.
4. Send a message. Persist it in that conversation before generation; distinguish pending, completed, interrupted and failed responses.
5. List conversations by recent activity with readable titles. Opening one restores its own transcript, not another chat's in-memory state.
6. Refresh or sign in again and restore the same conversation from the backend.
7. Create chat B. Its transcript is empty, but relevant approved memories from chat A remain available within the authorized project.
8. Switch projects. Chat lists and recalled project memories change together. Never retain facts from the previously selected project in context.
9. Archive a conversation without deleting its durable project memories. Use separate, accurately described controls for memory management.

Use an accessible project selector and conversation list. On mobile, the list may be a drawer. Distinguish loading, no chats, authentication required and service failure; do not turn failed loading into an empty list.

## Storage and authorization

Separate these concerns explicitly:

| Concern | Responsibility |
| --- | --- |
| Identity, project membership, conversation ownership | Existing Hub authentication plus server authorization |
| Chat IDs, titles, ordering, request state and transcript history | Persistent application conversation store |
| Durable facts recalled across conversations | Walrus Memory Mainnet |
| Blob IDs, write-job state, provenance and receipts | Application metadata referring to actual Walrus storage |

Conversation history must never become a hidden substitute for Walrus recall. When generating in B, only B's transcript and the authorized Walrus recall result may supply conversational context; do not automatically inject A's transcript, database summaries or browser history.

The rules say “All memory must be stored on Walrus.” Store every cross-conversation memory payload on Walrus. Document operational transcript storage honestly. If claiming that every historical chat message is also stored on Walrus, implement and verify that archival path first; do not make that claim about ordinary database history. The pasted rules do not explicitly settle whether operational transcript copies are included, so obtain organizer clarification before claiming this distinction guarantees eligibility.

Private-project scope must be determined by the server from the authenticated user and authorized project. Do not accept owner IDs or arbitrary namespaces as authority from the browser.

Namespaces organize data; they are not cryptographic access control. A delegate can have account-wide access. Prefer user-owned Walrus accounts and avoid presenting one shared delegate with different namespaces as strong tenant isolation.

Project creation stores an immutable namespace binding. Renaming a project does not rename its memory scope. Never migrate existing unscoped memories into every project. Offer an explicit association/import path with provenance and no automatic rewriting of remote blobs.

Provider pool membership grants model access, not access to the pool owner's conversations or memory. Switching models does not switch memory ownership.

## Proposed data and API contract

Adapt names to existing conventions after inspecting schemas; these are proposed routes, not existing APIs.

Data:

- Project: ID, owner, name, memory connection reference, immutable namespace, timestamps; membership only if team sharing is implemented.
- Conversation: ID, project ID, creator, title, model preference, timestamps, archive state and revision.
- Message: ID, conversation ID, ordered sequence, role, content, response state, request ID and timestamps.
- Memory provenance: project ID, source conversation/message ID, remote job/blob ID and confirmed state. Avoid creating a second semantic memory database.

Routes:

- List/create authorized projects.
- List/create conversations within a project, with pagination.
- Read/rename/archive a conversation after authorization.
- Append a message and stream its response using a conversation ID and an idempotent request ID.
- Retrieve the authorized conversation's message history.
- Recall, suggest and save memories within the server-resolved project scope.

Every read and mutation must verify ownership/membership, including stream start, history, recall, save and job-status access. Inaccessible IDs should not expose resource contents or existence through descriptive error messages.

Generation should load the current authorized transcript server-side. Validate roles and lengths; do not permit clients to inject privileged system messages. Do not silently truncate the stored history; bound only the context sent to the model.

Preserve replay-safe message writes. Serialize conflicting updates or use revision checks. A stale browser tab must not overwrite newer messages. Persist response completion on the server so a successful answer does not disappear when its browser tab closes.

Navigation during generation must cancel or safely detach the active request according to one documented policy. Late response chunks must remain associated with the original conversation ID. Memory save jobs already accepted by Walrus remain associated with their original source even if the user switches chats.

Scope client query caches by authenticated user, project and conversation. Clear private state and cancel outstanding requests on logout/account change. Do not store transcripts or secrets in an unscoped browser cache.

## Memory behavior

- Extract durable facts, not every utterance. Keep facts separate from proposals, hypotheses and generated recommendations.
- Manual review is the default; auto-save is explicit and accurately described.
- Recall against the current request with only the limited current conversation context needed to resolve references.
- Filter irrelevant results; do not fill the panel with arbitrary recent facts when no relevant match exists.
- Retrieve only authorized project memory. Optional personal preferences require a separately defined scope and explicit inclusion policy.
- Preserve provenance and corrections. A newer explicit team-size update should supersede an older value without pretending the earlier remote blob was erased.
- Memory off disables cross-chat recall and memory writes, while ordinary current-chat history continues to work.
- Label disclosure as “Saved context provided” unless actual use by the model is established.
- Accepted, stored and searchable are separate states. Retain confirmed blob IDs and recover jobs after navigation/restart.
- Treat recalled text as untrusted data, never as executable instructions.

## MemWal and development-harness boundary

For this submission, reuse existing identity, provider integration and deployment infrastructure. Keep memory orchestration in the explicit Product Discovery service. Do not silently inject it into every transparent gateway request.

An optional future local-agent adapter can expose authenticated project-scoped recall/save tools to local development clients. Such an adapter must reuse the same authorization and provenance rules. It is not required for the chatbot submission and must not delay the working web chat.

Walrus Console is optional. Keep it unavailable if its real integration is unavailable. No Console upload or connection label should imply that a Walrus Memory write succeeded.

## Verification and recording script

Use synthetic data in a dedicated demo project. Capture real outputs; the expectations below are assertions to verify, not prewritten assistant answers.

1. Create project LaunchLens, then chat A, “Product baseline.” Record its ID.
2. Send: “We are building LaunchLens for solo SaaS founders. Our team has two engineers and a six-week release window. Improving onboarding is the priority. Team workspaces are deferred. Please suggest which facts are worth remembering.”
3. Review the extracted facts, save selected facts, and wait for confirmed storage. Show the corresponding real blob references.
4. Reload and reopen A to demonstrate persistent history.
5. Create chat B, “Release decision.” Show a different ID and empty transcript.
6. Send: “Should we prioritize team workspaces in our next release? Explain using the constraints you remember.”
7. Verify that relevant constraints were recalled from Walrus and influenced the answer. Inspect the model request to prove A's transcript was not replayed into B.
8. In a separate fresh chat with Memory off, ask the same question. The assistant must not claim to know LaunchLens's stored constraints. Do not guarantee identical model wording or scores.
9. Save the correction: “Our team has grown to four engineers. The six-week release window is unchanged.” In another new chat, ask for the team size and verify the correction.
10. Switch to another configured model and repeat a relevant question in a fresh chat. Record actual model IDs, not just the proxy brand.
11. Create a separate project with unrelated facts. Verify that LaunchLens context does not appear there.
12. Test another authenticated user and tampered project/conversation IDs. Access must be denied, not just hidden in the UI.

Additional automated checks: message ordering, duplicate-send prevention, stale revision conflicts, retries, cancellation, late events after navigation, save-job recovery, logout cache clearing, database restart, keyboard navigation and mobile layout.

Use mocks for deterministic failure cases and separate real Mainnet verification. Never label a mocked blob ID as submission evidence.

## Submission evidence checklist

The pasted deadline is 9 October 2026 at 14:00 UTC, or 22:00 Singapore / 21:00 Vietnam. This date comes from the supplied rules, not a fresh verification of the event website.

- Public working chatbot URL with clear judge access instructions; localhost is not sufficient.
- Actual agent public key and MemWalAccount ID, verified against the configured account. Do not submit private keys.
- At least ten actual Mainnet blobs written by the submitting agent, with attributable evidence. Ten messages or ten extracted facts are not automatically ten blobs. Exclude unrelated blobs from other agents on the same account.
- Public repository containing the working implementation, migrations, dependency lockfiles, safe environment examples and reproducible setup instructions.
- Model provider, exact model/version and runtime/proxy; use Gemini or Grok as the documented primary model if applying to Beyond the Big Two.
- Evidence from real users, with consent and appropriate redaction. A synthetic self-demo proves functionality but does not by itself establish real-world adoption.
- Published article on Medium or Inkray: problem, architecture, integration steps, before/after memory comparison, actual use, limitations and reproducibility.
- Walrus Memory feedback: at least one genuine friction point and improvement idea. Link only issues actually created.
- DeepSurge submission and the required submission form; avoid duplicate form entries.
- Dedicated reward wallet address, required Discord membership, and the requested X article share.

Do not invent counts, users, benchmarks, public links or eligibility confirmation. Do not publish articles, messages, GitHub issues or submission forms merely because this specification lists them; prepare reviewable drafts and obtain the user's explicit publishing instruction.

## Copy-ready implementation instruction

Implement this specification in the actual running MemWal checkout. First inspect current code and preserve unrelated work. Reuse MemWal's existing session authentication and model connection. Build persistent, individually identified conversations with project-scoped authorization, history, navigation and refresh recovery. Make Walrus Memory the real source of durable cross-conversation context, with server-resolved scope and traceable Mainnet writes. Keep the development harness's role distinct from runtime orchestration.

Deliver the vertical slice in this order: project/conversation persistence and authorization; UI creation/list/switch/history; scoped recall and reviewed writes; failure recovery and isolation tests; real integration verification; demo and submission documentation. Do not substitute browser-only history, simulated connected states or prewritten replies for working functionality.

Run the repository's applicable formatting, lint, type, test and build checks. Add database-backed ownership tests and browser tests for creating A, saving memory, creating B, recalling relevant facts, refreshing and switching projects. Report mocked tests separately from real API/Mainnet tests. Document any unavailable runtime dependencies and do not claim the feature is deployed or the submission eligible without evidence.
