# Evidence manifest (sanitized)

All files are in `docs/memwal-chat-demo/evidence/` unless noted. Times are 8 October 2026, Singapore time (SGT, UTC+8). "Mocked" means no real gateway or Memory call; "live" means real ZRoute and Walrus Memory Mainnet.

None of these files contains the ZRoute key, the delegate private key, the Memory account ID or the owner wallet address. Public identifiers that do appear: Walrus blob IDs, the MemWal package ID and delegate public keys.

| File | Kind | When | What it shows |
| --- | --- | --- | --- |
| `ui-check.json`, `01`–`06-*.png` | Live browser, no credentials | 16:36 | New user: card badges, one Console card without controls, masked key field, validation, keyboard, Settings wording, chat empty state, 390-pixel layout. 19 of 19 passed. |
| `10-zrouter-dialog-after-test.png` | Live | 16:40 | ZRouter dialog after a successful Test connection: Ready, key field empty, "key stored (hidden)". |
| `11-integrations-both-ready.png` | Live | 16:40 | ZRouter and Walrus Memory both Ready, Console Unavailable. |
| `live-journey.json`, `20`–`26-*.png` | Live, **wrote 5 facts to Walrus Mainnet** with delegate key `e8a8…` | 16:44–16:48 | Conversation A and save (blob IDs), new-chat recall, reload recall, revised context and save, recall after revision. Output limit 800 tokens: several replies cut off. |
| `live-journey-replay.json`, `30`–`32-*.png` | Live, no writes | 16:51 | Same follow-up questions in fresh conversations with a 4096-token limit: full replies using all five facts, preferring four engineers. |
| `blob-count.json` | Live, read-only chain scan | 16:52 | 5 blobs for agent `e8a8…`; owner wallet totals. |
| `live-checks.json`, `40`–`45-*.png` | Live, no writes (5 → 5 blobs) | 20:05 | Second-user isolation, foreign origin refused, unknown model error, irrelevant question with no recall, `grok-4.5` and `claude-sonnet-5-5` with the same Memory, Stop. 13 of 14 passed (the failure was a timing issue in the check, explained in `EVIDENCE.md`). |
| `ui-audit.json`, `50-*.png`, `51-*.png` | Live browser, no model calls, no writes | 20:09 | Layout at three sizes, badges are not controls, Claude connect waits for provider confirmation, Settings. 35 of 35 passed. |
| `EVIDENCE.md` | Summary | | Narrative of all of the above, agent identity table, clean-checkout test, deployed-site check. |
| Agent identity (in `EVIDENCE.md`) | Live, read-only chain data | 20:00 | Both delegate public keys are registered on the account; the intended submission key `d7ad…` has 0 blobs; the app's key is `e8a8…`. |

Automated test results (commands in `README.md`) are listed in the final report and `EVIDENCE.md`; they are mocked unless they say otherwise.
