import type { RunCallbacks, RunService } from "./run-service";

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8080").replace(/\/$/, "");

export interface WalrusStatus {
  configured: boolean;
  status: string;
  accountId: string | null;
  namespace: string;
  serverUrl: string;
  lastError: string | null;
}

export interface MemorySession {
  address: string | null;
  walrus: WalrusStatus;
}

const unavailable: WalrusStatus = {
  configured: false,
  status: "unavailable",
  accountId: null,
  namespace: "bew-harness/product-discovery",
  serverUrl: "https://relayer.memory.walrus.xyz",
  lastError: null,
};

export async function memorySession(): Promise<MemorySession> {
  const response = await fetch(`${apiBaseUrl}/memory/session`, { credentials: "include" });
  if (!response.ok) return { address: null, walrus: unavailable };
  const body = (await response.json()) as {
    address?: string | null;
    walrus?: {
      configured?: boolean;
      status?: string;
      account_id?: string | null;
      namespace?: string;
      server_url?: string;
      last_error?: string | null;
    };
  };
  return {
    address: body.address || null,
    walrus: {
      configured: Boolean(body.walrus?.configured),
      status: body.walrus?.status ?? "unavailable",
      accountId: body.walrus?.account_id ?? null,
      namespace: body.walrus?.namespace ?? unavailable.namespace,
      serverUrl: body.walrus?.server_url ?? unavailable.serverUrl,
      lastError: body.walrus?.last_error ?? null,
    },
  };
}

export async function saveWalrus(input: {
  accountId: string;
  delegateKey: string;
  namespace: string;
  serverUrl: string;
}): Promise<void> {
  const response = await fetch(`${apiBaseUrl}/memory/walrus`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      account_id: input.accountId,
      delegate_key: input.delegateKey,
      namespace: input.namespace,
      server_url: input.serverUrl,
    }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? "Walrus settings were not saved.");
  }
}

export async function clearWalrus(): Promise<void> {
  const response = await fetch(`${apiBaseUrl}/memory/walrus`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!response.ok) throw new Error("Walrus settings were not cleared.");
}

export function createMissingWalrusService(address: string): RunService {
  return {
    mode: "connected",
    start(_agentId, _prompt, cb) {
      const detail = `Signed in as ${address}. Walrus is not verified for this user. Open Settings and save a delegate key. No blob was invented.`;
      cb.onEvent({ t: "text", id: "recall-missing", text: detail });
      cb.onDone({ status: "failed", error: detail });
      return { stop() {} };
    },
  };
}

export function createWalletRecallService(address: string): RunService {
  return {
    mode: "connected",
    start(_agentId, prompt, cb) {
      const controller = new AbortController();
      const query = prompt?.trim() || `What should ${address} remember from earlier sessions?`;
      void runRecall(address, query, cb, controller.signal);
      return { stop: () => controller.abort() };
    },
  };
}

async function runRecall(address: string, query: string, cb: RunCallbacks, signal: AbortSignal) {
  const started = Date.now();
  cb.onEvent({ t: "text", id: "recall-prompt", text: `Signed in as ${address}. One recall: ${query}` });
  cb.onEvent({ t: "toolGroup", id: "walrus", label: "Walrus recall" });
  cb.onEvent({
    t: "tool",
    id: "walrus-recall",
    group: "walrus",
    name: "Walrus recall",
    app: "walrus",
    status: "running",
  });
  try {
    const response = await fetch(`${apiBaseUrl}/memory/recall`, {
      method: "POST",
      credentials: "include",
      signal,
    });
    const body = (await response.json()) as {
      detail?: string;
      status?: string;
      message?: string;
      memories?: { text: string; blob_id?: string | null }[];
    };
    const memories = body.memories ?? [];
    const detail = [
      body.detail || body.message || "Walrus recall returned no detail.",
      ...memories.map((memory) => `${memory.blob_id ?? "blob"}: ${memory.text}`),
    ].join("\n");
    const ok = body.status === "recalled";
    cb.onEvent({ t: "toolStatus", id: "walrus-recall", status: ok ? "done" : "error" });
    cb.onEvent({ t: "text", id: "recall-result", text: detail });
    cb.onProgress(Date.now() - started, 0);
    cb.onDone(ok ? { status: "completed" } : { status: "failed", error: detail });
  } catch (error) {
    if (signal.aborted) return;
    const detail = error instanceof Error ? error.message : "Walrus recall failed.";
    cb.onEvent({ t: "toolStatus", id: "walrus-recall", status: "error" });
    cb.onDone({ status: "failed", error: detail });
  }
}
