/**
 * Builder API boundary. Every request goes to the Rust API with the session
 * cookie; no credential is ever read from or written to browser storage.
 */
export const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8080").replace(/\/$/, "");

/** A failed API call. `status` 0 means the backend could not be reached. */
export class BuilderApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "BuilderApiError";
    this.status = status;
    this.code = code;
  }
}

export function backendUnavailable(): BuilderApiError {
  return new BuilderApiError(0, "backend_unavailable", `The workspace backend at ${apiBaseUrl} did not respond. This is not the same as "Not connected".`);
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(`${apiBaseUrl}${path}`, {
      ...init,
      credentials: "include",
      headers: init.body ? { "content-type": "application/json", ...init.headers } : init.headers,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw backendUnavailable();
  }
}

export async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await apiFetch(path, init);
  const text = await response.text();
  let body: unknown = null;
  if (text.trim().startsWith("{") || text.trim().startsWith("[")) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  if (!response.ok) {
    const error = (body ?? {}) as { code?: string; message?: string };
    throw new BuilderApiError(response.status, error.code ?? `http_${response.status}`, error.message ?? `The backend answered ${response.status}.`);
  }
  if (body === null) {
    throw new BuilderApiError(response.status, "unexpected_response", "The backend answered without JSON, so no state was changed.");
  }
  return body as T;
}
