import { describe, expect, it } from "vitest";

import { chunkIntoBatches, selectNBest } from "./batch.js";

describe("infra batch", () => {
  it("chunks items into fixed-size batches", () => {
    expect(chunkIntoBatches([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("selects n-best with pass-first backfill", () => {
    const ranked = [
      { id: "c1", score: 0.9, pass: true },
      { id: "c2", score: 0.8, pass: false },
      { id: "c3", score: 0.7, pass: true },
      { id: "c4", score: 0.6, pass: false },
    ];

    expect(
      selectNBest({
        items: ranked,
        limit: 3,
        score: (item) => item.score,
        isPass: (item) => item.pass,
      }).map((item) => item.id),
    ).toEqual(["c1", "c3", "c2"]);
  });
});
