# PRD: Findings, memory, and reports

Live findings belong to chat, not the example panel.

- After a real reply, `POST /discovery/suggest` proposes facts. The user selects them.
- Save uses `POST /discovery/memories` with the project id, a client id, and the agent revision when the chat has one.
- Status comes from `POST /discovery/memories/status`. Saved is shown only when the job is done and has a blob id.
- A failed or uncertain job can be retried with the same client id. The server must not create a second blob for a confirmed job.
- Missing or unauthorized projects are rejected by the API. Chat does not fall back to an account-wide namespace.
- Example findings are not live findings. They have no blob id and no save job.
- There is no Walrus Console upload in this release. The local download is the report.
- Sample file names in the example are not connected files.
