# Builder runtime integration

## Live entry

`AgentPage.executeRun` for intent `chat` navigates to `/builder/chat?agent=<key>&rev=<revision>&project=<id>`. `ChatPage` loads that revision with `GET /builder-agents/:key` and sends `POST /discovery/chat`.

Request fields used by chat: `messages`, `use_memory`, `project_id`, `agent_key`, `agent_revision`. The server resolves the revision for the signed-in user and refuses another user's agent.

## Persistence

Projects and conversation messages are Postgres rows. Long-term facts are Walrus blobs written only by `/discovery/memories` after the user saves. Chat history is not a Walrus blob.

## Suggestions and jobs

`POST /discovery/suggest` returns proposed facts and writes nothing. `POST /discovery/memories` accepts a job. `POST /discovery/memories/status` reports pending, saved, or failed. The client id is the idempotency key.

## Example

`DiscoveryFlow` has no `fetch`. `exampleMode` only changes the banner. Console status is the constant "not available".

## Capabilities

`POST /builder-agents` stores `tools` of `memwal_recall` and `memwal_remember` only. `GET` returns them. `toolsForCapabilities` rebuilds the canvas tools. A dirty draft is not overwritten.

## Reload errors

A failed `GET /builder-agents/:key` sets `hydrateError` on the agent page. Project auto-select requires `rows.length === 1` or a `project_id` on the revision.

## Report

`downloadReport` creates a `text/plain` blob and clicks a download link. It does not call the API.

## Migrations

No new migration. Revisions already store `tools` and `project_id` (`20261009000027`, `20261009000028`).
