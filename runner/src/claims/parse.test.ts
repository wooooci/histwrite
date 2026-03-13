import { describe, expect, it } from "vitest";

import { ClaimAnchorParseError } from "./parse.js";
import { parseClaimAnchors } from "./parse.js";

describe("parseClaimAnchors", () => {
  it("parses a normal claim anchor with kind, evidence refs, and span text", () => {
    const draft = "引言。〔claim:c1|kind=causal|ev=card_m1:e0,card_m2:e1〕这是一条\n可核查断言。〔/claim〕尾句。";

    const out = parseClaimAnchors(draft);

    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      claimId: "c1",
      kind: "causal",
      spanText: "这是一条\n可核查断言。",
      evidenceRefs: [
        { cardId: "card_m1", evidenceId: "e0" },
        { cardId: "card_m2", evidenceId: "e1" },
      ],
    });
    expect(out[0]?.openTag).toBe("〔claim:c1|kind=causal|ev=card_m1:e0,card_m2:e1〕");
    expect(out[0]?.closeTag).toBe("〔/claim〕");
  });

  it("throws an error with line/column when a claim is not closed", () => {
    const draft = ["第一段。", "〔claim:c2|kind=quote|ev=card_m3:e0〕未闭合 claim"].join("\n");

    try {
      parseClaimAnchors(draft);
      expect.unreachable("expected parseClaimAnchors to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ClaimAnchorParseError);
      const parsed = error as ClaimAnchorParseError;
      expect(parsed.code).toBe("unclosed_claim");
      expect(parsed.line).toBe(2);
      expect(parsed.column).toBe(1);
      expect(parsed.message).toContain("unclosed");
    }
  });

  it("throws an error when claim anchors are nested", () => {
    const draft = "〔claim:c1|kind=entity|ev=card_m1:e0〕外层〔claim:c2|kind=date|ev=card_m2:e0〕内层〔/claim〕〔/claim〕";

    try {
      parseClaimAnchors(draft);
      expect.unreachable("expected parseClaimAnchors to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ClaimAnchorParseError);
      const parsed = error as ClaimAnchorParseError;
      expect(parsed.code).toBe("nested_claim");
      expect(parsed.message).toContain("nested");
      expect(parsed.offset).toBeGreaterThan(0);
    }
  });
});

