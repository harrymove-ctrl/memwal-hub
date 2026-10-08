import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { vi } from "vitest";

import type { ShellCtx } from "../App";

export const API = "http://localhost:8080";

export const ctx: ShellCtx = { notify: vi.fn(), openSidebar: vi.fn(), showOpener: false, sidebarOpen: true };

export function renderWithClient(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return { client, ...render(<QueryClientProvider client={client}><MemoryRouter>{node}</MemoryRouter></QueryClientProvider>) };
}

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export interface Call {
  url: string;
  method: string;
  body: unknown;
  signal?: AbortSignal | null;
}

type Handler = (call: Call) => Response | Promise<Response> | undefined;

/** Routes mocked fetches by method and path; records every call (MOCKED, not live). */
export function mockFetch(handler: Handler) {
  const calls: Call[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const call: Call = {
      url: url.replace(API, ""),
      method: (init?.method ?? "GET").toUpperCase(),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      signal: init?.signal,
    };
    calls.push(call);
    const response = await handler(call);
    if (!response) throw new TypeError("Failed to fetch");
    return response;
  });
  vi.stubGlobal("fetch", fn);
  return { calls, fn };
}

/** A controllable server-sent event body that errors when the request is aborted. */
export function sseBody(signal?: AbortSignal | null) {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({ start: (value) => { controller = value; } });
  signal?.addEventListener("abort", () => {
    if (!closed) {
      closed = true;
      controller.error(new DOMException("aborted", "AbortError"));
    }
  });
  return {
    response: new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } }),
    push(event: string, data: unknown) {
      if (!closed) controller.enqueue(new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
    },
    close() {
      if (!closed) {
        closed = true;
        controller.close();
      }
    },
  };
}

export const readyProxy = {
  configured: true,
  status: "ready",
  connection_name: "ZRouter",
  base_url: "https://proxy.example.com/v1",
  model_id: "example-model",
  key_saved: true,
  max_output_tokens: 800,
  temperature: null,
  last_error_code: null,
  last_error: null,
  last_tested_at: "2026-10-08T00:00:00Z",
  last_model_reported: "example-model",
  local_http_exception: false,
};

export const notConfiguredProxy = {
  ...readyProxy,
  configured: false,
  status: "not_configured",
  connection_name: null,
  base_url: null,
  model_id: null,
  key_saved: false,
  last_tested_at: null,
  last_model_reported: null,
};

export function memorySessionBody(status = "verified") {
  return {
    signed_in: true,
    address: null,
    walrus: {
      configured: status !== "not_connected",
      status,
      account_id: status === "not_connected" ? null : `0x${"a".repeat(64)}`,
      namespace: "bew-harness/product-discovery",
      server_url: "https://relayer.memory.walrus.xyz",
      network: "mainnet",
      last_error: null,
      last_error_code: null,
      last_verified_at: null,
    },
  };
}
