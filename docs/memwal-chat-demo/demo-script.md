# Recording script

Public app: https://builder-production-8b35.up.railway.app

Do not record a new Memory save. The attributable count is already 10. Show recall of facts that are already stored.

1. Sign in. Open Get started and show the ZRoute dialog. Say the key is stored and not shown.
2. Open Walrus Memory. Say the account is Mainnet and the agent is `d7ad56db…8aff`.
3. Open Agents, then Product Discovery. Say Save agent stores configuration, not memories.
4. Click Preview example. Read the banner "Example — no model calls or remote writes". Click Preview save and point at "not sent". Point at Console upload unavailable. Click Exit example.
5. Click Open chat. Pick the project that already has memories (`qa-20261009-0318` on the local QA login, or say the public demo account does not own that project).
6. Ask: "What is the LaunchLens priority?" Expect recalled facts and a source line, not the example findings.
7. Start a new chat. Ask: "What is the capital of France?" Expect no project facts.
8. Switch back to the first chat and reload. The transcript is still there.
9. Download is the local report from the example, if you show it. Say it was not uploaded.

Narration must call the example a sample and the chat the live run.

## Bugs to fix, or work around while recording

1. New chat can drop the first character if you type before the box is ready. Click the chat box and pause before typing.
2. The agent page Run panel always returns a canned demo reply, even when the model is connected. Keep it off camera. Use Open chat.
3. A short "What…" question can borrow memories from the previous question until the API deploy is live. Ask off-topic questions in 9 words or more. After that deploy, a plain question such as "What is the capital of France?" is searched on its own. Questions that start with "and", "but", or "so", or that say "that" or "it", still include the previous question.
4. The bottom of the model setup dialog is cut off on a normal laptop. Scroll inside the dialog.
5. Do not record on a phone and do not zoom the browser to 200%. Text contrast is low. Pinch zoom was blocked; the new frontend allows it. On a phone the chat list covers the messages, so use Hide chats.
