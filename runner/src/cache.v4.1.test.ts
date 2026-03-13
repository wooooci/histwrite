import { describe, expect, it } from "vitest";

import { cacheKey } from "./cache.js";

describe("cache v4.1", () => {
  it("includes taskName in the content-addressed key", () => {
    const judgeKey = cacheKey({
      taskName: "judge_best_of_k",
      model: "gpt-5.2",
      promptVersion: "v1",
      inputs: { topic: "晚清财政" },
    });
    const rewriteKey = cacheKey({
      taskName: "rewrite_markdown",
      model: "gpt-5.2",
      promptVersion: "v1",
      inputs: { topic: "晚清财政" },
    });

    expect(judgeKey).not.toBe(rewriteKey);
  });

  it("stays stable across input key order changes while still separating model ids", () => {
    const k1 = cacheKey({
      taskName: "rewrite_markdown",
      model: "gpt-5.2",
      promptVersion: "v1",
      inputs: { b: 1, a: { d: 2, c: 3 } },
    });
    const k2 = cacheKey({
      taskName: "rewrite_markdown",
      model: "gpt-5.2",
      promptVersion: "v1",
      inputs: { a: { c: 3, d: 2 }, b: 1 },
    });
    const k3 = cacheKey({
      taskName: "rewrite_markdown",
      model: "gpt-5.4",
      promptVersion: "v1",
      inputs: { a: { c: 3, d: 2 }, b: 1 },
    });

    expect(k1).toBe(k2);
    expect(k1).not.toBe(k3);
  });
});
