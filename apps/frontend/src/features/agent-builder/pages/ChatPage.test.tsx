import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChatPage, conversationFor, factStateFromJob } from "./ChatPage";
import { ctx, json, memorySessionBody, mockFetch, readyProxy, renderWithClient, sseBody, type Call } from "../test/helpers";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

type Stream = ReturnType<typeof sseBody>;

function backend(options: { onChat: (call: Call, stream: Stream) => void; memoryStatus?: string; extra?: (call: Call) => Response | undefined }) {
  return mockFetch((call) => {
    if (call.url === "/model-proxy") return json(readyProxy);
    if (call.url === "/memory/session") return json(memorySessionBody(options.memoryStatus ?? "verified"));
    if (call.url === "/discovery/chat") {
      const stream = sseBody(call.signal);
      options.onChat(call, stream);
      return stream.response;
    }
    return options.extra?.(call) ?? json({ code: "not_found", message: "no route" }, 404);
  });
}

async function send(text: string) {
  const box = await screen.findByLabelText("Message");
  await waitFor(() => expect(screen.getByText(/ZRouter: Ready/)).toBeInTheDocument());
  await waitFor(() => expect(screen.getByText(/Walrus Memory: (Ready|Not connected)/)).toBeInTheDocument());
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
    renderWithClient(<ChatPage ctx={ctx} />);
    await send("Should we prioritize shared team workspaces next?");
    expect(await screen.findByText("Focus on onboarding.")).toBeInTheDocument();
    expect(chats[0].body).toEqual({ messages: [{ role: "user", content: "Should we prioritize shared team workspaces next?" }], use_memory: true });

    fireEvent.click(screen.getByRole("button", { name: /1 saved memory provided as context/ }));
    expect(screen.getByText(fact.text)).toBeInTheDocument();
    expect(screen.queryByText(/Walrus blob blob-1/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Details/ }));
    expect(screen.getByText(/blob-1/)).toBeInTheDocument();
    expect(screen.getByText("example-model-2026")).toBeInTheDocument();
    await screen.findByText(/No durable facts/);

    fireEvent.click(screen.getByRole("button", { name: /New chat/ }));
    await send("A new question");
    await waitFor(() => expect(chats).toHaveLength(2));
    expect(chats[1].body).toEqual({ messages: [{ role: "user", content: "A new question" }], use_memory: true });
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
    expect(chats[0].body).toEqual({ messages: [{ role: "user", content: "Which model answers?" }], use_memory: true, model: "grok-test" });
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
    renderWithClient(<ChatPage ctx={ctx} />);
    await send("Long question");
    expect(await screen.findByText(/reached the maximum output token limit/)).toBeInTheDocument();
  });

  it("Stop aborts the request, keeps partial text, and ignores late events", async () => {
    let active: Stream | undefined;
    let signal: AbortSignal | null | undefined;
    backend({ onChat: (call, stream) => { active = stream; signal = call.signal; } });
    renderWithClient(<ChatPage ctx={ctx} />);
    await send("Tell me something long");
    await waitFor(() => expect(active).toBeDefined());
    active!.push("memory", { state: "none", facts: [], filtered_out: 0, policy: "p", query_characters: 3 });
    active!.push("delta", { text: "Partial" });
    await screen.findByText("Partial");
    fireEvent.click(screen.getByRole("button", { name: /Stop/ }));
    expect(signal?.aborted).toBe(true);
    expect(await screen.findByText(/Stopped\. The model request was cancelled/)).toBeInTheDocument();
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
    renderWithClient(<ChatPage ctx={ctx} />);
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
    renderWithClient(<ChatPage ctx={ctx} />);
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
    renderWithClient(<ChatPage ctx={ctx} />);
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
    renderWithClient(<ChatPage ctx={ctx} />);
    await send("Onboarding is the focus.");
    const section = await screen.findByRole("region", { name: "Suggested memories" });
    fireEvent.click(within(section).getByRole("button", { name: "Save selected" }));
    expect(await within(section).findByText("Failed")).toBeInTheDocument();
    expect(within(section).queryByText("Saved")).not.toBeInTheDocument();
    expect(within(section).getByRole("button", { name: "Retry selected" })).toBeEnabled();
  });
});
