# Feedback and issue drafts (nothing published)

None of these has been filed, posted or sent anywhere.

## Upstream: Walrus Memory

Only behaviour we reproduced ourselves is listed.

### 1. No way to update or supersede a stored fact (feature request)

- **Reproduced:** saved "The team has two engineers." and later "The engineering team has four engineers." in the same namespace (Mainnet, SDK 0.1.8). Both are returned by `recall` for "How many engineers do we have?", with no link between them.
- **Impact:** every app has to resolve conflicts itself (we pass saved times and tell the model newer facts win).
- **Ask:** an optional `supersedes: <blob ID>` on remember, or a way to mark a fact as replaced so recall can hide it or return the relationship.

### 2. Counting writes per agent is expensive (feature request)

- **Reproduced:** to count blobs for one delegate key we listed every Walrus Blob object owned by the account owner (548) and read each blob's `metadata` dynamic field to compare `memwal_agent_id`: 548 extra RPC reads, about 35 seconds.
- `listNamespaces().memory_count` is per namespace across all delegate keys of the account, so it cannot answer "how many blobs did this agent write?".
- **Ask:** a relayer or SDK call that returns counts (and blob IDs) per `memwal_agent_id`, or a filter on `listNamespaces`.

### 3. "Agent ID" wording (documentation)

- The Session 8 rules ask for an "agent ID" without defining it. In the MemWal code the blob metadata key `memwal_agent_id` holds the delegate public key; some public submissions gave the account object ID instead.
- **Ask:** define "agent ID" in the rules and the SDK documentation, and show how to read it (for example `getPublicKeyHex()`).

## Upstream: ZRoute (gateway, not Walrus)

### 4. Event stream returned for non-streaming requests

- **Reproduced:** `POST https://api-dev.zroute.ai/openai/chat/completions` with `"stream": false` (and with `stream` omitted) answers `200 text/event-stream`. OpenAI-compatible clients that expect JSON fail.
- **Ask:** honour `"stream": false`, or document the behaviour.

### 5. Reported model differs from the requested ID

- **Observed, not necessarily a bug:** requesting `grok-4.5` reports `grok-4.5-build`; `claude-sonnet-5-5` reports `claude-sonnet-5-5-high`. Worth documenting so apps display the right model.

## Our own app bugs (fixed in this working tree, not upstream)

| Bug | Fix |
| --- | --- |
| Connection test rejected ZRoute's event-stream answer as "not OpenAI-compatible" | Backend folds a complete event stream into a normal response; unit test added. |
| Replies cut off by the 800-token default on a thinking model | Default 2048, maximum 8192, chat notice when `finish_reason` is `length`; test added. |
| A failing per-conversation model switched the saved connection to Unavailable | Only the saved model's failures change the saved status; database test added. |
| The model picker offered guessed IDs (`zroute/…`) that the gateway does not list | The picker offers only IDs the gateway returns; the install-command reader no longer guesses a model. |
| Model replies showed raw Markdown (`**`, `*`) | Small Markdown renderer that builds React elements only (no HTML from the model); tests added. |
| Integrations test broken by a concurrent change to the model field | Test updated to type an unlisted model under Advanced. |
