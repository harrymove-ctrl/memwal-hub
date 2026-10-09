# A product chat that remembers your strategy: building MemWal Product Discovery on Walrus Memory

*Draft for Medium, not published. Link once published: `<medium link>`. Author: `<name>`.*

## The repeated-context problem

Every time a solo builder opens a new chat to think through a product decision, the first five minutes go to re-explaining the same things: who the product is for, how many people are building it, what the next release is about, what was already tried and rejected. Long conversations help until they don't: the transcript gets too long, you start a new one, and the assistant forgets everything.

MemWal Product Discovery is a small experiment in fixing that with memory that lives outside the transcript. It helps solo builders and small product teams evaluate opportunities using remembered strategy, constraints, research findings and past decisions. The memory is stored on Walrus Memory on Sui Mainnet, so a brand-new conversation, a reload or a different model still starts from what the team has already decided.

## Who it serves

People deciding what to build next with few hands: indie hackers, solo founders, and teams of two to five who keep their strategy in their heads and in scattered notes.

## A conversation without memory

Ask a fresh assistant "Should we prioritize shared team workspaces next?" and you get a generic list of pros and cons, because it does not know that your product is for solo developers, that the next release is about onboarding, or how many engineers you have. In our app, the first time a user says this with Memory switched on but empty, the chat honestly reports that it found no relevant facts.

## How it works: chat → recall → model → reviewed save

1. **Recall with the real question.** Each message is used as the search query against the user's Walrus Memory namespace. There is no fixed "profile" query.
2. **Filter.** Weak matches, secret-looking text and duplicates are dropped; the rest are sorted newest first and capped at six. This is the actual filter from the Rust backend:

```rust
pub fn filter_recalled(raw: Vec<RecalledFact>, max_distance: f64) -> (Vec<RecalledFact>, usize) {
    let total = raw.len();
    let mut kept: Vec<RecalledFact> = Vec::new();
    for fact in raw {
        let text = fact.text.trim();
        if text.is_empty() || looks_secret(text) {
            continue;
        }
        if fact
            .distance
            .is_some_and(|distance| distance >= max_distance)
        {
            continue;
        }
        let normalized = text.to_lowercase();
        if kept
            .iter()
            .any(|existing| existing.text.trim().to_lowercase() == normalized)
        {
            continue;
        }
        kept.push(RecalledFact {
            text: text.chars().take(MAX_FACT_CHARS).collect(),
            ..fact
        });
    }
    kept.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    kept.truncate(MAX_FACTS_IN_CONTEXT);
    let dropped = total - kept.len();
    (kept, dropped)
}
```

3. **Inject as reference data, not instructions.** The recalled facts go into a separate system message, each with the time it was saved, wrapped in a tag the model is told to treat as untrusted data. Then comes the current conversation only; a new chat sends just the new message.

```rust
pub fn build_model_messages(conversation: &[ChatMessage], facts: &[RecalledFact]) -> Vec<Value> {
    let mut messages = vec![json!({ "role": "system", "content": SYSTEM_PROMPT })];
    if !facts.is_empty() {
        let lines: Vec<String> = facts
            .iter()
            .enumerate()
            .map(|(index, fact)| {
                let saved = fact.created_at.as_deref().unwrap_or("unknown time");
                format!(
                    "{}. [saved {}] {}",
                    index + 1,
                    saved,
                    escape_context(&fact.text)
                )
            })
            .collect();
        messages.push(json!({
            "role": "system",
            "content": format!("{MEMORY_PREAMBLE}\n<memory_context>\n{}\n</memory_context>", lines.join("\n")),
        }));
    }
    for message in conversation {
        messages.push(json!({ "role": message.role, "content": message.content }));
    }
    messages
}
```

4. **Stream the answer** from the model the user picked, through an OpenAI-compatible gateway (ZRoute).
5. **Suggest, review, save.** After each reply the model proposes up to three durable facts. Nothing is written until the user selects them and clicks Save selected. The backend talks to Walrus Memory through the official TypeScript SDK in a small helper process; saving is one `rememberAsync` call per fact:

```js
case "remember_submit": {
  const accepted = await client().rememberAsync(input.text, input.namespace, { idempotencyKey: input.idempotencyKey });
  return reply({ ok: true, jobId: accepted.job_id, status: accepted.status });
}
```

The chat polls the job and shows a fact as Saved only when the relayer reports it done with a Walrus blob ID.

## Mainnet persistence and fresh-session recall

In the recorded demo (synthetic data) a user said: "We are building a product for solo developers. Our next release focuses on onboarding, and we have two engineers." The three suggested facts were saved to Walrus Mainnet, for example as blob `Lp70bwBtkda3dotU5_3cIJ-zcm5CNQIVvT2LZobq9RU` ("The team has two engineers.").

In a new chat, "Should we prioritize shared team workspaces next?" recalled those three facts and the answer began "No, you should not prioritize shared team workspaces right now", citing the solo-developer audience and the onboarding release. After a page reload the transcript was gone, but asking "What do you already know about our product, team and release focus?" listed all three facts again, recalled from Walrus, not from the browser.

When the user later said "We now have four engineers, and team collaboration is becoming a priority", both new facts were saved next to the old ones. The next fresh conversation answered: "You currently have four engineers. Note the change: memory previously recorded two engineers, but the most recent update confirms your team has four."

## Model and runtime

- Default model: `gemini-3.8-flash`, through ZRoute's OpenAI-compatible endpoint. Every reply reported `gemini-3.8-flash`.
- Switching models per conversation keeps the same memory. With the same five facts, `grok-4.5` (reported by the gateway as `grok-4.5-build`) and `claude-sonnet-5-5` (reported as `claude-sonnet-5-5-high`) both answered "four engineers, onboarding".
- Backend: Rust (Axum 0.8, SQLx, Postgres 16). Walrus Memory SDK `@mysten-incubation/memwal` 0.1.8 in a Node.js helper. Frontend: React 19 and React Router 8.

## Integration friction we hit

- **The gateway always streams.** ZRoute answers every Chat Completions request with Server-Sent Events, even with `"stream": false`. Our connection test first rejected that as "not an OpenAI-compatible endpoint". The backend now reads an event stream to the end and folds it into a normal response:

```rust
if content_type.contains("event-stream") {
    return collect_stream_completion(&text, key);
}
```

- **Thinking models spend your output budget.** With an 800-token limit, `gemini-3.8-flash` produced replies of about 26 to 32 visible tokens and stopped with `finish_reason: length`, because reasoning used the rest. We raised the limit to 4096 and the chat now says when a reply hits the limit.
- **Memory has no overwrite.** Walrus Memory stores facts; it does not update or delete them. "Two engineers" stays stored after "four engineers" is saved. We handle that at read time: every fact carries its saved time, and the model is told that newer facts win and to point out the change.
- **Agent identity takes care.** The "agent ID" stamped on each blob is the delegate key's public key. An account can have many delegate keys, so counting writes "for the agent" means filtering the account owner's blobs by that key, not counting the whole wallet.

## Pilot results

None yet. No real users have tried it; everything above is scripted demo data. A pilot plan is in the repository (`docs/memwal-chat-demo/pilot-guide.md`).

## Limitations and setup

- Facts are permanent and public on Walrus Mainnet; the review step exists so users decide what is stored. The app refuses to save secret-looking text.
- Superseded facts are handled by recency in the prompt, not removed.
- The chat is not deployed yet; it runs locally. Setup instructions, an environment template and the test commands are in `docs/memwal-chat-demo/README.md` in `<repository link once pushed>`.

*Built for Walrus Session 8, "Chatbots That Remember".*
