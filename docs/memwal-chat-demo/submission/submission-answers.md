# DeepSurge submission answers (draft, not submitted)

Walrus Session 8, "Chatbots That Remember". Submission closes 9 October 2026, 14:00 UTC (22:00 SGT).
Nothing below has been submitted. Items marked **BLOCKED** must be resolved first; items in angle brackets need Harry's input.

| Field | Draft answer | Status |
| --- | --- | --- |
| Project name | MemWal Product Discovery | Ready |
| One-line description | Helps solo builders and small product teams evaluate opportunities using remembered strategy, constraints, research findings and past decisions. | Ready |
| GitHub repository | https://github.com/harrymove-ctrl/memwal-hub (public) | **BLOCKED**: the chat code and `docs/memwal-chat-demo/` are not committed or pushed yet; the default branch `main` does not contain them. |
| Setup instructions | `docs/memwal-chat-demo/README.md` | Local startup from this dirty tree worked (2026-10-09). A clean clone was not built. Public `16d50ac` does not contain the uncommitted chat work. |
| Live demo URL | `<deployed chat URL>` | **BLOCKED**: the Railway build has no chat. Works locally only. |
| LLM used | This session (2026-10-09): through the app, `grok-4.5` tested Ready and the gateway reported `grok-4.5-build` on the chat reply and on fact extraction. `claude-sonnet-5-5` is in the live model list, but Test connection returned `rate_limited` ("Individual quota reached"), so Claude was not verified inside MemWal today. OMP-to-ZRoute Claude is a separate check; see `verification-status.md`. Earlier notes that named `gemini-3.8-flash` as the default are from the 8 October demo, not re-run today. | Partial |
| "Beyond the Big Two" | Not claimed from today's run. Today's successful MemWal call was Grok. Gemini was listed by the gateway and not called. Confirm the current rule wording before using this. | Not verified today |
| Walrus Memory network | Mainnet (relayer `https://relayer.memory.walrus.xyz`, package `0xe7c16fbea0560e7057e2bf7422feaa4fb313749fc69c9e9092fac7a33b81d7f5`) | Ready |
| Agent ID | Intended: `d7ad56dbb589a331a7cc2a3ce64320256490531cb09cdd5e4470cf8d09a58aff` (registered on the account on 8 October, label "Walrus session 8") | **BLOCKED**: the app is configured with a different registered delegate key (`e8a8ef123c66165ee26cff24df130459152801c2f3d72ab41cb027ca86f3bef9`). Either enter the `d7ad…` delegate private key in the Memory dialog, or decide to submit `e8a8…` instead. The rules do not define "agent ID"; in the MemWal code it is the delegate public key stamped on blobs as `memwal_agent_id`. Some earlier submissions gave the account object ID instead; check the form's wording. |
| Memory account ID | `<account ID, from Harry>` (verified on Mainnet as an active MemWal account) | Ready, kept out of this file on purpose |
| Blob count | Fresh read-only GraphQL check 2026-10-09T05:27:45Z. Account active, not quarantined, 18 delegates. Intended agent `d7ad56db…8aff` is a delegate, label "Walrus session 8". Owned Walrus Blob objects: 556, metadata read 556, failures 0. Attributed to that agent: **8** (7 in `project/4116c45e-…`, 1 in `project/f76d6697-…`). No writes were made. The earlier "0" in this row is stale. Still under 10. | **BLOCKED** for a 10-blob threshold. Do not add filler blobs without explicit authorization. |
| Dedicated wallet | The account's owner wallet also holds 477 MemWal blobs written by other agents of the same account. | **Check the rule**: this wallet is not dedicated to this project. |
| Article | `<medium link>` (draft: `medium-article.md`) | Not published |
| X post | `<x post link>` (draft: `x-announcement.md`) | Not published |
| Community post | `<community post link>` (draft: `community-post.md`) | Not published |
| Feedback form | `<feedback form confirmation>` (input: `upstream-feedback.md`) | Not submitted |
| Real users | None so far. Pilot plan: `docs/memwal-chat-demo/pilot-guide.md`. | Not started |
| Team / contact | `<name>`, `<email>`, `<wallet address for prizes>` | Missing |

## Short description for the form

MemWal Product Discovery is a chat for solo builders and small product teams. Each message recalls the team's own strategy, constraints, research findings and decisions from Walrus Memory on Sui Mainnet, passes only the relevant facts to the model as reference data, and streams an answer from a model of the user's choice through an OpenAI-compatible gateway (default `gemini-3.8-flash`). After each reply it suggests durable facts; nothing is saved until the user reviews and selects them, and a fact is shown as saved only when Walrus confirms the blob. New conversations start empty and still remember, because the memory lives on Walrus, not in the transcript or the browser.
