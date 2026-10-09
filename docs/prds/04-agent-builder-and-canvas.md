# PRD 04 — Agent creation, useful canvas and executable configuration

Status: proposed. Date: 8 October 2026.
Inputs: [interaction audit](../specs/builder-interaction-audit.md), [conversation PRD](01-projects-and-conversations.md), [memory PRD](02-project-memory-and-runtime.md).

## Outcome

A user can create an agent inside a project, understand and edit its behavior on a canvas, save a real configuration, then start a conversation that executes that exact configuration. Every enabled action produces a useful, observable result.

This is a bounded configuration builder for MemWal's supported runtime. Arbitrary graph programming is outside the first release.

## Vocabulary

| Object | Meaning |
| --- | --- |
| Project | Authorization and durable-memory scope |
| Agent | Named assistant configuration in a project |
| Agent revision | Immutable saved instructions/model/tools used by a run |
| Canvas | Visual editor for that configuration; not a separate runtime |
| Conversation | Persistent transcript with its own ID |
| Run | One identified generation/orchestration operation |
| Walrus agent ID | Delegate public key used for storage attribution; not the builder agent UUID |

UI labels, API fields and submission documentation must keep these identities distinct.

## Create agent flow

1. Click + beside Agents or Create agent in a real empty state.
2. Open an accessible dialog: name, project, template and short description.
3. Offer Product Discovery as the supported default. Other templates show their actual capability status.
4. Display model and Memory prerequisites; creation is allowed without credentials, execution is not falsely declared ready.
5. Submit once with an idempotency key. Server verifies project access and creates the agent/configuration record.
6. Navigate to the returned agent ID. The sidebar, breadcrumb and canvas use one authoritative name.
7. Open a useful starter canvas and an explanation: “Configure your assistant, then start a chat.”

On failure, keep entered values and show a retry action. Do not seed a fake successful record in localStorage. Refresh must restore the created agent for the authorized user.

## Supported canvas for the first release

| Section | Editable configuration | Runtime effect |
| --- | --- | --- |
| Start | User-message trigger | Starts a turn in the selected conversation |
| Project memory | Enabled state and authorized project binding | Controls scoped retrieval; cannot specify another owner's namespace |
| Agent | Name, description, instructions and available model | Builds the model request using a saved revision |
| Recall policy | Relevant-context behavior and supported limits | Actual server retrieval/filtering policy |
| Review memories | Manual review or explicit auto-save | Gates remote writes according to selected policy |
| Save memories | Enabled storage capability and connection state | Submits replay-safe jobs and displays confirmed outcomes |

Do not label read-only policy text editable unless it really changes behavior. Only expose numeric retrieval controls if users can understand them and the backend validates them; otherwise retain tested defaults and put diagnostics in developer details.

Files/Console, schedules, external channels, web research, sub-agents and imported skills remain unavailable unless corresponding real services are implemented. Show a stable explanation and an alternative, such as pasting research notes into Chat. Do not render sample filenames as if they were accessible files.

## Canvas interactions

- Clicking a node selects it and opens an inspector with clear Edit controls.
- Expand/collapse only changes visibility and uses a distinct affordance.
- Clicking a tool opens its description, capability status, required connection and editable supported options. It must not execute the tool unexpectedly.
- Pan the background. Do not make ordinary clicks feel like failed drags.
- If node dragging is supported, update node position only; it must not silently change execution order. Persist layout separately from runtime configuration.
- If node dragging is not supported, make the canvas a clear auto-layout view; do not display misleading draggable handles.
- Fit computes bounds from all visible nodes and available width/height, including toolbar padding.
- Keyboard users can reach every node and inspector control; a list/configuration view provides an alternative to spatial navigation.
- Provide 100% reset and Fit as distinct actions.
- Show useful empty states in both configuration and run panels for every agent, not just Product Discovery.

Use short entrance motion and reduced-motion support. Configuration can be visible immediately; actual runtime results must not appear before execution. ASCII.rest decoration belongs in appropriate empty states, not every node or connection.

## Save semantics

Editing changes a draft. Save validates and persists a new configuration revision on the server. Show pending, confirmed, failed and conflict states from actual results, without a timer simulating a network save.

The Save button is disabled only when unchanged or pending, with a readable explanation. Apply in an inspector updates a real draft field; informational inspectors use Close instead of an inert Apply button.

Preserve stable tool IDs and all required metadata. Do not rebuild executable tool bindings from freeform names or list indices. Renaming must update navigation and canvas consistently.

Use optimistic concurrency. If another tab saved a newer version, preserve the user's edits and expose a conflict; never silently overwrite.

## Test and chat flow

Primary action: “Start chat.” Optional secondary action: “Test agent” in a clearly identified test conversation.

Resolve prerequisites before generation. If required Memory is disconnected, explain and offer Connect or an explicit supported run-without-memory mode. Console being unavailable must not block a memory-only chatbot.

If there are unsaved changes, offer Save and start / Use saved version / Cancel. Every run records the exact revision it executed. Changing the canvas mid-run does not change the running operation.

Use one shared backend orchestration path for Chat and agent testing. The frontend view may differ, but the selected agent's instructions, model and tools must be consumed by the same authorized runtime. Do not keep a scripted builder reply beside a real chat reply without a persistent Example mode label.

Events should describe real operations: starting, recalling if applicable, generating, awaiting review, saving and terminal outcome. Simulated token counts, hardcoded date ranges and example findings must not be presented as runtime evidence.

## Tool capability registry

Each tool has a stable ID, display name, implementation/version, input schema, operation type, required connection, permission requirements and actual availability status.

The server allowlists executable tool IDs. The UI cannot register arbitrary shell commands or HTTP destinations by editing a label. Memory tools resolve project scope server-side. Write tools require the selected review/consent policy and replay-safe jobs.

Keep unsupported tools out of the default execution path. An icon or descriptive card does not prove a capability is callable.

## Proposed persistent records

- Agent: ID, project ID, display metadata, template origin, current revision, archive state.
- Agent revision: immutable configuration JSON with schema version, validated tool bindings, creator and timestamps.
- Canvas layout: agent ID, node positions/viewport, layout version. This does not grant runtime permissions.
- Run: conversation ID, agent revision ID, request ID, actual model ID, status and timestamps.
- Run events: operation status and safe references; no secrets or private model reasoning.

Proposed API capabilities: create/list/read/update/archive agents; validate/save configuration revisions; read capabilities; start/cancel/read runs. Reuse existing endpoints where their contracts fit. Update OpenAPI and typed client generation according to repo conventions.

## Existing UI action policy

Create agent and Start chat are core and must be implemented. Search, Templates, Share, Usage, skills installation and account menu items must either reach their actual feature or be removed/visibly unavailable with an explanation. Do not spend the deadline implementing all secondary features solely to keep decorative buttons.

Workspace logout must call the real session logout flow. Unavailable sharing must not create a public link or imply access permissions changed. Model integrations remain distinct from agent creation.

## Acceptance and regression tests

| ID | Test | Expected |
| --- | --- | --- |
| B01 | Create from Product Discovery template | New server agent ID, route, sidebar entry and initial configuration |
| B02 | Reload and reopen | Saved configuration survives; authorized ownership remains enforced |
| B03 | Rename | One consistent name in sidebar, breadcrumb, canvas and run header |
| B04 | Edit instructions, save, run | Actual model request contains the saved instruction revision |
| B05 | Disable memory capability | Runtime performs no recall or new memory write |
| B06 | Unavailable Console tool | No false execution or connected state; memory-only chat remains usable |
| B07 | Inspect Research files when unavailable | Informational view with Close; no useless Apply |
| B08 | Save fails or storage conflicts | No Saved label; draft survives; actionable recovery |
| B09 | Switch agents while running | Events remain attached to original run/agent |
| B10 | Large canvas and mobile | Fit exposes all nodes; controls remain keyboard/touch accessible |
| B11 | Edit tool labels/order | Stable IDs, handler bindings and permission requirements are preserved |
| B12 | Unauthorized agent/revision IDs | Server rejects access before model/tool execution |
| B13 | Enter page without running | No fabricated result, token usage, findings or success event |

## Delivery priority

P0: honest action states; working creation; persistent configuration; shared runtime wiring; consistent identity; project authorization; Product Discovery path.

P1: additional supported templates, canvas refinements, history search and better run diagnostics.

P2: arbitrary graphs, external scheduling/channels, Console file workflows, sub-agent execution and skill marketplace installation.

If time is limited, ship a smaller honest product. A polished executable Product Discovery agent with genuine cross-chat memory is stronger submission evidence than five nonfunctional templates.
