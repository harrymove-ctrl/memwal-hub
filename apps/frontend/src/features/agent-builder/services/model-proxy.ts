import { requestJson } from "./api-client";

export type ModelProxyState = "not_configured" | "untested" | "ready" | "needs_attention" | "unavailable";

/** Redacted connection metadata. The API key itself is never returned. */
export interface ModelProxyStatus {
  configured: boolean;
  status: ModelProxyState;
  connection_name: string | null;
  base_url: string | null;
  model_id: string | null;
  key_saved: boolean;
  max_output_tokens: number | null;
  temperature: number | null;
  last_error_code: string | null;
  last_error: string | null;
  last_tested_at: string | null;
  last_model_reported: string | null;
  local_http_exception: boolean;
}

export interface ModelProxyForm {
  connectionName: string;
  baseUrl: string;
  apiKey: string;
  modelId: string;
  maxOutputTokens: string;
  temperature: string;
}

export interface ModelList {
  available: boolean;
  models: string[];
  error_code?: string;
  message?: string;
}

export const emptyProxyForm: ModelProxyForm = {
  connectionName: "ZRouter",
  baseUrl: "",
  apiKey: "",
  modelId: "",
  maxOutputTokens: "2048",
  temperature: "",
};

const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,127}$/;

export type ProxyFormErrors = Partial<Record<keyof ModelProxyForm, string>>;

/** Client-side checks mirror the backend; the backend remains authoritative. */
export function validateProxyForm(form: ModelProxyForm, keySaved: boolean): ProxyFormErrors {
  const errors: ProxyFormErrors = {};
  if (!form.connectionName.trim()) errors.connectionName = "Enter a connection name.";
  else if (form.connectionName.trim().length > 60) errors.connectionName = "Use 60 characters or fewer.";
  const base = form.baseUrl.trim();
  if (!base) errors.baseUrl = "Enter the API base URL.";
  else {
    try {
      const url = new URL(base);
      const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
      if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) errors.baseUrl = "Use an https:// URL.";
      else if (url.username || url.password) errors.baseUrl = "Remove credentials from the URL.";
      else if (url.search || url.hash) errors.baseUrl = "Remove the query string from the URL.";
    } catch {
      errors.baseUrl = "Enter a valid URL, for example https://proxy.example.com/v1.";
    }
  }
  if (!form.apiKey.trim() && !keySaved) errors.apiKey = "Enter the API key.";
  else if (/\s/.test(form.apiKey.trim())) errors.apiKey = "The key cannot contain spaces.";
  if (!MODEL_ID.test(form.modelId.trim())) errors.modelId = "Enter a model ID such as provider-model-name.";
  const max = Number(form.maxOutputTokens);
  if (!Number.isInteger(max) || max < 64 || max > 8192) errors.maxOutputTokens = "Use a whole number from 64 to 8192.";
  if (form.temperature.trim()) {
    const temperature = Number(form.temperature);
    if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) errors.temperature = "Use a number from 0 to 2.";
  }
  return errors;
}

/**
 * Reads supported fields from a pasted configuration snippet (JSON, TOML,
 * dotenv or a curl command). The text is only parsed, never executed, and any
 * other content is ignored.
 */
export function parseConfigSnippet(text: string): Partial<ModelProxyForm> {
  const result: Partial<ModelProxyForm> = {};
  const pick = (patterns: RegExp[]) => {
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match?.[1]) return match[1].trim();
    }
    return undefined;
  };
  const installHost = text.match(/https?:\/\/([a-z0-9.-]*zroute\.ai)\/install\.sh/i)?.[1]?.toLowerCase();
  if (installHost) {
    const apiHost = installHost.startsWith("dev.")
      ? `api-${installHost}`
      : installHost.startsWith("api.") || installHost.startsWith("api-")
        ? installHost
        : `api.${installHost}`;
    result.baseUrl = `https://${apiHost}/openai`;
  }
  const base = pick([
    /["']?(?:base_?url|baseURL|api_?base|api_url|OPENAI_BASE_URL|OPENAI_API_BASE)["']?\s*[:=]\s*["']?(https?:\/\/[^\s"',}]+)/i,
    /(https?:\/\/[^\s"']+?)\/(?:chat\/completions|models)\b/i,
  ]);
  if (base) result.baseUrl = base.replace(/\/(chat\/completions|models)\/?$/, "");
  const key = pick([
    /["']?(?:api_?key|apiKey|OPENAI_API_KEY|experimental_bearer_token|token)["']?\s*[:=]\s*["']([^"'\s]+)["']/i,
    /^(?:export\s+)?[A-Z_]*API_KEY\s*=\s*["']?([^"'\s]+)/im,
    /Authorization:\s*Bearer\s+([^\s"']+)/i,
    /\b(zr_(?:live|test)_[A-Za-z0-9_-]+)/,
  ]);
  if (key && !key.startsWith("$") && !key.includes("$(")) result.apiKey = key;
  const model = pick([/["']?(?:model|model_id|modelId|default_model)["']?\s*[:=]\s*["']([^"'\s]+)["']/i]);
  if (model && MODEL_ID.test(model) && !model.includes("$(")) result.modelId = model;
  return result;
}

export const ZROUTE_MODELS = [
  "zroute/grok-4.5",
  "zroute/grok-4.6",
  "zroute/grok-4.7",
  "zroute/grok-4.7-build-fast",
  "zroute/claude-opus-5-5",
  "zroute/claude-sonnet-5-5",
  "zroute/gemini-3.8-flash",
  "zroute/gemini-3.1-pro",
];

/**
 * Model options shown in the dialog: only IDs the proxy actually listed, plus
 * the one already typed or saved. IDs are never guessed from a catalog
 * (`ZROUTE_MODELS` is kept for reference only; the live ZRoute list returns
 * bare IDs such as "gemini-3.8-flash").
 */
export function modelChoices(_baseUrl: string, loaded: string[], current: string): string[] {
  return [...new Set([...loaded, current.trim()].filter(Boolean))];
}

export function formToPayload(form: ModelProxyForm, test: boolean) {
  return {
    connection_name: form.connectionName.trim(),
    base_url: form.baseUrl.trim(),
    api_key: form.apiKey.trim() || null,
    model_id: form.modelId.trim(),
    max_output_tokens: Number(form.maxOutputTokens),
    temperature: form.temperature.trim() ? Number(form.temperature) : null,
    test,
  };
}

const modelProxyService = {
  status: () => requestJson<ModelProxyStatus>("/model-proxy"),
  save: (form: ModelProxyForm, test: boolean) =>
    requestJson<ModelProxyStatus>("/model-proxy", { method: "POST", body: JSON.stringify(formToPayload(form, test)) }),
  test: () => requestJson<ModelProxyStatus>("/model-proxy/test", { method: "POST" }),
  models: () => requestJson<ModelList>("/model-proxy/models"),
  disconnect: () => requestJson<ModelProxyStatus>("/model-proxy", { method: "DELETE" }),
};

export default modelProxyService;

export function proxyBadge(status: ModelProxyStatus | undefined, testing: boolean): { label: string; tone: "ok" | "warn" | "muted" } {
  if (testing) return { label: "Testing", tone: "muted" };
  switch (status?.status) {
    case "ready":
      return { label: "Ready", tone: "ok" };
    case "untested":
      return { label: "Needs attention", tone: "warn" };
    case "needs_attention":
      return { label: "Needs attention", tone: "warn" };
    case "unavailable":
      return { label: "Unavailable", tone: "warn" };
    default:
      return { label: "Not configured", tone: "muted" };
  }
}
