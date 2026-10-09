import { describe, expect, it } from "vitest";

import { emptyProxyForm, formToPayload, parseConfigSnippet, proxyBadge, validateProxyForm } from "./model-proxy";

const valid = { ...emptyProxyForm, baseUrl: "https://proxy.example.com/v1", apiKey: "test-key-value", modelId: "provider/model-1" };

describe("validateProxyForm", () => {
  it("accepts a complete https form", () => {
    expect(validateProxyForm(valid, false)).toEqual({});
  });

  it("requires every field and https", () => {
    const errors = validateProxyForm({ ...emptyProxyForm, connectionName: "", baseUrl: "http://proxy.example.com" }, false);
    expect(errors.connectionName).toBeTruthy();
    expect(errors.baseUrl).toMatch(/https/);
    expect(errors.apiKey).toBeTruthy();
    expect(errors.modelId).toBeTruthy();
  });

  it("allows http only for the local development hosts", () => {
    expect(validateProxyForm({ ...valid, baseUrl: "http://127.0.0.1:4000/v1" }, false).baseUrl).toBeUndefined();
    expect(validateProxyForm({ ...valid, baseUrl: "http://10.0.0.5/v1" }, false).baseUrl).toBeTruthy();
  });

  it("rejects credentials or query strings inside the URL", () => {
    expect(validateProxyForm({ ...valid, baseUrl: "https://user:pass@proxy.example.com" }, false).baseUrl).toBeTruthy();
    expect(validateProxyForm({ ...valid, baseUrl: "https://proxy.example.com/v1?key=abc" }, false).baseUrl).toBeTruthy();
  });

  it("lets a saved key stay hidden", () => {
    expect(validateProxyForm({ ...valid, apiKey: "" }, true).apiKey).toBeUndefined();
    expect(formToPayload({ ...valid, apiKey: "" }, false).api_key).toBeNull();
  });

  it("bounds the advanced settings", () => {
    expect(validateProxyForm({ ...valid, maxOutputTokens: "10" }, false).maxOutputTokens).toBeTruthy();
    expect(validateProxyForm({ ...valid, temperature: "3" }, false).temperature).toBeTruthy();
  });
});

describe("parseConfigSnippet", () => {
  it("reads only supported fields from JSON", () => {
    expect(parseConfigSnippet('{"baseURL": "https://proxy.example.com/v1", "apiKey": "k-123", "model": "m-1", "command": "rm -rf /"}')).toEqual({
      baseUrl: "https://proxy.example.com/v1",
      apiKey: "k-123",
      modelId: "m-1",
    });
  });

  it("reads a curl command without running it and strips the endpoint suffix", () => {
    const parsed = parseConfigSnippet('curl https://proxy.example.com/v1/chat/completions -H "Authorization: Bearer k-456" -d \'{"model": "m-2"}\'');
    expect(parsed).toEqual({ baseUrl: "https://proxy.example.com/v1", apiKey: "k-456", modelId: "m-2" });
  });

  it("reads a ZRoute install command without running it", () => {
    const parsed = parseConfigSnippet("curl -fsSL 'https://dev.zroute.ai/install.sh' | bash -s -- 'zr_live_exampletoken'");
    expect(parsed).toEqual({
      baseUrl: "https://api-dev.zroute.ai/openai",
      apiKey: "zr_live_exampletoken",
    });
  });
  it("ignores environment variable references and shell substitutions", () => {
    const parsed = parseConfigSnippet('export OPENAI_API_KEY="$ZROUTE_KEY"\nmodel = "$(whoami)"');
    expect(parsed.apiKey).toBeUndefined();
    expect(parsed.modelId).toBeUndefined();
  });
});

describe("proxyBadge", () => {
  it("never reports Ready for an untested save", () => {
    expect(proxyBadge(undefined, false).label).toBe("Not configured");
    expect(proxyBadge({ status: "untested" } as never, false).label).toBe("Not tested");
    expect(proxyBadge({ status: "ready" } as never, true).label).toBe("Testing");
    expect(proxyBadge({ status: "ready" } as never, false).label).toBe("Ready");
    expect(proxyBadge({ status: "unavailable" } as never, false).label).toBe("Unavailable");
  });
});
