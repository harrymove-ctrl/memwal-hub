# Demo script (about four minutes)

Before you start: ZRouter and Walrus Memory both show **Ready** on the Integrations page, and auto-save is off.

1. **Integrations.** Three separate cards: ZRouter / OpenAI-compatible proxy (Ready, with the model ID and the model that last answered), Walrus Memory (Ready, Mainnet, namespace) and Walrus Console (Unavailable, no buttons). Manage and Disconnect are separate buttons; the badges are status text and do nothing when clicked.
2. **Try Product Discovery.** The header shows the gateway status, the model selector and the Memory status.
3. **Conversation A.** *"We are building a product for solo developers. Our next release focuses on onboarding, and we have two engineers."*
   - The status line moves through recalling Memory, generating and reviewing suggested facts. Memory reports no relevant facts the first time.
   - Open **Details**: the model requested and the model the gateway reported, the request shape (system → user) and the finish reason.
   - Under **Suggested memories**, keep the three facts and click **Save selected**. Each fact moves from Saving to **Saved** only after Walrus confirms it, and shows its blob ID.
4. **New chat.** *"Should we prioritize shared team workspaces next?"* Expand the memories provided as context: the three facts from Conversation A. Details shows one conversation message sent: the old transcript was not replayed.
5. **Reload the page**, then ask *"What do you already know about our product, team and release focus?"* The facts come back from Walrus Memory, not from the browser.
6. **Switch model.** Start a new chat, pick another model in the header (for example `grok-4.5` or `claude-sonnet-5-5`) and ask *"How many engineers do we have, and what is the next release focused on?"* The same Memory is recalled. Details shows the exact ID the gateway reported (in the recorded run `grok-4.5-build` and `claude-sonnet-5-5-high`).
7. **Revised context.** *"We now have four engineers, and team collaboration is becoming a priority."* Save the new facts. Walrus Memory cannot overwrite or delete the old fact; both are stored. On the next recall both come back with their saved times and the model is told that newer facts win, so it answers "four engineers" and points out the change.
8. **No false recall.** *"What is a good recipe for banana bread?"* Memory reports no relevant memory; nothing about the product is injected.
9. **Failure handling.** Press **Stop** or Esc while a reply streams: the partial text stays, the reply is marked Stopped and saved facts stay saved. With Memory unavailable the chat says so and offers **Continue without Memory**; it never pretends to remember.

Synthetic data: every product fact in this script is invented for the demo. Nothing here is customer evidence.
