import { describe, expect, it } from "vitest";

import { parsePlatformMatrixRow } from "./contract.js";

describe("platform matrix contract", () => {
  it("parses a minimal planned ProQuest row", () => {
    expect(
      parsePlatformMatrixRow({
        guideName: "ProQuest Dissertations & Theses Global",
        umichHit: "ProQuest Dissertations & Theses Global",
        landingUrl: "https://www.proquest.com/pqdtglobal/",
        landingHost: "www.proquest.com",
        platform: "proquest",
        downloadMode: "record_then_pdf",
        status: "planned",
      }),
    ).toMatchObject({
      guideName: "ProQuest Dissertations & Theses Global",
      umichHit: "ProQuest Dissertations & Theses Global",
      landingUrl: "https://www.proquest.com/pqdtglobal/",
      landingHost: "www.proquest.com",
      platform: "proquest",
      downloadMode: "record_then_pdf",
      status: "planned",
      guideCode: null,
      notes: null,
    });
  });

  it("rejects rows whose platform is outside the frozen contract", () => {
    expect(() =>
      parsePlatformMatrixRow({
        guideName: "Unknown",
        umichHit: "Unknown",
        landingUrl: "https://example.com/db",
        landingHost: "example.com",
        platform: "unknown",
        downloadMode: "manual_only",
        status: "blocked",
      }),
    ).toThrow(/platform/i);
  });
});
