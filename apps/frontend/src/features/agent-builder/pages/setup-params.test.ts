import { describe, expect, it } from "vitest";

import { canonicalSetupPath, paramsAfterClose, setupTarget } from "./setup-params";

describe("setupTarget", () => {
  it("uses connect as the canonical parameter", () => {
    expect(setupTarget(new URLSearchParams("connect=model"))).toBe("model");
    expect(setupTarget(new URLSearchParams("connect=memory"))).toBe("memory");
    expect(canonicalSetupPath("memory")).toBe("/builder/integrations?connect=memory");
  });

  it("accepts the older setup alias only when connect does not name a dialog", () => {
    expect(setupTarget(new URLSearchParams("setup=model"))).toBe("model");
    expect(setupTarget(new URLSearchParams("setup=memory"))).toBe("memory");
    expect(setupTarget(new URLSearchParams("connect=model&setup=memory"))).toBe("model");
    expect(setupTarget(new URLSearchParams("connect=memory&setup=model"))).toBe("memory");
    expect(setupTarget(new URLSearchParams("connect=other&setup=memory"))).toBe("memory");
  });

  it("ignores unknown values", () => {
    expect(setupTarget(new URLSearchParams("setup=github"))).toBeNull();
    expect(setupTarget(new URLSearchParams("project=abc"))).toBeNull();
  });
});

describe("paramsAfterClose", () => {
  it("removes only the consumed model params and keeps project and return paths", () => {
    const next = paramsAfterClose(
      new URLSearchParams("connect=model&setup=model&project=abc&returnTo=%2Fbuilder%2Fchat"),
      "model",
    );
    expect(next.get("connect")).toBeNull();
    expect(next.get("setup")).toBeNull();
    expect(next.get("project")).toBe("abc");
    expect(next.get("returnTo")).toBe("/builder/chat");
  });

  it("does not delete an unused alias or an unsupported value", () => {
    const next = paramsAfterClose(new URLSearchParams("connect=model&setup=memory&setupExtra=1"), "model");
    expect(next.toString()).toContain("setup=memory");
    expect(next.get("connect")).toBeNull();

    const other = paramsAfterClose(new URLSearchParams("connect=other&setup=github&project=abc"), "memory");
    expect(other.get("connect")).toBe("other");
    expect(other.get("setup")).toBe("github");
    expect(other.get("project")).toBe("abc");
  });
});
