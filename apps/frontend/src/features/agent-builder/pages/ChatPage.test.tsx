import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChatPage, conversationFor, factStateFromJob, isImeEnter } from "./ChatPage";
import { ctx, json, memorySessionBody, mockFetch, notConfiguredProxy, readyProxy, renderWithClient, sseBody, type Call } from "../test/helpers";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

type Stream = ReturnType<typeof sseBody>;

const PROJECT = "11111111-1111-4111-8111-111111111111";
const CHAT = "22222222-2222-4222-8222-222222222222";
const STAMP = "2026-10-08T00:00:00Z";
const chatRow = { id: CHAT, project_id: PROJECT, title: "New chat", archived_at: null, created_at: STAMP, updated_at: STAMP };

/** Server-backed history routes (MOCKED): one project, one chat, writes accepted. */
function persistence(call: Call): Response | undefined {
  if (call.url === "/projects" && call.method === "GET") return json([{ id: PROJECT, name: "LaunchLens", created_at: STAMP, updated_at: STAMP }]);
  if (call.url === `/projects/${PROJECT}/conversations` && call.method === "GET") return json({ conversations: [], next_cursor: null });
  if (call.url === `/projects/${PROJECT}/conversations` && call.method === "POST") return json(chatRow);
  if (call.url === `/conversations/${CHAT}` && call.method === "GET") return json({ conversation: chatRow, messages: [], history: "saved" });
  if (call.url === `/conversations/${CHAT}/messages`) return json({ message: {}, history: "saved" });
  if (call.url === `/conversations/${CHAT}/replies`) return json({ history: "saved" });
  return undefined;
}

function backend(options: { onChat: (call: Call, stream: Stream) => void; memoryStatus?: string; extra?: (call: Call) => Response | Promise<Response> | undefined; history?: boolean }) {
  return mockFetch((call) => {
    if (call.url === "/model-proxy") return json(readyProxy);
    if (call.url === "/memory/session") return json(memorySessionBody(options.memoryStatus ?? "verified"));
    if (call.url === "/discovery/chat") {
      const stream = sseBody(call.signal);
      options.onChat(call, stream);
      return stream.response;
    }
    const extra = options.extra?.(call);
    if (extra) return extra;
    if (options.history !== false) {
      const stored = persistence(call);
      if (stored) return stored;
    }
    return json({ code: "not_found", message: "no route" }, 404);
  });
}

/** Renders the chat inside a project, the only place a saved chat can start. */
function renderChat(entry = `/?project=${PROJECT}`) {
  return renderWithClient(<ChatPage ctx={ctx} />, [entry]);
}

async function send(text: string) {
  const box = await screen.findByLabelText("Message");
  await waitFor(() => expect(screen.getByText(/ZRouter: Ready/)).toBeInTheDocument());
  await waitFor(() => expect(screen.getByText(/Walrus Memory: (Ready|Not connected)/)).toBeInTheDocument());
  await waitFor(() => expect(within(screen.getByRole("banner")).getByRole("button", { name: "New chat" })).toBeEnabled());
  fireEvent.change(box, { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
}

const fact = { text: "Our product is for solo developers.", blob_id: "blob-1", created_at: "2026-10-08T01:00:00Z", distance: 0.2 };

describe("conversationFor", () => {
  it("includes only completed turns plus the new message", () => {
    const turns = [
      { id: "1", role: "user" as const, content: "first" },
      { id: "2", role: "assistant" as const, content: "", status: "error" as const },
      { id: "3", role: "user" as const, content: "second" },
      { id: "4", role: "assistant" as const, content: "answer", status: "done" as const },
    ];
    expect(conversationFor(turns, "third")).toEqual([
      { role: "user", content: "second" },
      { role: "assistant", content: "answer" },
      { role: "user", content: "third" },
    ]);
  });
});

describe("factStateFromJob", () => {
  it("is Saved only when storage completed with a blob", () => {
    expect(factStateFromJob({ client_id: "a", state: "pending", job_id: "j", relayer_status: "uploaded", blob_id: null, message: null })).toBe("saving");
    expect(factStateFromJob({ client_id: "a", state: "saved", job_id: "j", relayer_status: "done", blob_id: null, message: null })).toBe("saving");
    expect(factStateFromJob({ client_id: "a", state: "saved", job_id: "j", relayer_status: "done", blob_id: "b", message: null })).toBe("saved");
  });
});

describe("Connect model", () => {
  it("opens the ZRoute form with the canonical ?connect=model link", async () => {
    mockFetch((call) => {
      if (call.url === "/model-proxy") return json(notConfiguredProxy);
      if (call.url === "/memory/session") return json(memorySessionBody("not_connected"));
      if (call.url === "/projects" && call.method === "GET") return json([]);
      return json({ code: "not_found", message: "no route" }, 404);
    });
    renderChat();
    const link = await screen.findByRole("link", { name: "Connect model" });
    expect(link).toHaveAttribute("href", "/builder/integrations?connect=model");
  });

  it("opens Memory setup with ?connect=memory when the model is ready", async () => {
    mockFetch((call) => {
      if (call.url === "/model-proxy") return json(readyProxy);
      if (call.url === "/memory/session") return json(memorySessionBody("not_connected"));
      if (call.url === "/projects" && call.method === "GET") return json([]);
      return json({ code: "not_found", message: "no route" }, 404);
    });
    renderChat();
    const link = await screen.findByRole("link", { name: "Set up project memory" });
    expect(link).toHaveAttribute("href", "/builder/integrations?connect=memory");
  });
});

describe("ChatPage (mocked backend)", () => {
  it("streams a reply, shows provided context, and a fresh chat does not replay the old transcript", async () => {
    const chats: Call[] = [];
    backend({
      onChat: (call, stream) => {
        chats.push(call);
        setTimeout(() => {
          stream.push("memory", { state: "recalling" });
          stream.push("memory", { state: "included", facts: [fact], filtered_out: 1, policy: "Policy.", query_characters: 5 });
          stream.push("request", { model: "example-model", message_roles: ["system", "system", "user"], memory_context_included: true, memory_facts_included: 1, conversation_messages: 1 });
          stream.push("delta", { text: "Focus on " });
          stream.push("delta", { text: "onboarding." });
          stream.push("done", { model_reported: "example-model-2026", finish_reason: "stop", usage: null, characters: 20 });
          stream.close();
        }, 0);
      },
      extra: (call) => (call.url === "/discovery/suggest" ? json({ facts: [], rejected: 0, model_reported: "m" }) : undefined),
    });
    renderChat();
    await send("Should we prioritize shared team workspaces next?");
    expect(await screen.findByText("Focus on onboarding.")).toBeInTheDocument();
    // The turn is saved first, then generation is scoped to that project and conversation.
    expect(chats[0].body).toEqual({
      messages: [{ role: "user", content: "Should we prioritize shared team workspaces next?" }],
      use_memory: true,
      project_id: PROJECT,
      conversation_id: CHAT,
      request_id: expect.any(String),
    });

    fireEvent.click(screen.getByRole("button", { name: /1 saved memory provided as context/ }));
    expect(screen.getByText(fact.text)).toBeInTheDocument();
    expect(screen.queryByText(/Walrus blob blob-1/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Details/ }));
    expect(screen.getByText(/blob-1/)).toBeInTheDocument();
    expect(screen.getByText("example-model-2026")).toBeInTheDocument();
    await screen.findByText(/No durable facts/);

    // The header action; the chat list also holds a chat whose title is "New chat".
    fireEvent.click(within(screen.getByRole("banner")).getByRole("button", { name: "New chat" }));
    await send("A new question");
    await waitFor(() => expect(chats).toHaveLength(2));
    // A new chat sends only its own message; the first chat's transcript is not replayed.
    expect(chats[1].body).toEqual({ messages: [{ role: "user", content: "A new question" }], use_memory: true, project_id: PROJECT, conversation_id: CHAT, request_id: expect.any(String) });
    expect(JSON.stringify(chats[1].body)).not.toContain("Focus on onboarding");
  });

  it("fills a starter draft and does not send it", async () => {
    const chats: Call[] = [];
    backend({ onChat: (call) => chats.push(call) });
    renderWithClient(<ChatPage ctx={ctx} />);
    fireEvent.click(await screen.findByRole("button", { name: "Work on something else" }));
    expect(screen.getByLabelText("Message")).toHaveValue("I want help with something other than product discovery: ");
    expect(chats).toHaveLength(0);
    expect(screen.getByRole("heading", { name: "What should we work on?" })).toBeInTheDocument();
  });

  it("creates a server chat in the selected project instead of only clearing the screen", async () => {
    const created: Call[] = [];
    backend({
      onChat: () => undefined,
      extra: (call) => {
        if (call.url === "/projects" && call.method === "GET") return json([{ id: "11111111-1111-4111-8111-111111111111", name: "LaunchLens", created_at: "2026-10-08T00:00:00Z", updated_at: "2026-10-08T00:00:00Z" }]);
        if (call.url === "/projects/11111111-1111-4111-8111-111111111111/conversations" && call.method === "GET") return json({ conversations: [], next_cursor: null });
        if (call.url === "/projects/11111111-1111-4111-8111-111111111111/conversations" && call.method === "POST") {
          created.push(call);
          return json({ id: "22222222-2222-4222-8222-222222222222", project_id: "11111111-1111-4111-8111-111111111111", title: "New chat", archived_at: null, created_at: "2026-10-08T00:00:00Z", updated_at: "2026-10-08T00:00:00Z" });
        }
        return undefined;
      },
    });
    renderWithClient(<ChatPage ctx={ctx} />);
    const button = await screen.findByRole("button", { name: "New chat" });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    expect(await screen.findByRole("button", { name: "Archive New chat" })).toBeInTheDocument();
    expect(created).toHaveLength(1);
    expect(created[0].body).toMatchObject({ request_id: expect.any(String) });
  });
  it("switches the model for this conversation from the proxy's own list and keeps Memory on", async () => {
    const chats: Call[] = [];
    backend({
      onChat: (call, stream) => {
        chats.push(call);
        setTimeout(() => {
          stream.push("memory", { state: "none", facts: [], filtered_out: 0, policy: "p", query_characters: 3 });
          stream.push("delta", { text: "ok" });
          stream.push("done", { model_reported: "grok-test", finish_reason: "stop", usage: null, characters: 2 });
          stream.close();
        }, 0);
      },
      extra: (call) => {
        if (call.url === "/model-proxy/models") return json({ available: true, models: ["example-model", "grok-test"] });
        if (call.url === "/discovery/suggest") return json({ facts: [], rejected: 0, model_reported: "m" });
        return undefined;
      },
    });
    renderWithClient(<ChatPage ctx={ctx} />);
    const select = await screen.findByLabelText("Model for this conversation");
    await waitFor(() => expect(within(select).getByRole("option", { name: "grok-test" })).toBeInTheDocument());
    expect(within(select).getByRole("option", { name: "example-model (default)" })).toBeInTheDocument();
    fireEvent.change(select, { target: { value: "grok-test" } });
    await send("Which model answers?");
    await waitFor(() => expect(chats).toHaveLength(1));
    expect(chats[0].body).toMatchObject({ messages: [{ role: "user", content: "Which model answers?" }], use_memory: true, model: "grok-test", project_id: PROJECT });
    expect(await screen.findByText("ok", { selector: ".dc-reply p" })).toBeInTheDocument();
  });

  it("flags a reply that hit the output token limit", async () => {
    backend({
      onChat: (_call, stream) => {
        setTimeout(() => {
          stream.push("memory", { state: "none", facts: [], filtered_out: 0, policy: "p", query_characters: 3 });
          stream.push("delta", { text: "Cut off mid" });
          stream.push("done", { model_reported: "example-model", finish_reason: "length", usage: null, characters: 11 });
          stream.close();
        }, 0);
      },
      extra: (call) => (call.url === "/discovery/suggest" ? json({ facts: [], rejected: 0, model_reported: "m" }) : undefined),
    });
    renderChat();
    await send("Long question");
    expect(await screen.findByText(/reached the maximum output token limit/)).toBeInTheDocument();
  });

  it("Stop aborts the request, keeps partial text, and ignores late events", async () => {
    let active: Stream | undefined;
    let signal: AbortSignal | null | undefined;
    backend({ onChat: (call, stream) => { active = stream; signal = call.signal; } });
    renderChat();
    await send("Tell me something long");
    await waitFor(() => expect(active).toBeDefined());
    active!.push("memory", { state: "none", facts: [], filtered_out: 0, policy: "p", query_characters: 3 });
    active!.push("delta", { text: "Partial" });
    await screen.findByText("Partial");
    fireEvent.click(screen.getByRole("button", { name: /Stop/ }));
    expect(signal?.aborted).toBe(true);
    expect(await screen.findByText(/Interrupted\. The partial reply above is kept in this chat/)).toBeInTheDocument();
    expect(screen.getByText("Partial")).toBeInTheDocument();
    active!.push("delta", { text: " late" });
    expect(screen.queryByText(/late/)).not.toBeInTheDocument();
    expect(screen.getByText(/facts already saved to Walrus stay saved/)).toBeInTheDocument();
  });

  it("explains a Memory failure, never shows Memory used, and can continue without Memory", async () => {
    const chats: Call[] = [];
    backend({
      onChat: (call, stream) => {
        chats.push(call);
        setTimeout(() => {
          if ((call.body as { use_memory: boolean }).use_memory) {
            stream.push("memory", { state: "failed", code: "relayer_unavailable", message: "The relayer is down." });
            stream.push("error", { code: "memory_unavailable", message: "Walrus Memory could not be reached." });
          } else {
            stream.push("memory", { state: "off" });
            stream.push("delta", { text: "Answer without memory." });
            stream.push("done", { model_reported: "m", finish_reason: "stop", usage: null, characters: 5 });
          }
          stream.close();
        }, 0);
      },
      extra: (call) => (call.url === "/discovery/suggest" ? json({ facts: [], rejected: 0, model_reported: "m" }) : undefined),
    });
    renderChat();
    await send("What next?");
    expect(await screen.findByText(/Walrus Memory is unavailable, so nothing was recalled/)).toBeInTheDocument();
    expect(screen.getByText(/Memory was not used for this message/)).toBeInTheDocument();
    expect(screen.queryByText(/Memory used/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue without Memory" }));
    expect(await screen.findByText("Answer without memory.")).toBeInTheDocument();
    expect(chats[1].body).toMatchObject({ use_memory: false, messages: [{ role: "user", content: "What next?" }] });
    expect(screen.getByText(/Memory off for this message/)).toBeInTheDocument();
  });

  it("keeps the draft and shows no fake reply when the model is down", async () => {
    backend({
      onChat: (_call, stream) => {
        setTimeout(() => {
          stream.push("memory", { state: "none", facts: [], filtered_out: 0, policy: "p", query_characters: 3 });
          stream.push("error", { code: "proxy_unavailable", message: "upstream 503" });
          stream.close();
        }, 0);
      },
    });
    renderChat();
    await send("Keep this draft");
    expect(await screen.findByText(/ZRouter is unavailable right now/)).toBeInTheDocument();
    expect(screen.getByText(/No reply was generated/)).toBeInTheDocument();
    expect(screen.getByLabelText("Message")).toHaveValue("Keep this draft");
  });

  it("shows Saved only after storage completion is confirmed", async () => {
    let statusCalls = 0;
    backend({
      onChat: (_call, stream) => {
        setTimeout(() => {
          stream.push("memory", { state: "none", facts: [], filtered_out: 0, policy: "p", query_characters: 3 });
          stream.push("delta", { text: "Reply." });
          stream.push("done", { model_reported: "m", finish_reason: "stop", usage: null, characters: 6 });
          stream.close();
        }, 0);
      },
      extra: (call) => {
        if (call.url === "/discovery/suggest") {
          return json({ facts: [{ id: "11111111-1111-4111-8111-111111111111", text: "We have two engineers.", category: "team" }], rejected: 0, model_reported: "m" });
        }
        if (call.url === "/discovery/memories") {
          return json({ jobs: [{ client_id: "11111111-1111-4111-8111-111111111111", state: "pending", job_id: "job-1", relayer_status: "pending", blob_id: null, message: null }] });
        }
        if (call.url === "/discovery/memories/status") {
          statusCalls += 1;
          return json({ jobs: [{ client_id: "11111111-1111-4111-8111-111111111111", state: "saved", job_id: "job-1", relayer_status: "done", blob_id: "blob-9", message: null }] });
        }
        return undefined;
      },
    });
    renderChat();
    await send("We have two engineers.");
    const section = await screen.findByRole("region", { name: "Suggested memories" });
    fireEvent.click(within(section).getByRole("button", { name: "Save selected" }));
    expect(await within(section).findByText("Saving")).toBeInTheDocument();
    expect(within(section).queryByText("Saved")).not.toBeInTheDocument();
    expect(await within(section).findByText("Saved", {}, { timeout: 6000 })).toBeInTheDocument();
    expect(statusCalls).toBeGreaterThan(0);
    expect(within(section).getByText(/stored on Walrus as blob blob-9/)).toBeInTheDocument();
  }, 10_000);

  it("keeps a failed write retryable and never marks it Saved", async () => {
    backend({
      onChat: (_call, stream) => {
        setTimeout(() => {
          stream.push("memory", { state: "none", facts: [], filtered_out: 0, policy: "p", query_characters: 3 });
          stream.push("delta", { text: "Reply." });
          stream.push("done", { model_reported: "m", finish_reason: "stop", usage: null, characters: 6 });
          stream.close();
        }, 0);
      },
      extra: (call) => {
        if (call.url === "/discovery/suggest") return json({ facts: [{ id: "22222222-2222-4222-8222-222222222222", text: "Onboarding is the focus.", category: "priority" }], rejected: 0, model_reported: "m" });
        if (call.url === "/discovery/memories") return json({ jobs: [{ client_id: "22222222-2222-4222-8222-222222222222", state: "failed", job_id: null, relayer_status: "failed", blob_id: null, message: "Relayer rejected the write." }] });
        return undefined;
      },
    });
    renderChat();
    await send("Onboarding is the focus.");
    const section = await screen.findByRole("region", { name: "Suggested memories" });
    fireEvent.click(within(section).getByRole("button", { name: "Save selected" }));
    expect(await within(section).findByText("Failed")).toBeInTheDocument();
    expect(within(section).queryByText("Saved")).not.toBeInTheDocument();
    expect(within(section).getByRole("button", { name: "Retry selected" })).toBeEnabled();
  });
});

const replyStream = (text: string, extraEvents: (stream: Stream) => void = () => undefined) => (_call: Call, stream: Stream) => {
  setTimeout(() => {
    stream.push("memory", { state: "none", facts: [], filtered_out: 0, policy: "p", query_characters: 3 });
    extraEvents(stream);
    stream.push("delta", { text });
    stream.push("done", { model_reported: "m", finish_reason: "stop", usage: null, characters: text.length });
    stream.close();
  }, 0);
};

describe("isImeEnter", () => {
  const key = (nativeEvent: { isComposing?: boolean; keyCode?: number }) => ({ nativeEvent });
  it("treats every composition signal as the input method's Enter", () => {
    expect(isImeEnter(key({}), true)).toBe(true); // between compositionstart and compositionend
    expect(isImeEnter(key({ isComposing: true }), false)).toBe(true); // Chrome / Firefox
    expect(isImeEnter(key({ keyCode: 229 }), false)).toBe(true); // Safari: compositionend already fired
  });
  it("lets an ordinary Enter through", () => {
    expect(isImeEnter(key({ isComposing: false, keyCode: 13 }), false)).toBe(false);
  });
});

describe("ChatPage composer, history and extraction states (mocked backend)", () => {
  it("does not send on the Enter that confirms an IME composition, then sends on a normal Enter, once", async () => {
    const chats: Call[] = [];
    backend({ onChat: (call, stream) => { chats.push(call); replyStream("Done.")(call, stream); }, extra: (call) => (call.url === "/discovery/suggest" ? json({ status: "ok", facts: [], rejected: 0 }) : undefined) });
    renderChat();
    const box = await screen.findByLabelText("Message");
    await waitFor(() => expect(screen.getByText(/ZRouter: Ready/)).toBeInTheDocument());
    await waitFor(() => expect(within(screen.getByRole("banner")).getByRole("button", { name: "New chat" })).toBeEnabled());
    fireEvent.change(box, { target: { value: "こんにちは" } });

    fireEvent.compositionStart(box);
    fireEvent.keyDown(box, { key: "Enter", isComposing: true, keyCode: 229 });
    fireEvent.compositionEnd(box);
    // Safari order: compositionend first, then the confirming Enter with keyCode 229.
    fireEvent.keyDown(box, { key: "Enter", keyCode: 229 });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(chats).toHaveLength(0);

    fireEvent.keyDown(box, { key: "Enter", shiftKey: true, keyCode: 13 });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(chats).toHaveLength(0);

    fireEvent.keyDown(box, { key: "Enter", keyCode: 13 });
    fireEvent.keyDown(box, { key: "Enter", keyCode: 13 }); // a held or doubled key must not send twice
    await waitFor(() => expect(chats).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(chats).toHaveLength(1);
  });

  it("shows chat history, generation and Memory writes as separate states and never calls the whole thing Saved", async () => {
    backend({
      onChat: replyStream("Reply."),
      extra: (call) => {
        if (call.url === "/discovery/suggest") return json({ status: "ok", facts: [{ id: "33333333-3333-4333-8333-333333333333", text: "We have two engineers.", category: "capacity" }], rejected: 0 });
        if (call.url === "/discovery/memories") return json({ jobs: [{ client_id: "33333333-3333-4333-8333-333333333333", state: "pending", job_id: "job-3", relayer_status: "pending", blob_id: null, message: null }] });
        if (call.url === "/discovery/memories/status") return json({ jobs: [{ client_id: "33333333-3333-4333-8333-333333333333", state: "pending", job_id: "job-3", relayer_status: "pending", blob_id: null, message: null }] });
        return undefined;
      },
    });
    renderChat();
    await send("We have two engineers.");
    const section = await screen.findByRole("region", { name: "Suggested memories" });
    await waitFor(() => expect(screen.getByTestId("history-status")).toHaveTextContent("Chat history: Saved"));
    expect(screen.queryByTestId("memory-writes")).not.toBeInTheDocument();
    fireEvent.click(within(section).getByRole("button", { name: "Save selected" }));
    await waitFor(() => expect(screen.getByTestId("memory-writes")).toHaveTextContent("1 pending"));
    // Accepted by the relayer is pending, not stored; history stays its own label.
    expect(screen.getByTestId("memory-writes")).not.toHaveTextContent(/stored/);
    expect(screen.getByTestId("history-status")).toHaveTextContent("Chat history: Saved");
  });

  it("refuses to send, and says why, when project history cannot be loaded", async () => {
    const chats: Call[] = [];
    backend({ onChat: (call) => chats.push(call), history: false, extra: (call) => (call.url === "/projects" ? json({ code: "backend_unavailable", message: "The workspace backend is unavailable." }, 503) : undefined) });
    renderChat();
    expect(await screen.findByText(/Chat history is unavailable/)).toBeInTheDocument();
    fireEvent.change(await screen.findByLabelText("Message"), { target: { value: "Hello?" } });
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    fireEvent.keyDown(screen.getByLabelText("Message"), { key: "Enter", keyCode: 13 });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(chats).toHaveLength(0);
    expect(screen.getByLabelText("Message")).toHaveValue("Hello?");
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("offers an explicit temporary chat that is labelled unsaved, sends no project and turns Memory off", async () => {
    const calls: Call[] = [];
    backend({ onChat: (call, stream) => { calls.push(call); replyStream("Hi.")(call, stream); }, history: false, extra: (call) => (call.url === "/projects" ? json({ code: "backend_unavailable", message: "down" }, 503) : undefined) });
    renderChat();
    fireEvent.click(await screen.findByRole("button", { name: /Start a temporary chat/ }));
    expect(screen.getByText(/Temporary chat: nothing is saved to history and Memory is off/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Quick question" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].body).toEqual({ messages: [{ role: "user", content: "Quick question" }], use_memory: false });
    expect(screen.getByTestId("history-status")).toHaveTextContent("Temporary chat, not saved");
  });

  it("shows a failed extraction as a retryable error, not as no facts, and retrying does not regenerate the reply", async () => {
    let suggestCalls = 0;
    const chats: Call[] = [];
    backend({
      onChat: (call, stream) => { chats.push(call); replyStream("Original answer.")(call, stream); },
      extra: (call) => {
        if (call.url !== "/discovery/suggest") return undefined;
        suggestCalls += 1;
        return suggestCalls === 1
          ? json({ code: "extraction_truncated", message: "The model ran out of output budget.", retryable: true }, 502)
          : json({ status: "ok", facts: [{ id: "44444444-4444-4444-8444-444444444444", text: "The priority is onboarding.", category: "priority" }], rejected: 0 });
      },
    });
    renderChat();
    await send("The priority is onboarding.");
    const failed = await screen.findByTestId("extraction-failed");
    expect(failed).toHaveTextContent(/not the same as .no facts found./);
    expect(screen.queryByText(/No durable facts were found/)).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Suggested memories" })).not.toBeInTheDocument();

    fireEvent.click(within(failed).getByRole("button", { name: /Retry suggestions/ }));
    const section = await screen.findByRole("region", { name: "Suggested memories" });
    expect(within(section).getByLabelText("Edit suggested fact")).toHaveValue("The priority is onboarding.");
    expect(screen.getByText("Original answer.")).toBeInTheDocument();
    expect(chats).toHaveLength(1); // the answer was not generated again
    expect(suggestCalls).toBe(2);
  });

  it("says no durable facts were found only when extraction succeeded with an empty list", async () => {
    backend({ onChat: replyStream("Fine."), extra: (call) => (call.url === "/discovery/suggest" ? json({ status: "ok", facts: [], rejected: 0 }) : undefined) });
    renderChat();
    await send("Hello there.");
    expect(await screen.findByText(/No durable facts were found in this message\. Nothing was saved\./)).toBeInTheDocument();
    expect(screen.queryByTestId("extraction-failed")).not.toBeInTheDocument();
  });

  it("does not show a late extraction result after the user moves to another chat", async () => {
    let release!: (response: Response) => void;
    const slow = new Promise<Response>((resolve) => { release = resolve; });
    backend({ onChat: replyStream("Answer."), extra: (call) => (call.url === "/discovery/suggest" ? slow : undefined) });
    renderChat();
    await send("We serve solo founders.");
    expect(await screen.findByTestId("extraction-loading")).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("banner")).getByRole("button", { name: "New chat" }));
    release(json({ status: "ok", facts: [{ id: "55555555-5555-4555-8555-555555555555", text: "Late fact.", category: "audience" }], rejected: 0 }));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(screen.queryByText("Late fact.")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Suggested memories" })).not.toBeInTheDocument();
  });

  it("keeps the partial reply when the user switches chats mid-generation and sends it to the original chat as interrupted", async () => {
    let active: Stream | undefined;
    const replies: Call[] = [];
    backend({
      onChat: (_call, stream) => { active = stream; },
      extra: (call) => {
        if (call.url === `/conversations/${CHAT}/replies`) { replies.push(call); return json({ history: "saved" }); }
        return undefined;
      },
    });
    renderChat();
    await send("Tell me a long story.");
    await waitFor(() => expect(active).toBeDefined());
    active!.push("memory", { state: "none", facts: [], filtered_out: 0, policy: "p", query_characters: 3 });
    active!.push("delta", { text: "Once upon" });
    await screen.findByText("Once upon");
    fireEvent.click(within(screen.getByRole("banner")).getByRole("button", { name: "New chat" }));
    await waitFor(() => expect(replies.length).toBeGreaterThan(0));
    expect(replies[0].body).toMatchObject({ content: "Once upon", status: "interrupted" });
    active!.push("delta", { text: " a late chunk" });
    expect(screen.queryByText(/late chunk/)).not.toBeInTheDocument();
  });
});
