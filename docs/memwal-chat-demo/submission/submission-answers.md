# DeepSurge submission answers (draft, not submitted)

Walrus Session 8, "Chatbots That Remember". Submission closes 9 October 2026, 14:00 UTC (22:00 SGT).
Nothing below has been submitted. Items marked **BLOCKED** must be resolved first; items in angle brackets need Harry's input.

| Field | Draft answer | Status |
| --- | --- | --- |
| Project name | MemWal Product Discovery | Ready |
| One-line description | Helps solo builders and small product teams evaluate opportunities using remembered strategy, constraints, research findings and past decisions. | Ready |
| GitHub repository | https://github.com/harrymove-ctrl/memwal-hub/tree/harrymove-ctrl/branch commit `68498894234c99d84a757ed7e7b5c16737a1267f` (public, HTTP 200 without a token). `main` was not updated. | Ready on this branch |
| Setup instructions | `docs/memwal-chat-demo/README.md` | Ready in the branch. A clean clone was not rebuilt after the push. |
| Live demo URL | https://builder-production-8b35.up.railway.app | Ready. Landing title MemWal. Get started opens `/builder/integrations?connect=model`. Health, model-proxy, discovery chat, and memory stats routes exist. |
| LLM used | Public production test 2026-10-09: ZRoute base `https://api-dev.zroute.ai/openai`, requested and reported model `gemini-3.8-flash`, connection Ready. | Ready for that model |
| "Beyond the Big Two" | The verified public model call is Gemini via ZRoute, not OpenAI or Anthropic. Not an award claim. | Partial |
| Walrus Memory network | Mainnet. Relayer `https://relayer.memory.walrus.xyz`. Package `0xe7c16fbea0560e7057e2bf7422feaa4fb313749fc69c9e9092fac7a33b81d7f5`. | Ready |
| Agent ID | `d7ad56dbb589a331a7cc2a3ce64320256490531cb09cdd5e4470cf8d09a58aff`. Production `GET /api/memory/stats` returned this key. Delegate label on chain: Walrus session 8. | Ready |
| Memory account ID | `0x8cdb1897153b715dac04b69bd4cb5091d9e385e2b63349a76c20c122ce3abe15` | Ready |
| Blob count | Fresh read-only GraphQL 2026-10-09T06:04:31Z: 558 owned blob objects, 558 metadata reads, 0 failures, **10** attributed to `d7ad56db…8aff` (9 in `project/4116c45e-2828-4fcb-9d10-a9a1083cd2ad`, 1 in `project/f76d6697-fac5-478b-82cc-118f27eb19ba`). Production stats returned the same agent and 10. No new writes in this pass. | Ready for a 10-blob bar |
| Dedicated wallet | The account's owner wallet also holds 477 MemWal blobs written by other agents of the same account. | **Check the rule**: this wallet is not dedicated to this project. |
| Article | `<medium link>` (draft: `medium-article.md`) | Not published |
| X post | `<x post link>` (draft: `x-announcement.md`) | Not published |
| Community post | `<community post link>` (draft: `community-post.md`) | Not published |
| Feedback form | `<feedback form confirmation>` (input: `upstream-feedback.md`) | Not submitted |
| Real users | None so far. Pilot plan: `docs/memwal-chat-demo/pilot-guide.md`. | Not started |
| Team / contact | `<name>`, `<email>`, `<wallet address for prizes>` | Missing |

## Short description for the form

MemWal Product Discovery is a chat for solo builders and small product teams. Each message recalls the team's own strategy, constraints, research findings and decisions from Walrus Memory on Sui Mainnet, passes only the relevant facts to the model as reference data, and streams an answer from a model of the user's choice through an OpenAI-compatible gateway (default `gemini-3.8-flash`). After each reply it suggests durable facts; nothing is saved until the user reviews and selects them, and a fact is shown as saved only when Walrus confirms the blob. New conversations start empty and still remember, because the memory lives on Walrus, not in the transcript or the browser.
