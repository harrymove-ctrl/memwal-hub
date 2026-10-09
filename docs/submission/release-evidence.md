# Release evidence

Verified before the builder/example repair in this commit. Re-check the public site after that commit is deployed.

- Repository: https://github.com/harrymove-ctrl/memwal-hub/tree/harrymove-ctrl/branch
- Public app: https://builder-production-8b35.up.railway.app
- Deployed application commit at the last Railway upload: `68498894234c99d84a757ed7e7b5c16737a1267f`
- API deployment `5cc681eb-95fe-4315-b19a-b90022951a05` (SUCCESS, 2026-10-09T06:09:40Z)
- Builder deployment `41f4d6f5-5fb0-40ac-b1b6-8f9232112087` (SUCCESS, 2026-10-09T06:09:51Z)
- Later git commits `bfb48f7` and `98a77a1` were pushed and not redeployed before the builder/example repair.
- `/api/health` returned `{"status":"ok","service":"hub-william-backend"}`.
- Signed-out `/api/model-proxy` and `/api/memory/stats` returned 401. `POST /api/discovery/chat` with `{}` returned 422 missing `messages`.
- A production account signed in through the UI. Get started opened `/builder/integrations?connect=model`.
- ZRoute test on that account was Ready. Requested and reported model: `gemini-3.8-flash`. The key field stayed empty.
- Memory verify returned agent `d7ad56dbb589a331a7cc2a3ce64320256490531cb09cdd5e4470cf8d09a58aff`, Mainnet, 10 blobs.
- Those blobs are in `project/4116c45e-2828-4fcb-9d10-a9a1083cd2ad` (9) and `project/f76d6697-fac5-478b-82cc-118f27eb19ba` (1). The new production account does not own those projects, so it cannot recall them.
- No new Walrus write was made. The extra-save allowance is exhausted.
- Rollback: API `f3f754cb-145c-4916-822a-c1f4f4371894`, builder `adefebfc-1963-48ac-bcb0-ecf67694fcb7`.
