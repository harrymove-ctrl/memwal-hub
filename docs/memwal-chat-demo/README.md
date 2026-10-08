# MemWal Product Discovery: setup and reproducibility

MemWal Product Discovery helps solo builders and small product teams evaluate opportunities using remembered strategy, constraints, research findings and past decisions. It is a chat in the MemWal builder that recalls facts from Walrus Memory on Sui Mainnet, answers through an OpenAI-compatible model gateway (ZRoute), and saves only the facts the user approves.

- Public repository: https://github.com/harrymove-ctrl/memwal-hub
- **Status of this work in the repository:** not committed yet. As of 8 October 2026 the default branch `main` (commit `57f1df2`) and the branch `harrymove-ctrl/branch` (commit `05521ae`) do not contain the chat, the model gateway connection or this folder. Someone with push access has to commit and push it before anyone else can reproduce it.
- Deployed builder: https://builder-production-8b35.up.railway.app/builder/integrations runs an older build without the chat (see `EVIDENCE.md`).

## How a message flows

1. The browser sends the current conversation to the API with the workspace session cookie. Requests from other origins are refused.
2. The API loads this user's own model gateway connection and Walrus Memory connection from Postgres and decrypts the two secrets in memory for this request only.
3. It recalls from Walrus Memory with the message the user actually typed (not a fixed query).
4. It drops weak matches (distance 0.85 or more), secret-looking text and duplicates, sorts the rest newest first and keeps at most six.
5. It sends the model a system prompt, the kept facts in a separate block marked as untrusted reference data (newer facts win when they conflict), and the current conversation only. A new chat starts with an empty conversation.
6. It streams the reply to the browser. The chat shows which remembered facts were provided.
7. It asks the model for up to three durable facts. Nothing is saved until the user selects facts and clicks **Save selected** (auto-save is an opt-in switch).
8. Each fact is submitted to the Walrus Memory relayer on its own. It shows as Saved only when the relayer reports the job `done` with a Walrus blob ID.

## Where data lives

| Store | What it holds | What it is not |
| --- | --- | --- |
| Postgres (the app's database) | Workspace users and sessions, the encrypted gateway key and Memory delegate key, connection status, and one row per save job (job ID, state, blob ID) for status polling | Not conversational memory. The chat never reads facts from here. |
| Walrus Memory on Sui Mainnet | The saved facts, each one stored as a Walrus blob and indexed by the relayer for semantic recall | |
| Browser | The open conversation (React state only) and builder layout preferences | Facts are not kept in localStorage; a reload clears the transcript, and recall afterwards comes from Walrus Memory. |

**Work in progress in the same tree (not part of the recorded demo):** at about 20:23 SGT on 8 October another change added `20261008000025_projects_and_conversations.sql` and `apps/api/src/conversations.rs`, which store projects, chats and their messages in Postgres so a transcript can survive a reload. If that ships, Postgres also holds chat transcripts; Walrus Memory still holds the remembered facts, and archiving a chat does not delete them. The evidence in this folder was recorded before that change.

## Runtime and dependency versions

Measured on the machine used for the recorded demo (macOS 26.3.1, Apple silicon):

| Component | Version |
| --- | --- |
| Node.js | 25.9.0 locally (the API container uses `node:22-bookworm-slim` for the Memory helper) |
| pnpm | 10.28.0 |
| Rust / Cargo | 1.97.0 locally (the API container builds with `rust:1.98-bookworm`) |
| PostgreSQL | 16.14 (Docker) |
| Docker | 29.2.1 |
| Walrus Memory SDK | `@mysten-incubation/memwal` 0.1.8 |
| Frontend | React 19.2.8, React Router 8.3.0, Vite 8.2.0, TanStack Query 5.102.8, TypeScript 6.0.3, Vitest 4.1.10, Playwright 1.62.1 |
| API | Axum 0.8.9, SQLx 0.8.6, reqwest 0.12.24, aes-gcm 0.10.3, Tokio 1.53.1 |

## What you need

- Node.js 22 or newer, pnpm 10, Rust 1.97 or newer, Docker.
- A ZRoute API key (or another OpenAI-compatible gateway: base URL, key and model ID).
- A Walrus Memory **Mainnet** account ID and a **delegate** private key registered on that account. Never use an owner wallet private key.

None of these values belong in the repository. You type them into the masked dialogs in the app.

## 1. Postgres

```bash
docker run -d --name memwal-demo-pg -e POSTGRES_PASSWORD=<local-password> -e POSTGRES_DB=hub_william \
  -p 127.0.0.1:55488:5432 postgres:16-alpine
```

Migrations run automatically when the API starts. `20261008000024_model_proxy_and_memory_jobs.sql` creates `model_proxy_connections` and `memory_write_jobs`. Never edit a migration after it has run: SQLx stores a checksum and refuses to start.

## 2. API

Copy `docs/memwal-chat-demo/env.example` to `apps/api/.env.demo-local` (ignored by git through the `.env.*` rule), fill in the placeholders and run `chmod 600` on it. Then:

```bash
pnpm install --frozen-lockfile
(cd apps/api/scripts/memwal && npm ci)        # Walrus Memory SDK helper used by the API
cd apps/api
set -a; source .env.demo-local; set +a
cargo run --bin hub-william-backend           # listens on PORT, runs migrations first
```

## 3. Frontend

```bash
echo 'VITE_API_BASE_URL=http://127.0.0.1:8080' > apps/frontend/.env.local   # ignored by git
pnpm --dir apps/frontend exec react-router dev --port 5188 --host 127.0.0.1
```

Use the same host name (`127.0.0.1`) for the frontend and the API, otherwise the browser does not send the session cookie.

## 4. Connect in the app

1. Sign in to the workspace: wallet sign-in under Settings → Workspace sign-in, or a username and password account from the site's sign-in page (`POST /auth/register` and `/auth/login` are what the scripts use). Then open http://127.0.0.1:5188/builder/integrations.
2. **ZRouter / OpenAI-compatible proxy → Configure.**
   - API base URL: `https://api-dev.zroute.ai/openai` for ZRoute dev (the part before `/chat/completions`; the backend adds the path and never duplicates `/v1`).
   - API key: your ZRoute key. Pasting the ZRoute install command fills the base URL and key; the command is read, never run.
   - Model: **Load model list** shows the IDs exactly as the gateway returns them. The recorded demo's default is **`gemini-3.8-flash`**.
   - **Test connection** saves and sends one request with at most 32 output tokens, never retried. The card shows Ready only after a real chat completion comes back; an HTML page or a plain save never counts.
3. **Walrus Memory → Connect.** Enter the account ID and the delegate private key. Namespace (default `bew-harness/product-discovery`) and environment are under Advanced; only Mainnet is accepted. **Save and verify** checks that the relayer reports `mainnet`, that the account object exists on Sui Mainnet with the MemWal account type and is active, and that a signed relayer request succeeds.
4. Open **Try Product Discovery** in the sidebar. The model selector in the header switches the model for the conversation; Memory stays the same.

Walrus Console is optional, shows Unavailable and nothing depends on it.

## Credential custody

- The gateway key and the delegate private key are sent once, over the local or TLS connection, from the masked field to the API, and the field is cleared.
- At rest they are encrypted with AES-256-GCM using a 32-byte key from `PROVIDER_CREDENTIAL_ENCRYPTION_KEY`, with a fresh nonce per value, in the user's own row.
- Plaintext exists only in API process memory while a request is handled, and, for Memory calls, in the Node.js helper process, which receives the delegate key on standard input (never on a command line or in an environment variable) and exits after the call.
- API responses, logs and the browser only ever see metadata: base URL, model ID, "key stored (hidden)", status and redacted errors. Error text from upstream is scrubbed of the key before it is stored or shown.
- Gateway calls require HTTPS (plain HTTP only for localhost with `MODEL_PROXY_ALLOW_LOCAL_HTTP=true`), refuse private, link-local and cloud metadata addresses, and do not follow redirects.

## Automated checks

```bash
pnpm --dir apps/frontend typecheck
pnpm --dir apps/frontend lint
pnpm --dir apps/frontend exec vitest run     # mocked backend
pnpm --dir apps/frontend build
(cd apps/api && cargo test)                  # unit tests, mocked
(cd apps/api && DATABASE_URL=postgres://postgres:<local-password>@127.0.0.1:55488/hub_william \
  cargo test --features database-tests)      # real Postgres, mocked gateway on 127.0.0.1, Memory failure paths
cd apps/frontend
node scripts/e2e/ui-check.mjs                # headless browser, new user, no credentials
node scripts/e2e/ui-audit.mjs                # needs the live user from step 1 below; no model calls, no saves
```

## Live scripts (real gateway and Walrus Memory Mainnet)

All run from `apps/frontend` against the running local app in headless Chromium. None prints or screenshots a filled credential field.

```bash
# 1. One-time setup: a JSON file outside the repository (chmod 600) with the keys
#    zroute_key, memwal_account_id and memwal_delegate_key. Delete it afterwards.
STAGE=setup SECRETS_FILE=<path> PROXY_BASE_URL=https://api-dev.zroute.ai/openai MODEL_ID=gemini-3.8-flash \
  node scripts/e2e/live-journey.mjs
# 2. The journey: Conversation A and save, new chat, reload, revised context, new chat. WRITES TO WALRUS.
STAGE=journey node scripts/e2e/live-journey.mjs
# 3. Recall-only replay of the follow-up questions. No writes.
STAGE=replay node scripts/e2e/live-journey.mjs
# 4. No-write checks: second user isolation, unknown model, irrelevant question, model switching, Stop.
SWITCH_MODELS=grok-4.5,claude-sonnet-5-5 node scripts/e2e/live-checks.mjs
```

The throwaway workspace login is kept in `~/memwal-demo-tmp/live-user.json` (mode 600). Evidence goes to `docs/memwal-chat-demo/evidence/`.

## Counting Walrus Memory writes

`GET /memory/stats` (signed in, Memory connected) is read-only and reports:

- `agent_public_key`: the public key derived from the stored delegate key.
- `on_chain.memwalBlobsForThisAgent`: Walrus Blob objects on Sui Mainnet owned by the account owner whose `memwal_agent_id` metadata equals that public key and whose `memwal_package_id` is the Mainnet MemWal package. This is chain data; every owned blob is checked.
- `namespaces[].memoryCount`: the relayer's own index per namespace.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| ZRouter stays **Needs attention** with "did not answer like an OpenAI-compatible Chat Completions endpoint" | The base URL points at a web page. Use the URL before `/chat/completions` (`…/openai` for ZRoute). |
| Replies stop mid-sentence; Details shows `Finish reason: length` | Thinking models (Gemini Flash) spend part of the output limit on reasoning. Raise **Maximum output tokens** under ZRouter → Advanced (default 2048, maximum 8192; the demo used 4096). |
| "The proxy is unavailable. Proxy said: no eligible provider account" | The gateway has no provider for that model ID. Pick an ID from **Load model list**. Trying a model in the chat never changes the saved connection's status. |
| Memory shows **Needs reconnect** or "rejected the delegate key" | The delegate key is not registered on that Mainnet account, or the account is inactive. |
| Signed in but every call says "Sign in to the workspace first" | The frontend and API use different host names (`localhost` versus `127.0.0.1`). |
| `invalid_max_output_tokens` | Use a whole number from 64 to 8192. |
