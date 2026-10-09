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
  | { state: "included" | "none"; facts: RecalledFact[]; filtered_out?: number; candidates?: number; policy: string; query_characters?: number; namespace?: string; reason?: string; includes_previous_user_message?: boolean }
  | { state: "off"; reason?: string }
  | { state: "unavailable" | "failed"; code: string; message: string };

export interface RequestShape {
  model: string;
  message_roles: string[];
  memory_context_included: boolean;
  memory_facts_included: number;
  conversation_messages: number;
  project_id?: string;
  /** The saved agent revision this run resolved at its start. */
  agent?: { key: string; revision: number; name: string; tools?: string[] };
}

/** Server-resolved Memory scope. Memory is never used without a project. */
export interface MemoryScope {
  projectId: string;
  conversationId?: string;
}

/** The agent revision a turn ran with; its capabilities apply to saves. */
export interface AgentRef {
  key: string;
  revision?: number;
}

function scopeBody(scope: MemoryScope, agent?: AgentRef) {
  return {
    project_id: scope.projectId,
    ...(scope.conversationId ? { conversation_id: scope.conversationId } : {}),
    ...(agent ? { agent_key: agent.key, ...(agent.revision ? { agent_revision: agent.revision } : {}) } : {}),
  };
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
  /** Saved conversation and the request id of its already-saved user message. */
  conversationId?: string;
  requestId?: string;
  agentKey?: string;
  agentRevision?: number;
  signal: AbortSignal;
  onEvent: (event: ChatStreamEvent) => void;
}

/**
 * Streams one Product Discovery reply. Aborting the signal cancels the fetch;
 * the backend then drops the upstream proxy request. Events that arrive after
 * an abort are discarded.
 */
export async function streamChat({ messages, useMemory, model, projectId, conversationId, requestId, agentKey, agentRevision, signal, onEvent }: StreamChatOptions): Promise<void> {
  const response = await apiFetch("/discovery/chat", {
    method: "POST",
    body: JSON.stringify({
      messages,
      use_memory: useMemory,
      ...(model ? { model } : {}),
      ...(projectId ? { project_id: projectId } : {}),
      ...(conversationId && requestId ? { conversation_id: conversationId, request_id: requestId } : {}),
      ...(agentKey ? { agent_key: agentKey } : {}),
      ...(agentKey && agentRevision ? { agent_revision: agentRevision } : {}),
    }),
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

export interface SuggestResult {
  facts: SuggestedFact[];
  rejected: number;
  model_reported: string | null;
  finish_reason?: string | null;
  attempts?: number;
}

/**
 * Asks the configured model for durable facts in one user message. It never
 * saves anything. A truncated, malformed or failed extraction rejects with a
 * BuilderApiError (`extraction_truncated`, `extraction_invalid`, a provider
 * code); only a well-formed empty answer resolves with no facts.
 */
export function suggestFacts(userMessage: string, assistantMessage: string, scope: MemoryScope, agent?: AgentRef, signal?: AbortSignal) {
  return requestJson<SuggestResult>("/discovery/suggest", {
    method: "POST",
    body: JSON.stringify({ user_message: userMessage, assistant_message: assistantMessage, ...scopeBody(scope, agent) }),
    signal,
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

export function saveFacts(facts: { client_id: string; text: string }[], scope: MemoryScope, agent?: AgentRef) {
  return requestJson<{ jobs: FactJob[] }>("/discovery/memories", { method: "POST", body: JSON.stringify({ facts, ...scopeBody(scope, agent) }) });
}

export function factStatus(clientIds: string[], scope: MemoryScope) {
  return requestJson<{ jobs: FactJob[] }>("/discovery/memories/status", { method: "POST", body: JSON.stringify({ client_ids: clientIds, ...scopeBody(scope) }) });
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
  project_required: "Choose a project first. Memory is scoped to a project, so nothing was read or written.",
  scope_mismatch: "That chat belongs to a different project. Nothing was read or written.",
  agent_not_found: "That agent or revision was not found, so nothing was run.",
  capability_disabled: "This agent revision does not allow that Memory operation.",
  unauthorized: "Sign in to the workspace first.",
  backend_unavailable: "The workspace backend is unavailable.",
};

export function chatErrorMessage(code: string, fallback: string): string {
  return CHAT_ERRORS[code] ?? fallback;
}
