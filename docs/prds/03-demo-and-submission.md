# PRD 03 — Reproducible demo and submission evidence

Status: proposed. Date: 8 October 2026.
Source: the event rules provided by the user. Completion must be established by actual evidence.

## Submission positioning

Working title: **MemWal — Product Discovery That Remembers**.

Proposed description, to use only after implementation is verified:

> MemWal is a Product Discovery chatbot for founders and small product teams. It uses Walrus Memory on Mainnet to store approved product facts, constraints, and decisions, then recalls relevant context in later conversations. Users can keep separate chat histories while continuing their project work without repeating the same background.

Keep the live demo focused on one credible use case. Additional templates should not imply completed capabilities.

## Eligibility evidence matrix

| Requirement | Required evidence | Current assertion |
| --- | --- | --- |
| Working chatbot | Public URL and successful judge-access walkthrough | Not verified by this document |
| Walrus Mainnet memory | Real write/recall receipts and network confirmation | Not verified |
| At least 10 blobs | Agent-attributable blob records and count at submission time | Not verified |
| Agent and account identity | Public key and account object ID verified against active configuration | Do not derive from pasted private material without validation |
| Public source | Repository URL and reproducible clean setup | Not verified |
| LLM disclosure | Actual model ID/version, provider and runtime/proxy | Record from runtime evidence |
| Article | Published Medium or Inkray URL | Requires actual publication |
| Real use | Consented, redacted real-user sessions and outcomes | Synthetic demo alone is insufficient evidence |
| Feedback | Genuine friction point, improvement idea and issue links if created | Do not invent issue URLs |
| Other form obligations | DeepSurge, required form, Discord, dedicated wallet and X article share | User completes or explicitly authorizes each external action |

The pasted deadline is **9 October 2026, 14:00 UTC**, equivalent to **22:00 Singapore / 21:00 Vietnam**. Confirm changes with the organizer if necessary; this document has not rechecked the live event page.

## Five-minute recording script

### 0:00–0:25 — Introduce the problem

Human narration:
“When I open a new chat, I usually have to repeat my product, team constraints and earlier decisions. MemWal keeps approved project context in Walrus Memory and recalls it when it helps.”

Show the actual deployment and project name. Hide credential settings, keys, private notifications and unrelated user data.

### 0:25–1:20 — Create chat A and save context

Create LaunchLens project and chat “Product baseline.” Show its conversation ID in Details.

Paste:
“We are building LaunchLens for solo SaaS founders. We have two engineers and a six-week release window. Our priority is improving onboarding. Team workspaces are deferred. Suggest the durable facts we should remember.”

Review the actual suggestions and save selected facts. Show confirmed storage and real blob references. Do not cut pending writes to make them appear instantaneous.

Narration:
“These are approved project facts. The storage indicator confirms the remote write; it is separate from saving my chat history.”

### 1:20–2:15 — New chat B, actual recall

Create “Release prioritization.” Show the new ID and empty transcript.

Paste:
“Should we prioritize team workspaces in our next release? Explain using the constraints you remember.”

Expected evidence: relevant recalled facts and an answer shaped by those constraints. Do not demand scripted wording. If recall fails, show the failure and fix it before claiming success.

Open the context disclosure. Briefly show developer evidence that A's transcript was not included in B's model request.

### 2:15–2:50 — Before/after comparison

Start a separate fresh chat with Memory off and ask the same question. Show that it lacks the stored project constraints and should ask for context or qualify its advice.

Narration:
“Both are new conversations. The difference is relevant context retrieved through Walrus, not the browser replaying the previous messages.”

### 2:50–3:35 — Correction and model portability

With Memory enabled, save:
“Our team has grown to four engineers. The six-week release window is unchanged.”

Wait for the correction to be stored and available to recall. Create another conversation and select the other configured model.

Paste:
“How many engineers do we have now, and what is our release window?”

Verify four engineers and six weeks, with provenance. Show actual model ID. Gemini or Grok should be the documented primary model if entering the alternative-model category.

### 3:35–4:10 — History and isolation

Reload and reopen an earlier chat to show history persistence. Switch to an unrelated project and ask about its team. It should not import LaunchLens facts.

Explain that model switching preserves project memory, while project switching changes memory scope.

### 4:10–5:00 — Mainnet and reproducibility

Show real Mainnet evidence: public agent ID, account object and attributable blob count. Show public repository setup instructions and published article if available. Do not equate ten messages with ten blobs.

End with the benefit demonstrated: less repeated setup, current constraints available across conversations, and visible evidence of what context was retrieved.

## Optional ten-fact synthetic fixture

Use only if consistent with the demo project. Facts do not guarantee separate blob writes; confirm actual receipts.

1. Product: LaunchLens.
2. Audience: solo SaaS founders.
3. Initial team: two engineers.
4. Release window: six weeks.
5. Current priority: onboarding.
6. Team workspaces are deferred.
7. Next experiment: a concierge onboarding test.
8. Interview notes must distinguish observations from hypotheses.
9. Feature comparisons should include evidence, effort and a next step.
10. Pricing changes require user research before commitment.

Do not upload duplicate filler solely to inflate the count. If the integration batches facts into fewer blobs, collect additional meaningful, consented memories and verify the true blob total.

## Article outline

1. The repeated-context problem and intended users.
2. What MemWal owns (identity, projects, conversations, model connections) and what Walrus Memory stores.
3. Conversation history versus durable Walrus memory.
4. Authentication, delegate setup and secure server-side integration, without secrets.
5. Recall → model response → reviewed write → confirmed storage.
6. The same fresh-chat question with memory off and on.
7. Corrections, project isolation and switching models.
8. Actual user feedback and integration friction, with evidence.
9. Clone/run instructions and known limitations.

Do not call a self-test real-user adoption. Do not claim end-to-end encryption against the managed relayer if it processes plaintext.

## Form preparation

Prepare a private checklist with placeholders for personal contact fields, country, handles, reward wallet, agent public key, account ID, blob count, public URL, repository, article and post links. Populate only verified facts. Agent public key, account object ID, conversation ID and wallet address must not be conflated.

Keep the public demo account separate from administrative configuration. Judges need a supported access path without receiving a delegate key. Avoid public shared credentials that reveal other participants' chats or project memory.

## Release priority

P0: working deployed chat; correct scope; true cross-chat recall; confirmed Mainnet writes; reproducible source; required evidence and article.

P1: polished history navigation, correction demonstration, model-switch demonstration and clear context disclosure.

P2: local-agent adapter, Console files, multi-agent workflows and extra templates. These should not displace the P0 submission path.

Publication and form submission are separate external actions. Drafts and evidence may be prepared now; sending/posting requires the user's explicit instruction.
