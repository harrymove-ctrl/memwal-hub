# PRD: Live builder execution

The agent screen is a configuration surface. A live run is Chat.

- Open chat is visible in the idle panel and during example preview.
- Open chat goes to `/builder/chat` with the agent key, the revision the user confirmed, and the project when one is known.
- Dirty edits still offer Cancel, Use saved version, and Save and start before that navigation.
- The chat request is `POST /discovery/chat` from `ChatPage`, not a second model client in the builder.
- The request carries the project, agent key, and revision. The server loads that revision.
- A failed chat stays an error. The example panel never marks a live run complete.
- If `GET /builder-agents/:key` fails, the agent page shows an alert. It does not pretend the canvas is the saved revision.
- A project is filled in only from the saved agent or when the account has exactly one project.
- Saved `tools` on the revision are restored onto the canvas when there is no open draft.
- Save agent stays disabled until there is an edit. It saves configuration, not findings.
