# MemWal remembers the project, not the browser tab

Draft. Not published.

Solo builders lose decisions between chats. MemWal is a project chat. A new conversation starts empty. Relevant facts come from Walrus Memory on Sui Mainnet, not from the previous transcript.

The user connects an OpenAI-compatible gateway. The last production test used `gemini-3.8-flash` through `https://api-dev.zroute.ai/openai`. The gateway reported the same id. The key is stored encrypted and is not shown again.

Memory uses a delegate key for account `0x8cdb1897153b715dac04b69bd4cb5091d9e385e2b63349a76c20c122ce3abe15`. The agent stamped on blobs is `d7ad56dbb589a331a7cc2a3ce64320256490531cb09cdd5e4470cf8d09a58aff`. On 2026-10-09 a read-only scan found 10 blobs for that agent. Chat messages stay in Postgres. Only approved facts are sent to the relayer.

The builder has an example preview. It uses fixed sample findings and does not call a model or Walrus. Live answers are Open chat.

Setup is in `docs/memwal-chat-demo/README.md`. Put secrets in the dialogs, not in the repo.

Limitation: a new account cannot recall blobs written under another account's project id. QA sessions are not independent users.
