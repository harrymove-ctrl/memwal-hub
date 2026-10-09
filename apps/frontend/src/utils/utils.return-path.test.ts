import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  clearStoredReturnPath,
  getStoredReturnPath,
  resolveReturnPath,
  setStoredReturnPath,
  validateReturnPath,
} from "./utils.return-path";

describe("validateReturnPath", () => {
  it("accepts valid same-origin relative paths starting with a single '/'", () => {
    expect(validateReturnPath("/")).toBe("/");
    expect(validateReturnPath("/builder/integrations")).toBe("/builder/integrations");
    expect(validateReturnPath("/builder/integrations?connect=model")).toBe("/builder/integrations?connect=model");
    expect(validateReturnPath("/builder/chat?project=4116c45e-2828-4fcb-9d10-a9a1083cd2ad")).toBe(
      "/builder/chat?project=4116c45e-2828-4fcb-9d10-a9a1083cd2ad",
    );
    expect(validateReturnPath("/agents")).toBe("/agents");
    expect(validateReturnPath("/tools/gateway?node=gw")).toBe("/tools/gateway?node=gw");
  });

  it("rejects protocol-relative URLs starting with '//'", () => {
    expect(validateReturnPath("//evil.com")).toBeNull();
    expect(validateReturnPath("//attacker.example/path")).toBeNull();
    expect(validateReturnPath("//")).toBeNull();
    expect(validateReturnPath("///evil.com")).toBeNull();
  });

  it("rejects schemes such as https, http, and javascript", () => {
    expect(validateReturnPath("https://x")).toBeNull();
    expect(validateReturnPath("http://evil.com")).toBeNull();
    expect(validateReturnPath("javascript:")).toBeNull();
    expect(validateReturnPath("javascript:alert(1)")).toBeNull();
    expect(validateReturnPath("data:text/html,test")).toBeNull();
    expect(validateReturnPath("mailto:test@example.com")).toBeNull();
  });

  it("rejects backslashes and backslash variations", () => {
    expect(validateReturnPath("/\\evil")).toBeNull();
    expect(validateReturnPath("/\\\\evil")).toBeNull();
    expect(validateReturnPath("/foo\\bar")).toBeNull();
    expect(validateReturnPath("\\evil.com")).toBeNull();
  });

  it("rejects encoded variants designed to bypass simple checks", () => {
    expect(validateReturnPath("/%2f/evil.com")).toBeNull();
    expect(validateReturnPath("/%5cevil")).toBeNull();
    expect(validateReturnPath("/%5C%5Cevil")).toBeNull();
    expect(validateReturnPath("/%252f%252fevil.com")).toBeNull();
    expect(validateReturnPath("/%00evil")).toBeNull();
    expect(validateReturnPath("/%0d%0aevil")).toBeNull();
  });

  it("rejects empty, non-string, or malformed values", () => {
    expect(validateReturnPath("")).toBeNull();
    expect(validateReturnPath("   ")).toBeNull();
    expect(validateReturnPath(null)).toBeNull();
    expect(validateReturnPath(undefined)).toBeNull();
    expect(validateReturnPath(123)).toBeNull();
    expect(validateReturnPath({})).toBeNull();
    expect(validateReturnPath("relative/without/slash")).toBeNull();
  });
});

describe("return path session storage", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  afterEach(() => {
    window.sessionStorage.clear();
  });

  it("stores and retrieves a valid return path across calls", () => {
    expect(getStoredReturnPath()).toBeNull();
    setStoredReturnPath("/builder/integrations?connect=model");
    expect(getStoredReturnPath()).toBe("/builder/integrations?connect=model");
    clearStoredReturnPath();
    expect(getStoredReturnPath()).toBeNull();
  });

  it("ignores attempts to store invalid or dangerous paths", () => {
    setStoredReturnPath("//evil.com");
    expect(getStoredReturnPath()).toBeNull();

    setStoredReturnPath("https://x");
    expect(getStoredReturnPath()).toBeNull();

    setStoredReturnPath("/\\evil");
    expect(getStoredReturnPath()).toBeNull();
  });

  it("resolves from searchParams when provided or falls back to storage", () => {
    const params = new URLSearchParams("returnTo=%2Fbuilder%2Fchat%3Fproject%3D123");
    expect(resolveReturnPath(params)).toBe("/builder/chat?project=123");

    const evilParams = new URLSearchParams("returnTo=%2F%2Fevil.com");
    setStoredReturnPath("/builder/integrations");
    expect(resolveReturnPath(evilParams)).toBe("/builder/integrations");
  });
});
