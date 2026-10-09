# Community post draft (Indie Hackers, not posted)

Link once posted: `<community post link>`

**Title:** I got tired of re-explaining my product to AI chats, so I built one that remembers decisions

Every new chat about "what should I build next?" started with me re-typing who the product is for, how big the team is and what the next release is about. So I built a small product-discovery chat that keeps those facts in a memory outside the conversation.

How it works:

- When you ask something, it searches your saved facts with that question and passes only the relevant ones to the model.
- After each answer it suggests a few facts worth remembering. Nothing is saved unless you tick it.
- Start a new chat, reload, or switch models: it still knows your audience, team size and priorities.
- When something changes ("we're four engineers now"), the newer fact wins and it tells you what changed.

Under the hood the memory is Walrus Memory (on Sui), and the model goes through an OpenAI-compatible gateway, so you can pick Gemini, Grok or Claude.

It is early: no real users yet, and it runs locally for now. I'm looking for three to five solo builders or tiny teams willing to try two short sessions a day apart and tell me what it got wrong. Reply or DM if you'd like to try it once it's deployed.

Setup and code: `<repository link>`
