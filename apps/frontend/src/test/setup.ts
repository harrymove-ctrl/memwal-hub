import * as matchers from "@testing-library/jest-dom/matchers";

import { cleanup } from "@testing-library/react";
import { afterEach, expect } from "vitest";

expect.extend(matchers);

/**
 * jsdom has no IntersectionObserver. `BlueprintReveal` (and anything else
 * built on `useInView`) needs one to mount at all, so this stub reports every
 * observed element as immediately intersecting — tests see the settled,
 * fully-revealed DOM rather than the entrance animation's initial frame.
 */
class IntersectionObserverStub implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = "";
  readonly scrollMargin = "";
  readonly thresholds: ReadonlyArray<number> = [];
  private readonly callback: IntersectionObserverCallback;

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
  }

  observe(target: Element) {
    this.callback(
      [{ isIntersecting: true, target } as IntersectionObserverEntry],
      this,
    );
  }
  unobserve() {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

globalThis.IntersectionObserver =
  IntersectionObserverStub as unknown as typeof IntersectionObserver;

afterEach(() => {
  cleanup();
});
