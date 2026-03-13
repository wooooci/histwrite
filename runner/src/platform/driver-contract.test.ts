import { describe, expect, it } from "vitest";

import { unsupportedDownloadResult } from "./driver-contract.js";

describe("platform driver contract", () => {
  it("returns a structured manual_required result for unsupported download modes", () => {
    expect(unsupportedDownloadResult("fallback")).toEqual({
      ok: false,
      kind: "fallback",
      status: "manual_required",
      reason: "unsupported_download_mode",
    });
  });
});
