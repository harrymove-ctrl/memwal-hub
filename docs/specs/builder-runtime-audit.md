# Builder runtime audit

Checkout: `/Users/harryphan/orca/workspaces/memwal-hub/branch`. Live chat and Product Discovery share one frontend. The real model and Memory calls are in `ChatPage` via `discovery-chat.ts`. The agent screen's preview is a separate example and must stay that way.

| Action | Component | Handler | Service/API | Persistence | Kind | Defect | Repair |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Open chat | `RunPanel` | `onOpenChat` (button) or `NavLink` | `/builder/chat?agent&rev&project` | none until chat | Real | Hidden once an example stage started; example link skipped dirty check | Idle and every example stage keep Open chat. Example uses `onOpenChat` so dirty revisions still prompt. Exit example returns to idle, including during reading/analyzing. |
| Preview example | `RunPanel` | `onPreviewExample` / `setStage("files")` | none | local React state | Example | Composer said "Enter to send" and started the example | Composer says it does not send. Enter only notifies. |
| Example findings | `DiscoveryFlow` | local select/edit | none | none | Example | Looked like records | Label "Example — no model calls or remote writes". Files are marked example. |
| Preview save | `DiscoveryFlow.saveMemory` | local | none | none | Example | Called `/memory/remember`, which the API does not expose, and then disabled the button | Button is "Preview save (not sent)". Status Skipped. No fetch. Button stays enabled. |
| Console upload | `DiscoveryFlow` | was `saveReport` | none | none | Unavailable | Status Failed and "Retry upload" with no request | Disabled "Console upload unavailable". Local download only. |
| Live message | `ChatPage` | composer submit | `POST /discovery/chat` | conversation rows | Real | Builder composer did not use this | Open chat is the live entry. |
| Suggestions | `ChatPage` | after a reply | `POST /discovery/suggest` | none until save | Real | Not the example findings | Unchanged. Example findings are not suggestions. |
| Save findings | `ChatPage` | Save selected | `POST /discovery/memories` then status | Walrus job | Real | Example path could not use this contract | Example does not save. Live chat still uses `saveFacts`. |
| Agent save | `AgentPage.persist` | Save agent | `POST /builder-agents` | `agent_revisions` | Real | Reload dropped `tools` | `get` returns tools; `toolsForCapabilities` restores them unless a draft is open. |
| Hydration | `AgentPage` | `getAgentRevision` | `GET /builder-agents/:key` | store | Real | Errors were swallowed. Many projects picked `rows[0]`. | Alert on failure. Auto-select only when the agent has a project or the user has exactly one. |
| Inbox, templates, search, usage | `Sidebar` | `onNotice` | none | none | Unavailable | Copy said "demo" | Copy says not available in this workspace. |

Confirmed, not a hypothesis: `RunPanel` passed `exampleMode` always. `DiscoveryFlow` posted to `/memory/remember` and `/memory/console/report` when that flag was false. Those routes are not the scoped save API. The example branch reported Console as Failed without a request.
