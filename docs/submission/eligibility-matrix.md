# Eligibility matrix

| Requirement | Status | Evidence |
| --- | --- | --- |
| Public app | Met for the last Railway deploy of `6849889` | https://builder-production-8b35.up.railway.app |
| Public source | Met on branch `harrymove-ctrl/branch`. `main` was not updated. | GitHub commit URL returned HTTP 200 |
| Mainnet agent | Met | `d7ad56dbb589a331a7cc2a3ce64320256490531cb09cdd5e4470cf8d09a58aff`, label Walrus session 8 |
| Account | Met | `0x8cdb1897153b715dac04b69bd4cb5091d9e385e2b63349a76c20c122ce3abe15` |
| 10 attributable blobs | Met at 2026-10-09T06:04:31Z | 558 objects, 558 reads, 0 failures, 10 for this agent |
| Memory is Walrus; chat history is Postgres | Met in code | `/discovery/memories` writes blobs. Conversations are SQL. |
| Live public recall of those blobs by the new production user | Not met | That user does not own the project ids on the blobs. |
| UI save of a new fact in this pass | Not done | Write allowance exhausted. |
| Article, posts, real users, forms | Not done | No authorization to publish or submit. |
