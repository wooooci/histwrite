import { describe, expect, it } from "vitest";

import { cacheKey, stableJsonStringify } from "./cache.js";

describe("cache", () => {
  it("stableJsonStringify sorts object keys recursively", () => {
    const a = stableJsonStringify({ b: 1, a: { d: 2, c: 3 } });
    const b = stableJsonStringify({ a: { c: 3, d: 2 }, b: 1 });
    expect(a).toBe(b);
  });

  it("cacheKey is stable across input key order changes", () => {
    const k1 = cacheKey({
      taskName: "cache_test",
      model: "gpt-5.2",
      promptVersion: "v1",
      inputs: { b: 1, a: { d: 2, c: 3 } },
    });
    const k2 = cacheKey({
      taskName: "cache_test",
      model: "gpt-5.2",
      promptVersion: "v1",
      inputs: { a: { c: 3, d: 2 }, b: 1 },
    });
    expect(k1).toBe(k2);
  });
});
