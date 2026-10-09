import { BuilderApiError, requestJson } from "./api-client";

/** Walrus Memory connection metadata for the signed-in user. No key material. */
export interface WalrusStatus {
  configured: boolean;
  /** `verified`, `requires_reconnect`, `key_stored`, `not_connected` or `signed_out`. */
  status: string;
  accountId: string | null;
  namespace: string;
  serverUrl: string;
  network: string;
  lastError: string | null;
  lastErrorCode: string | null;
  lastVerifiedAt: string | null;
}

export interface MemorySession {
  signedIn: boolean;
  address: string | null;
  walrus: WalrusStatus;
}

export const MAINNET_RELAYER = "https://relayer.memory.walrus.xyz";
export const DEFAULT_NAMESPACE = "bew-harness/product-discovery";

interface ApiWalrus {
  configured: boolean;
  status: string;
  account_id: string | null;
  namespace: string;
  server_url: string;
  network: string;
  last_error: string | null;
  last_error_code: string | null;
  last_verified_at: string | null;
}

function walrusFromApi(body: ApiWalrus): WalrusStatus {
  return {
    configured: body.configured,
    status: body.status,
    accountId: body.account_id,
    namespace: body.namespace,
    serverUrl: body.server_url,
    network: body.network,
    lastError: body.last_error,
    lastErrorCode: body.last_error_code,
    lastVerifiedAt: body.last_verified_at,
  };
}

/** Throws `BuilderApiError` when the backend fails; never reports that as "Not connected". */
export async function memorySession(): Promise<MemorySession> {
  const body = await requestJson<{ signed_in: boolean; address: string | null; walrus: ApiWalrus }>("/memory/session");
  return { signedIn: body.signed_in, address: body.address, walrus: walrusFromApi(body.walrus) };
}

export interface SaveWalrusInput {
  accountId: string;
  delegateKey: string;
  namespace: string;
}

/** Saves, then verifies with a real signed relayer call before the backend reports Ready. */
export async function saveWalrus(input: SaveWalrusInput): Promise<WalrusStatus> {
  const body = await requestJson<ApiWalrus>("/memory/walrus", {
    method: "POST",
    body: JSON.stringify({
      account_id: input.accountId.trim(),
      delegate_key: input.delegateKey.trim() || null,
      namespace: input.namespace.trim(),
      server_url: MAINNET_RELAYER,
      network: "mainnet",
    }),
  });
  return walrusFromApi(body);
}

export async function clearWalrus(): Promise<void> {
  await requestJson<ApiWalrus>("/memory/walrus", { method: "DELETE" });
}

const MEMORY_ERRORS: Record<string, string> = {
  invalid_credentials: "Invalid credentials: the relayer rejected this delegate key for this account.",
  account_not_found: "Account not found on Sui Mainnet.",
  wrong_network: "The relayer is not on Mainnet.",
  relayer_unavailable: "The Walrus Memory relayer is unavailable.",
  relayer_rate_limited: "The relayer is rate limiting requests.",
  unsupported_version: "Unsupported SDK or relayer API version.",
  sdk_unavailable: "The backend could not run the Walrus Memory SDK.",
  backend_unavailable: "The workspace backend is unavailable.",
};

export function memoryErrorLabel(code: string | null | undefined, fallback?: string | null): string {
  return (code && MEMORY_ERRORS[code]) || fallback || "Walrus Memory needs attention.";
}

export type MemoryBadge = { label: "Not connected" | "Verifying" | "Ready" | "Needs reconnect" | "Unavailable" | "Sign in required"; tone: "ok" | "warn" | "muted" };

export function memoryBadge(session: MemorySession | undefined, error: unknown, verifying: boolean): MemoryBadge {
  if (verifying) return { label: "Verifying", tone: "muted" };
  if (error) return { label: "Unavailable", tone: "warn" };
  if (!session) return { label: "Verifying", tone: "muted" };
  if (!session.signedIn) return { label: "Sign in required", tone: "muted" };
  if (session.walrus.status === "verified") return { label: "Ready", tone: "ok" };
  if (session.walrus.status === "requires_reconnect" || session.walrus.status === "key_stored") return { label: "Needs reconnect", tone: "warn" };
  return { label: "Not connected", tone: "muted" };
}

export function isBackendDown(error: unknown): boolean {
  return error instanceof BuilderApiError && error.status === 0;
}
