import { BuilderApiError, apiFetch, requestJson } from "./api-client";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface RecalledFact {
  text: string;
  blob_id: string | null;
  created_at: string | null;
  distance: number | null;
}

export type MemoryEvent =
  | { state: "recalling" }
  | { state: "included" | "none"; facts: RecalledFact[]; filtered_out: number; policy: string; query_characters: number }
  | { state: "off" }
  | { state: "unavailable" | "failed"; code: string; message: string };

export interface RequestShape {
  model: string;
  message_roles: string[];
  memory_context_included: boolean;
  memory_facts_included: number;
  conversation_messages: number;
}

export interface DoneEvent {
  model_reported: string | null;
  finish_reason: string | null;
  usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null;
  characters: number;
}

export type ChatStreamEvent =
  | { type: "memory"; data: MemoryEvent }
  | { type: "request"; data: RequestShape }
  | { type: "delta"; data: { text: string } }
  | { type: "done"; data: DoneEvent }
  | { type: "error"; data: { code: string; message: string } };

/** Incremental parser for the backend's `event:` / `data:` frames. */
export class ChatEventParser {
  private buffer = "";

  push(chunk: string): ChatStreamEvent[] {
    this.buffer += chunk.replace(/\r\n/g, "\n");
    const events: ChatStreamEvent[] = [];
    let boundary = this.buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const frame = this.buffer.slice(0, boundary);
      this.buffer = this.buffer.slice(boundary + 2);
      let name = "message";
      const data: string[] = [];
      for (const line of frame.split("\n")) {
        if (line.startsWith("event:")) name = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
      }
      if (data.length) {
        try {
          const parsed: unknown = JSON.parse(data.join("\n"));
          if (["memory", "request", "delta", "done", "error"].includes(name)) {
            events.push({ type: name, data: parsed } as ChatStreamEvent);
          }
        } catch {
          /* ignore malformed frames */
        }
      }
      boundary = this.buffer.indexOf("\n\n");
    }
    return events;
  }
}

export interface StreamChatOptions {
  messages: ChatTurn[];
  useMemory: boolean;
  /** Per-conversation model ID; the saved connection's model when omitted. */
  model?: string;
  projectId?: string;
  signal: AbortSignal;
  onEvent: (event: ChatStreamEvent) => void;
}

/**
 * Streams one Product Discovery reply. Aborting the signal cancels the fetch;
 * the backend then drops the upstream proxy request. Events that arrive after
 * an abort are discarded.
 */
export async function streamChat({ messages, useMemory, model, projectId, signal, onEvent }: StreamChatOptions): Promise<void> {
  const response = await apiFetch("/discovery/chat", {
    method: "POST",
    body: JSON.stringify({ messages, use_memory: useMemory, ...(model ? { model } : {}), ...(projectId ? { project_id: projectId } : {}) }),
    signal,
  });
  if (!response.ok || !response.body) {
    const body = (await response.json().catch(() => null)) as { code?: string; message?: string } | null;
    throw new BuilderApiError(response.status, body?.code ?? `http_${response.status}`, body?.message ?? "The chat request failed.");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parser = new ChatEventParser();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (signal.aborted) return;
      if (done) break;
      for (const event of parser.push(decoder.decode(value, { stream: true }))) {
        if (signal.aborted) return;
        onEvent(event);
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export interface SuggestedFact {
  id: string;
  text: string;
  category: string;
}

export function suggestFacts(userMessage: string, assistantMessage: string) {
  return requestJson<{ facts: SuggestedFact[]; rejected: number; model_reported: string | null }>("/discovery/suggest", {
    method: "POST",
    body: JSON.stringify({ user_message: userMessage, assistant_message: assistantMessage }),
  });
}

export interface FactJob {
  client_id: string;
  state: "pending" | "saved" | "failed" | "uncertain";
  job_id: string | null;
  relayer_status: string | null;
  blob_id: string | null;
  message: string | null;
}

export function saveFacts(facts: { client_id: string; text: string }[], projectId?: string) {
  return requestJson<{ jobs: FactJob[] }>("/discovery/memories", { method: "POST", body: JSON.stringify({ facts, ...(projectId ? { project_id: projectId } : {}) }) });
}

export function factStatus(clientIds: string[]) {
  return requestJson<{ jobs: FactJob[] }>("/discovery/memories/status", { method: "POST", body: JSON.stringify({ client_ids: clientIds }) });
}

const CHAT_ERRORS: Record<string, string> = {
  invalid_key: "ZRouter rejected the API key. Open Integrations and update it.",
  model_unavailable: "ZRouter does not offer this model right now. Choose another model ID in Integrations.",
  wrong_endpoint: "The proxy URL did not answer like a Chat Completions endpoint.",
  rate_limited: "ZRouter is rate limiting this key or its quota is exhausted. Try again later.",
  timeout: "ZRouter did not answer in time.",
  proxy_unavailable: "ZRouter is unavailable right now.",
  model_not_ready: "Test the ZRouter connection until it shows Ready.",
  model_not_configured: "Configure ZRouter in Integrations first.",
  memory_unavailable: "Walrus Memory is unavailable, so nothing was recalled.",
  unauthorized: "Sign in to the workspace first.",
  backend_unavailable: "The workspace backend is unavailable.",
};

export function chatErrorMessage(code: string, fallback: string): string {
  return CHAT_ERRORS[code] ?? fallback;
}
