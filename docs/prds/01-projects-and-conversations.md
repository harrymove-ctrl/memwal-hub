# PRD 01 — Projects and persistent conversations

Status: proposed. Priority: submission-critical. Date: 8 October 2026.
Companion: [Implementation and submission specification](../specs/memwal-conversations-submission.md).

## Outcome

A founder can open MemWal, select a product project, create separate conversations, reopen earlier work and continue after refreshing the browser. Conversation history is reliably saved; useful cross-conversation facts come from Walrus Memory.

Primary persona: a solo founder or small-team product lead who revisits product decisions over several sessions. Secondary persona: a judge evaluating whether the assistant remembers without replaying an old transcript.

## Problem and current gap

The current Product Discovery screen holds its transcript in React state. New chat clears that state rather than creating a persistent resource. The sidebar has no conversation history. This makes the action feel broken and prevents a convincing cross-session demonstration.

## Stories and acceptance criteria

| ID | Story | Acceptance |
| --- | --- | --- |
| C01 | Select a product project | Only projects the signed-in user may access appear; an inaccessible project URL returns no private data |
| C02 | Create a conversation | New chat creates a distinct server ID and stable URL, even when the currently open chat is empty or the model is disconnected |
| C03 | Avoid accidental duplicates | Disable only while creation is pending; retries reuse a creation request ID |
| C04 | Browse history | List titles and recent activity within the active project; support pagination without losing selection |
| C05 | Reopen work | Clicking a conversation loads its own messages in order; refresh restores the selected conversation |
| C06 | Continue after errors | Failed generation preserves the user message and draft where appropriate; retry does not duplicate the user turn |
| C07 | Rename and archive | Rename changes display metadata; archive removes from the default list and remains reversible |
| C08 | Protect memory | Archiving a conversation does not delete remote memories; the UI states this accurately |
| C09 | Keep separate contexts | A new conversation does not inherit another conversation's transcript; project memory may be recalled separately |
| C10 | Switch safely | Late stream chunks and save-job updates never render in the newly selected chat |
| C11 | Sign out safely | Private query caches and active requests are cleared/cancelled; another login never sees the previous account's history |
| C12 | Use on mobile | Project and chat selection, composer and response remain usable at 390 px width and with the keyboard open |

Private projects are the initial release. Team access is a later feature unless existing, verified project membership infrastructure can be reused. Organization membership alone must not silently expose personal memories.

## Information architecture

Within the existing MemWal shell:

- Project selector with current project name and Create project.
- New chat as the primary conversation action.
- Chats list with current selection, title and recent activity.
- Product Discovery conversation area.
- Compact model selector and Memory on/off state.
- Secondary settings for auto-save and integrations.

Keep agent templates separate from actual conversations. “Product Discovery” describes the assistant; “Release prioritization” describes an individual chat. The agent template's ID, a chat ID and a Walrus agent public key are different identifiers.

Suggested URL contract: `/builder/chat?project=<project-id>&conversation=<conversation-id>`. Adapt this to the router's established conventions. Browser Back and Forward must restore the correct selection. Do not silently fall back to an unrelated chat when a URL is unauthorized or missing.

## Detailed flows

### First visit

Loading session → sign in if needed → load authorized projects → show Create your first project if empty → create/select project → show existing chats or Start a conversation.

Do not automatically create a new empty record on every page mount or refresh. Creation is an explicit user action. For an existing selected chat, do not flash another project's content while loading.

### New chat

User clicks New chat → show pending action → server creates conversation once → list updates → navigate to returned ID → empty conversation with composer.

If a reply is running, stop it and preserve its partial text as interrupted before navigation, or safely detach it server-side. Choose and document one behavior. Never imply a background reply will complete if the runtime cancels it.

If the current draft is nonempty, preserve it with the current conversation or offer Keep draft / Discard / Cancel. Do not silently lose it. Memory writes already accepted remotely must remain trackable without blocking creation.

### Title

Initial title: “New chat.” Derive a readable title from the first user message without an extra billable model call; allow manual rename. Do not overwrite a manually edited title after subsequent messages.

### Save and recovery

Persist the user turn before requesting model generation. Associate the assistant reply with its request ID. Persist completion server-side. Recover interrupted generations honestly after refresh; never represent partial text as a completed reply.

Show “History saved” only when the conversation store confirms it. If history persistence fails, show a retryable error and retain visible text. This status is separate from “Saved to Walrus Memory.”

## UI details

- Replace the placeholder blue mascot with small ASCII.rest artwork if working on the empty state. Preserve its license and use its actual supported integration.
- Keep the decoration separate from loading and success indicators. Respect reduced motion and avoid indefinite distracting animation.
- Put keyboard focus treatment on the rounded composer without removing accessible focus elsewhere.
- Enter sends, Shift+Enter adds a line, IME composition does not submit.
- Auto-scroll only when the user is already near the latest message; otherwise offer Jump to latest.
- Use distinct loading, empty, error and permission states.
- Keep diagnostic IDs available through Details/Copy ID, outside the primary chat copy.

## Data and API requirements

Use server-owned project and conversation records with stable UUIDs. A project-to-conversation foreign key and per-query owner/membership checks are mandatory. Messages have stable IDs and an ordered sequence. Enforce idempotency and concurrency protection; a stale tab cannot replace the full transcript with an older copy.

Reuse existing authentication. Never accept a browser-supplied user ID as authorization. Do not rely on localStorage as the authoritative history store.

Project name and chat title validation, pagination, request limits and error shapes must be documented with the implementation. Server and client validations must agree. Introduce migrations without deleting existing memory connections or write jobs.

## Non-goals for this release

Branching chats, collaborative editing, attachments, voice, share links, multi-agent orchestration and permanent remote-memory deletion. No new provider authentication mechanism if the existing connection works.

## Verification and success

Release criteria are behavioral, not invented usage metrics:

- A → B → A and browser refresh preserve correct transcripts.
- Two tabs cannot silently overwrite each other's messages.
- Duplicate requests produce one conversation/message operation.
- Unauthorized user/project IDs are rejected by the API.
- Stopping or switching during a response does not cross-contaminate chats.
- Failed storage does not show a success label.

Collect actual creation failures, history-load failures and duplicate-write incidents during testing. Do not assign a claimed success percentage without measuring it.
