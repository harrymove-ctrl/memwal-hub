import { afterEach, describe, expect, it, vi } from "vitest";

import { ChatEventParser, streamChat, type ChatStreamEvent } from "./discovery-chat";
import { memorySession } from "./wallet-recall";
import { json, mockFetch, sseBody } from "../test/helpers";

afterEach(() => vi.unstubAllGlobals());

describe("ChatEventParser", () => {
  it("handles frames split across chunks", () => {
    const parser = new ChatEventParser();
    expect(parser.push('event: delta\ndata: {"te')).toEqual([]);
    expect(parser.push('xt":"Hel"}\n\nevent: delta\ndata: {"text":"lo"}\n\n')).toEqual([
      { type: "delta", data: { text: "Hel" } },
      { type: "delta", data: { text: "lo" } },
    ]);
  });

  it("ignores unknown events and malformed data", () => {
    const parser = new ChatEventParser();
    expect(parser.push("event: other\ndata: {}\n\nevent: delta\ndata: nope\n\n")).toEqual([]);
  });
});

describe("streamChat (mocked backend)", () => {
  it("sends only the current conversation and relays events in order", async () => {
    let stream: ReturnType<typeof sseBody> | undefined;
    const { calls } = mockFetch((call) => {
      stream = sseBody(call.signal);
      return stream.response;
    });
    const events: ChatStreamEvent[] = [];
    const done = streamChat({ messages: [{ role: "user", content: "hello" }], useMemory: true, signal: new AbortController().signal, onEvent: (event) => events.push(event) });
    await vi.waitFor(() => expect(stream).toBeDefined());
    stream!.push("memory", { state: "recalling" });
    stream!.push("delta", { text: "Hi" });
    stream!.push("done", { model_reported: "m", finish_reason: "stop", usage: null, characters: 2 });
    stream!.close();
    await done;
    expect(calls[0]).toMatchObject({ url: "/discovery/chat", method: "POST", body: { messages: [{ role: "user", content: "hello" }], use_memory: true } });
    expect(JSON.stringify(calls[0].body)).not.toMatch(/key|base_url|http/i);
    expect(events.map((event) => event.type)).toEqual(["memory", "delta", "done"]);
  });

  it("stops relaying events after abort", async () => {
    let stream: ReturnType<typeof sseBody> | undefined;
    mockFetch((call) => {
      stream = sseBody(call.signal);
      return stream.response;
    });
    const controller = new AbortController();
    const events: ChatStreamEvent[] = [];
    const done = streamChat({ messages: [{ role: "user", content: "x" }], useMemory: false, signal: controller.signal, onEvent: (event) => events.push(event) });
    await vi.waitFor(() => expect(stream).toBeDefined());
    stream!.push("delta", { text: "a" });
    await vi.waitFor(() => expect(events).toHaveLength(1));
    controller.abort();
    stream!.push("delta", { text: "late" });
    await expect(done).rejects.toThrow();
    expect(events).toHaveLength(1);
  });
});

describe("memorySession", () => {
  it("throws on a backend failure instead of reporting Not connected", async () => {
    mockFetch(() => json({ code: "backend_error", message: "Walrus Memory status could not be read from the database." }, 500));
    await expect(memorySession()).rejects.toMatchObject({ status: 500, code: "backend_error" });
  });

  it("reports an unreachable backend distinctly", async () => {
    mockFetch(() => undefined);
    await expect(memorySession()).rejects.toMatchObject({ status: 0, code: "backend_unavailable" });
  });
});
