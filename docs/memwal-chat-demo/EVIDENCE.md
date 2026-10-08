# Evidence: MemWal Product Discovery (8 October 2026)

Screenshots 20 to 45 were taken before a later interface change (made in the same working tree on 8 October around 20:15 SGT) renamed "Memory used" to "N saved memories provided as context" and removed blob IDs from that list. Blob IDs are still shown on saved suggestions and in the JSON files.

Everything below came from the local app (frontend http://127.0.0.1:5188, API http://127.0.0.1:8080) talking to the real services. Nothing here is mocked unless it says so. No API key, delegate key, account ID or owner wallet address appears in this folder.

## Services used

| Part | Value |
| --- | --- |
| Model proxy | ZRouter, OpenAI-compatible Chat Completions at `https://api-dev.zroute.ai/openai` |
| Model requested | `gemini-3.8-flash` |
| Model reported by every response | `gemini-3.8-flash` (from the `model` field of the streamed chunks) |
| Memory | Walrus Memory relayer `https://relayer.memory.walrus.xyz`, network `mainnet` |
| MemWal package on Sui Mainnet | `0xe7c16fbea0560e7057e2bf7422feaa4fb313749fc69c9e9092fac7a33b81d7f5` |
| Memory namespace | `bew-harness/product-discovery` |

## Connection checks

- ZRouter showed **Ready** only after Test connection sent one request and got a real chat completion back (`10-zrouter-dialog-after-test.png`). An earlier attempt was correctly kept at **Needs attention**, because the proxy answered with an event stream that the first version of the check did not accept; the backend now reads such a stream. The key field is empty after saving, and the dialog shows "key stored (hidden)".
- Walrus Memory showed **Ready** only after the backend confirmed the relayer reports `mainnet`, the account object exists on Sui Mainnet with the MemWal account type, and a signed relayer request succeeded (`11-integrations-both-ready.png`).

## Journey (`live-journey.json`, screenshots 20 to 26)

1. **Conversation A.** "We are building a product for solo developers. Our next release focuses on onboarding, and we have two engineers."
   - Memory checked, no relevant facts. The reply streamed from `gemini-3.8-flash`.
   - Suggested memories: "The product targets solo developers.", "The next release focuses on onboarding.", "The team has two engineers." All three were saved after review and confirmed by the relayer with these Walrus blob IDs:
     - `-zUHQ8skcmEBe2Jj7udrG00-nynKmeYFuTCCO343EpM`
     - `uEPnqP6L8dRyYmMLenzXWKIrFJM4ULVKzm9gvgvmZcM`
     - `Lp70bwBtkda3dotU5_3cIJ-zcm5CNQIVvT2LZobq9RU`
2. **New chat.** "Should we prioritize shared team workspaces next?"
   - Memory used: the three facts above. The request sent one conversation message (the new question) plus the recalled facts in a separate reference block.
   - Reply began: "No, you should not prioritize shared team workspaces right now. Here is why: 1. Audience mismatch: …"
3. **Reload, then a new conversation.** "What do you already know about our product, team and release focus?"
   - Memory used: the same three facts, fetched again from Walrus Memory (the browser storage did not contain them).
   - Reply: "Based on your Walrus Memory, here is what I know: Product Target: The product targets solo developers … Team: The team consists of two engineers … Release Focus: The next release is focused on onboarding …"
4. **Revised context.** "We now have four engineers, and team collaboration is becoming a priority."
   - Suggested and saved: "The engineering team has four engineers." (`NUuqPr47FDgInoEvpfQdxCGJmxU8yMWLX3Cvi7PLG6s`) and "Team collaboration is becoming a priority." (`eAUBtQP7BKZLXCq8jU5pqtNE5XqcZrXXYjeJPnKoUuM`).
   - Walrus Memory has no overwrite. The older "two engineers" fact stays stored. Recall returns both with their saved times, and the model is instructed that newer facts win.
5. **New chat after the revision.** "How many engineers do we have, and should we prioritize shared team workspaces now?"
   - Memory used: all five facts. Reply began: "You currently have four engineers. While an earlier record showed two engineers, the most recent update confirms the team has grown to four …"

In this first run the maximum output tokens setting was 800. Several replies stopped early (`Finish reason: length`) because the Gemini Flash model spends part of that limit on reasoning. The limit was raised to 4096, and the app now says when a reply hits the limit.

## Recall-only replay (`live-journey-replay.json`, screenshots 30 to 32)

The follow-up questions were asked again in fresh conversations with the 4096 limit. Nothing was saved, so this run added no Walrus writes. All three replies finished normally (`Finish reason: stop`), used all five recalled facts, and preferred four engineers over two. For example, after a reload:

> Team: The engineering team currently has four engineers (Fact 1). Note the change: this updates an earlier record that listed two engineers (Fact 3).

## Agent identity and write count

All of this is read-only chain or relayer data (Sui Mainnet RPC `https://rpc-mainnet.suiscan.xyz`, 8 October 2026, last checked 20:00 SGT).

The Walrus Memory account object (type `0xe7c16fbea0560e7057e2bf7422feaa4fb313749fc69c9e9092fac7a33b81d7f5::account::MemWalAccount`) is active, not quarantined, and has 18 registered delegate public keys. Two of them matter here:

| Delegate public key (the `memwal_agent_id` stamped on each blob) | Label on chain | Registered | Private key available to the app | Blobs on Mainnet with this agent ID |
| --- | --- | --- | --- | --- |
| `d7ad56dbb589a331a7cc2a3ce64320256490531cb09cdd5e4470cf8d09a58aff` (the agent ID intended for the submission) | Walrus session 8 | 8 October 2026, 16:38 SGT | **No.** No local configuration holds it. | **0** |
| `e8a8ef123c66165ee26cff24df130459152801c2f3d72ab41cb027ca86f3bef9` (derived from the delegate key stored in the local app) | New key | 8 October 2026, 12:43 SGT | Yes (encrypted in the local database) | **5**, all in `bew-harness/product-discovery` |

The five facts saved in the journey above were written with the `e8a8…` key, so they do not count for the `d7ad…` agent. Because the submission agent ID and the configured key differ, **no further Memory writes were made** after this was found, and the ten-blob requirement is **not met** for `d7ad…` (see `blob-count.json` for the `e8a8…` scan).

The account owner wallet holds 548 Walrus Blob objects; 477 carry the Mainnet MemWal package metadata, written by other delegate keys of the same account in other namespaces. They are not attributable to either key above.

## Live checks without writes (`live-checks.json`, screenshots 40 to 45)

Run at 20:05 SGT with the signed-in demo user. Auto-save was off and nothing was saved: the agent's on-chain blob count was 5 before and 5 after.

| Check | Result |
| --- | --- |
| A second workspace user sees no gateway or Memory connection and cannot chat with the first user's model | Pass (HTTP 409 `model_not_configured`) |
| A request from another origin | Refused (HTTP 403) |
| Unknown model ID `model-id-that-does-not-exist` | Shown as an error, no reply: "The proxy is unavailable. Proxy said: no eligible provider account". A first run showed this error also switched the saved connection to Unavailable; that bug was fixed (a per-conversation model's failure no longer changes the saved status) and covered by a database test. |
| Irrelevant question ("What is a good recipe for banana bread?") | No facts recalled ("no relevant facts, 5 filtered out"); the reply did not mention the product. |
| Same question with `grok-4.5` | Recalled all five facts; gateway reported model `grok-4.5-build`; answered four engineers and onboarding, noting the change from two. |
| Same question with `claude-sonnet-5-5` | Recalled all five facts; gateway reported model `claude-sonnet-5-5-high`; same answer. |
| Stop (Esc) during a long reply | Reply marked Stopped, partial text kept. |
| Model selector options | Loaded from the gateway's own list. In the recorded run the check read the selector before the list arrived (reported as a failure); selecting `grok-4.5` and `claude-sonnet-5-5` from it then worked. The script now waits for the list. |

The gateway's model list on 8 October 2026: `claude-opus-5-5`, `claude-sonnet-5-5`, `gemini-3.1-pro`, `gemini-3.5-flash`, `gemini-3.5-flash-lite`, `gemini-3.6-flash`, `gemini-3.7-flash`, `gemini-3.8-flash`, `gemini-pro-agent`, `grok-4.5`, `grok-4.6`, `grok-4.7`, `grok-4.7-build-fast`. Only `gemini-3.8-flash`, `grok-4.5` and `claude-sonnet-5-5` were called.

## Browser audit (`ui-audit.json`, screenshots 50 and 51)

35 of 35 checks passed at 1440×900, 1024×768 and 390×844 on the Integrations page, the agent canvas and the chat: no truncated buttons, no overlapping controls a user can hit, no horizontal overflow, status badges are not buttons and clicking them changes nothing, Memory stays connected, Claude shows Waiting (not Connected) after Connect until the provider confirms (the authorization page opens and a callback field is shown), Settings has one Walrus Console section and labels wallet sign-in as workspace sign-in, and no runtime errors were logged.

## Clean-checkout setup test

On 8 October 2026 at 20:11 SGT the public repository was cloned into a temporary folder. The default branch does not contain this work, so the uncommitted changes from the working checkout were applied on top of `harrymove-ctrl/branch` (no ignored files, no `.env` files). Then, following the README: `pnpm install --frozen-lockfile`, `npm ci` for the Memory helper, typecheck, 207 of 207 frontend tests, production build, API build in a fresh target folder, and the API started against a new empty database: migrations created `model_proxy_connections` and `memory_write_jobs` and `/health` answered. A secret-pattern scan of that tree found only the fake test token `zr_live_exampletoken` in `model-proxy.test.ts`. Credentials and external access are needed only for the live scripts: a ZRoute key, a Walrus Memory Mainnet account ID and a registered delegate key.

## Deployed builder (read-only)

https://builder-production-8b35.up.railway.app answers (`/api/health` returns `{"status":"ok","service":"hub-william-backend"}`, `/api/memory/session` answers), but it runs an older build: `/api/model-proxy`, `/api/discovery/chat` and `/api/memory/stats` return 404 and the frontend bundle has no ZRouter card or chat. Chat is **not available** on the deployed site.

## Browser checks without credentials (`ui-check.json`, screenshots 01 to 06)

19 of 19 checks passed in headless Chromium with reduced motion enabled: card badges, a single Console card with no controls, the masked API key field, validation, opening and closing with the keyboard, Settings wording, the chat empty state, and no horizontal overflow at 390 pixels wide.
