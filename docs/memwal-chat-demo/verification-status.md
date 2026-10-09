# Verification status (2026-10-09)

Not a submission. Nothing here was pushed, deployed, or sent to a form.

Source: `/Users/harryphan/orca/workspaces/memwal-hub/branch`, branch `harrymove-ctrl/branch`, HEAD `16d50ac` plus uncommitted work (30 files changed, plus untracked files listed below). API `hub-william-backend` 0.1.0. Frontend `@hub-william/frontend` 0.0.0. Logs: `~/memwal-qa/final-20261009/` and `~/memwal-qa/omp-zroute-20261009/EVIDENCE.md`.

## Checklist

### 1. Automated checks and builds

| Check | Result |
| --- | --- |
| `cargo test` (no DB) | PASS. 137 + 1 + 3. |
| `cargo test --features database-tests` | PASS. 171 on local PostgreSQL 16.15, port 55513, empty role `postgres`. Docker's data directory returned I/O errors, so the documented Docker Postgres was not usable. |
| `cargo clippy --all-targets --features database-tests` | PASS with warnings. Exit 0. 15 warnings, 0 errors. All 15 are in files this session did not change (`reasoning.rs` 7, `organizations/database_tests.rs` 5, `gateway.rs` 2). Warnings this session introduced (`pump_stream`, `ResolvedAgent.project_id`, `StoredWalrus.last_error`, a test type alias) were removed. |
| `cargo fmt --check` | FAIL on the tree. Diffs are only in `auth.rs`, `openapi.rs`, `reasoning.rs`, `tests/reasoning_tests.rs`, which match HEAD. This session did not reformat them. |
| `cargo build --release --bin hub-william-backend` | PASS. Exit 0. |
| `pnpm lint` | PASS. Exit 0. oxlint printed 13 `react(only-export-components)` warnings. `eslint . --max-warnings 0` then passed, so those 13 are not eslint errors. |
| `pnpm typecheck` | PASS. Exit 0. |
| `pnpm exec vitest run` | PASS. 35 files, 261 tests. |
| `pnpm build` | PASS. Exit 0, including the dialog scroll fix. |

### 2. Browser regression

**2a. Mocked external services.** PARTIAL. An earlier browser pass (same day, isolated ports, mock model, fake Memory SDK) covered routing, registration, project create, chat, suggestion rendering, and save-job state. It inserted a verified Memory row directly and did not use the connect endpoint. That pass is not evidence for ZRoute, Claude, or Walrus. This session replaced that shortcut with `POST /memory/walrus` tests against `tests/fixtures/fake-memwal.mjs` (verify succeeds or returns `account_not_found`; the delegate key is not echoed; a rejected account is never `verified`). The full mocked browser script was not repeated after the dialog changes.

**2b. Live gateway, Memory off.** PARTIAL. Throwaway user `liveqa_user` on a new database `memwal_live` (30 migrations). Real `https://api-dev.zroute.ai/openai`:

- Model list returned 13 ids, including `claude-sonnet-5-5` and `grok-4.5`.
- Test of `claude-sonnet-5-5` saved the connection and returned `needs_attention` / `rate_limited`: "Individual quota reached… Resets in 3h44m39s." Not Ready.
- Test of `grok-4.5` returned Ready. Gateway reported `grok-4.5-build`.
- Reopening the dialog showed connection name `ZRoute dev`, base URL `https://api-dev.zroute.ai/openai`, model `grok-4.5`, password length 0, placeholder "Stored key (hidden)". Test connection again stayed Ready without retyping the key.
- Model control is in the main form. Advanced stayed collapsed.
- Phone viewport 390×700: before the CSS fix, `overflow: hidden` and Test connection sat at y=941, off screen. After `.dialog.settings { overflow-y: auto; max-height: calc(100dvh - 32px) }`, the dialog is 668px tall and the button is in view after scroll.
- Project `LiveQA`, agent `liveqa` revision 1 reloaded from `GET /builder-agents/liveqa` with the saved instructions. Chat reply was `LIVEQA-MARKER` then `pong`. Requested model `grok-4.5`, reported `grok-4.5-build`. Memory event `memory_off`.
- Suggest with `memwal_remember` returned two facts and wrote nothing (`model_reported` `grok-4.5-build`). A tool-less revision returned `capability_disabled` and wrote nothing.

**2c. Live Walrus write / real delegate verify.** BLOCKED. No authorization to use a Mainnet delegate key or to write blobs. The UI showed Memory "Not connected". Do not insert a verified row to pass this.

### 3. Read-only Mainnet

PASS for the public lookup. 2026-10-09T05:27:45Z. Account `0x8cdb1897…abe15` is an active, non-quarantined `MemWalAccount`. Intended delegate `d7ad56db…8aff` is present, label "Walrus session 8". 556 owned blob objects, 556 metadata reads, 0 failures, 8 attributed to that agent. Scripts: `~/memwal-qa/impl-20261009/chain_probe_gql.mjs`, `chain_blobs_gql.mjs`. Outputs: `~/memwal-qa/final-20261009/mainnet-account.json`, `mainnet-blobs.json`. No keys, no writes.

### 4. Reproducibility and delivery files

PARTIAL. This dirty tree installed, migrated (30 rows in `_sqlx_migrations`), and served. A second clean clone was not built. Docker could not start Postgres (`meta.db` / blob I/O error).

Untracked files required for the current behavior, absent from public `16d50ac`:

- `apps/api/migrations/20261009000027_agent_revisions.sql`
- `apps/api/migrations/20261009000028_agent_revision_tools.sql`
- `apps/api/src/agents.rs`
- `apps/api/src/qa_database_tests.rs`
- `apps/api/tests/fixtures/`
- `apps/frontend/src/features/agent-builder/services/builder-agents.ts`
- `apps/frontend/src/features/agent-builder/domain/capabilities.ts`
- plus the untracked tests next to those features

Modified tracked files (chat, discovery, model dialog, conversations, memory) are also uncommitted. Do not claim the public branch reproduces this tree.

Next: someone with push access commits and pushes. Not done here.

### 5. Submission materials

PARTIAL drafts only. `submission-answers.md` updated for today's model result and blob count. Article, X, community post, and feedback form are still unpublished drafts. No real users recorded. Not submitted.

## Still needs a person

1. ZRoute quota reset, or another key, before Claude can be tested inside MemWal. OMP Claude already works; see the OMP evidence file.
2. Explicit yes to connect a specific Mainnet delegate and, separately, to write synthetic facts if the 10-blob bar is required.
3. Authorization to commit/push and to deploy. Neither was done.
