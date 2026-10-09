import { describe, expect, it } from "vitest";

import { fitViewport } from "./Canvas";

describe("fitViewport", () => {
  it("centers a wide canvas and zooms out to the smaller axis", () => {
    const fitted = fitViewport(
      [
        { x: 0, y: 0, width: 400, height: 80 },
        { x: 500, y: 200, width: 300, height: 120 },
      ],
      { width: 400, height: 300 },
      { min: 0.2, max: 2, pad: 20 },
    );
    expect(fitted).not.toBeNull();
    expect(fitted!.zoom).toBeLessThan(1);
    expect(fitted!.zoom).toBeGreaterThan(0);
    const right = 800 * fitted!.zoom + fitted!.x;
    const bottom = 320 * fitted!.zoom + fitted!.y;
    expect(right).toBeLessThanOrEqual(400);
    expect(bottom).toBeLessThanOrEqual(300);
  });

  it("returns null for an empty or zero-size viewport", () => {
    expect(fitViewport([], { width: 800, height: 600 })).toBeNull();
    expect(fitViewport([{ x: 0, y: 0, width: 10, height: 10 }], { width: 0, height: 400 })).toBeNull();
  });
});
