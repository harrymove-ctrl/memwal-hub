# Builder interaction audit

Date: 8 October 2026. Scope: source tracing of the builder and its runtime boundaries, plus targeted local browser checks. Application code was not edited for this review.

## Coverage and limits

Inspected the repository architecture and the builder's routing, sidebar, agent page, canvas, editors, state/persistence, fixture configurations, example-run service, run lifecycle, discovery preview, Chat, integrations, and relevant API authentication/discovery/memory boundaries. Mapped these against the user-provided event rules.

This is not a claim that every line in the monorepo, unrelated provider adapters, Telegram services or infrastructure has been audited. Those broader systems are dependencies, not verified by the targeted UI checks below. The running worktree contains other ongoing changes; recheck findings before implementation.

Running process inspected: port 5188, frontend cwd `/Users/harryphan/orca/workspaces/memwal-hub/branch/apps/frontend`.

Documentation deliverables are in `/Users/harryphan/orca/memwal-hub/docs/`. These are different checkouts. Do not apply a patch to one and assume the other server changed.

## Why the screenshot feels unresponsive

The visible builder combines functioning view controls, browser-only configuration, sample agents and a separate real Chat/API path. Several controls intentionally show only a demo notice. The canvas does not create or execute an agent graph.

The empty left panel for Research Companion follows from `autoStart=false` and introductory actions being gated to `agentId === "product-discovery"`. That leaves other templates with a composer but little explanation. This is a missing empty state, not evidence that a background operation is running.

## Interaction inventory

Paths below are relative to `apps/frontend/src/features/agent-builder/` unless otherwise specified.

| Control or symptom | Current evidence | Result / required change |
| --- | --- | --- |
| Sidebar + New agent | `components/Sidebar.tsx`: handler calls a demo notice | No creation API, dialog or new canvas; implement creation or visibly mark unavailable |
| More agents | Same file: demo notice | Does not open a catalogue |
| Templates | Same file: demo notice | Does not open a template picker |
| Search | Same file: demo notice | Does not search conversations or agents |
| Inbox and Usage | Same file: demo notices | No real result surface |
| Profile/support/appearance/logout in workspace menu | Mixed local state and notice handlers | Audit against real workspace actions; appearance selection alone does not establish applied theme; logout notice is not sign-out |
| Share | `pages/AgentPage.tsx`: popover explicitly says sharing is unavailable | No share resource or URL is created |
| Save agent disabled | `disabled={!dirty || save === "saving"}` | Expected when no draft differs; explain “No changes to save” rather than suggesting a failed click |
| Save agent after editing | Timer calls `commitDraft`; `state/persist.ts` writes localStorage | Browser-only persistence, no server save or runtime deployment |
| Persistence failure | `saveState()` catches storage errors without reporting them | UI can show Saved even if durable browser storage failed; must expose actual save outcome |
| Rename agent | `commitDraft` updates `agent.config`, while sidebar/breadcrumb read `agent.name` | Name can diverge between canvas and navigation |
| Canvas card body | Cards/list rows are generally display markup | Clicking a file/tool row does not download or execute it |
| Canvas heading | Calls local expand/collapse | Changes visibility only |
| Pencil/Edit | Opens `SectionEditor` | Real form interaction, but applies to local configuration |
| Edit Memory | Textarea recreates name-only memory references | Does not create or bind a real namespace |
| Edit Tools | Rebuilds display tool objects from names | Does not bind runtime handlers; drops optional technical/group/detail metadata |
| Edit Research files | Shows sample-file explanation; no file fields or apply branch | Apply can close without a meaningful edit; use Close/Unavailable until implemented |
| Sub-agent editor | Apply branch exists, but no rendered sub-agent input in inspected editor | Do not present a usable editor until controls and runtime behavior exist |
| Zoom and pan | `Canvas.tsx` updates viewport; connectors are generated from layout | View controls, not graph authoring |
| Fit | Uses a fixed `needed = 760` width rather than all visible node bounds | Larger configurations can remain clipped; fit both dimensions from measured bounds |
| Node dragging | Pointer handling changes viewport | Dragging a card pans the entire world; it does not move an individual node |
| Research Companion header | `RunPanel.tsx` hardcodes `product-discovery-agent` and `Past 7 days` | Wrong agent identity and unsupported time-range implication |
| Research file location | `Canvas.tsx` hardcodes `MemWal / Product Discovery` | Wrong project/folder label for other templates |
| Research Companion reply | Default `createDemoRunService`; prompt path returns fixed demo acknowledgement | Not a live Research Companion execution |
| Product Discovery builder Send | Special branch starts example stage and explicitly does not call a model | Different behavior from `/builder/chat` |
| File analysis preview | `beginRead()` advances stages with timers; fixtures provide findings | Demonstration, not actual reading/analysis |
| Configuration affects live Chat | `RunService.start` receives agent ID/prompt, not config; live API has a fixed Product Discovery system prompt | Editing canvas instructions/tools does not establish that live Chat uses them |
| Integration readiness | API-backed Memory/proxy statuses exist | Connection readiness does not prove a canvas tool has an implementation |
| Console/GitHub | Integrations marks unavailable | Keep unavailable tools out of a runnable default pipeline |
| New chat/history | React state reset in Chat | No persistent multi-chat resources in the inspected path |

These findings are code-derived unless the live verification section says otherwise. They are not all browser-reproduced failures.

## Direct browser checks

Used a separate temporary local tab, without modifying source or saving agent configuration:

1. Opened `/builder/agents/research-companion`.
2. Verified Research Companion heading alongside `product-discovery-agent Past 7 days`.
3. Clicked New agent. Result: “Creating agents is not available in this demo.” No creation flow appeared.
4. Clicked Edit Start. A real editor opened, explicitly stating that changes are stored locally in this browser in demo mode.
5. Cancelled the editor without applying changes.

The temporary browser session did not share the user's authenticated connection state. Its “not ready” indicators do not contradict the user's signed-in screenshot or prove an integration outage. No credentials were entered, no model request was made and no Mainnet write was performed.

The Chrome sidebar and restore-tabs banner in the supplied image are browser UI, not MemWal controls.

## Checks run

Against the inspected running checkout:

- Type checking: passed (`pnpm typecheck`).
- Four targeted Vitest files: 34 tests passed.
- Files: ChatPage, IntegrationsPage, discovery-chat service and model-proxy service tests.
- Test environment emitted a localStorage-file warning; the process still exited successfully.

These passing tests do not cover agent creation or prove a working canvas runtime. No full suite, production build, authenticated end-to-end test or live Mainnet proof was run in this audit. Generated type/build cache files may be refreshed by type checking; application source was not intentionally edited.

## Required product decisions for implementation

Use a bounded workflow builder first: Start → relevant Memory recall → model response → review proposed memories → confirmed save. The canvas configures that shared runtime. Do not promise arbitrary executable graphs merely because the UI draws edges.

Create one persistent agent configuration from an explicit template selection. A canvas is the view of that agent's configuration, not a separate fake object created by clicking a plus icon. Run/Test must execute an identified saved configuration revision.

Retain Product Discovery as the submission path. Keep other agents clearly labeled as templates until they use the same verified runtime with their own instructions and supported tools. Hide or disable unsupported actions with persistent explanations instead of making an enabled-looking control produce only a disappearing toast.

See [PRD 04](../prds/04-agent-builder-and-canvas.md) for the implementation acceptance contract.
