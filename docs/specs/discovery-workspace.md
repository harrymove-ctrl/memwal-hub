# Discovery workspace

The chat page shows a run timeline beside the thread on wide screens.

Stages are Project, Recall, Model, Suggestions, and Save. A stage is completed only from the latest reply's real events. A finished model reply is not a Memory save. "No relevant facts" is skipped, not success. An uncertain job stays uncertain.

Retrieved memory lists only facts the latest reply's recall event included, with blob id when the server sent one. The project record has no purpose or audience field. The panel says that.

Planning roles are `localStorage` notes for the selected project. They are not accounts, invitations, or agents.

Presentation hides the conversation list and leaves the thread, the run panel, and the save controls. Escape or Exit presentation leaves it. It does not change permissions.

Not implemented: a persisted run history after refresh, a team of real members, Console upload, and a graph engine. The canvas on the agent page is still the configuration surface. Open chat is the live run.
