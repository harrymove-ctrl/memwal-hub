# Demo script

Public URL: https://builder-production-8b35.up.railway.app

Do not save new facts on camera unless a new write is authorized. The count is already 10. The production demo account does not own the projects that hold those blobs. On the local QA login, project `qa-20261009-0318` already recalls "improving onboarding".

1. Sign in. Click Get started. The ZRoute dialog opens. Say the key is stored and not shown. Test connection. Ready means the gateway answered.
2. Open Memory. Say this is a connection check, not a new blob. The agent is `d7ad56db…8aff` on Mainnet.
3. Open Product Discovery. Say Save agent stores instructions, not memories.
4. Click Preview example. Read "Example — no model calls or remote writes". Click Preview save (not sent). Point at Console upload unavailable. Click Exit example, then Open chat.
5. In a project this account owns, ask one real question. If there are no saved facts, say so. Do not pretend LaunchLens facts were recalled.
6. On the local QA project, ask "What is the LaunchLens priority?" Expect recalled onboarding facts. Then ask "What is the capital of France?" Expect no project facts.
7. New chat, switch back, reload. Transcripts stay in Postgres. Facts, when saved earlier, are Walrus blobs.

Narration: the example is a sample. Chat is the live run. A Ready badge is not a conversation.

## Bugs to fix, or work around while recording

1. New chat can drop the first character if you type before the box is ready. After this build, focus waits until the new chat exists. If a character still disappears, click the box and pause before typing.
2. The agent page Run panel still answers with a canned demo, even when ZRoute is connected. Do not type there. Use Open chat. Keep that panel off camera.
3. A short question that starts with "and", "but", or "so", or that points at "that" or "it", still searches the previous question too. A plain "What is the capital of France?" no longer does, once this API build is deployed. Until you see that deploy, ask off-topic questions in 9 words or more.
4. The model setup dialog is taller than a laptop screen. Scroll inside the dialog to reach Test connection. Do not assume the bottom is missing.
5. Do not record on a phone, and do not use 200% browser zoom. Pinch zoom is allowed again after this frontend deploy. Text contrast is still low. On a phone the chat list sits on top of the messages; use Hide chats.
