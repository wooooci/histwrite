import { describe, expect, it } from "vitest";

import { normalizeGuideName, normalizeOcrArtifacts, splitMergedGuideEntries } from "./guide-cleaning.js";

describe("platform guide cleaning", () => {
  it("normalizes known OCR artifacts before later matching", () => {
    expect(normalizeOcrArtifacts("JSTORꎬ Inc􀆰 and Walter􀆳s archive")).toBe("JSTOR, Inc. and Walter's archive");
  });

  it("normalizes guide names by collapsing punctuation and whitespace", () => {
    expect(normalizeGuideName("  ProQuest   Dissertations  & Theses  Global.  ")).toBe(
      "proquest dissertations theses global",
    );
  });

  it("splits merged appendix rows by repeated database codes", () => {
    expect(
      splitMergedGuideEntries([
        {
          raw: "K712 19th Century British Library Newspapers E155 The Times Digital Archive",
        },
      ]),
    ).toMatchObject([
      { guideCode: "K712", guideName: "19th Century British Library Newspapers" },
      { guideCode: "E155", guideName: "The Times Digital Archive" },
    ]);
  });

  it("keeps a single slash code intact instead of splitting it into empty guide rows", () => {
    const rows = splitMergedGuideEntries([
      {
        raw: "19th Century U􀆰S􀆰 Newspapersꎬ K712/D01",
      },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      guideCode: "K712/D01",
    });
    expect(rows[0]?.guideName).toContain("19th Century U.S. Newspapers");
  });

  it("splits true merged appendix rows by full slash codes and preserves non-empty names", () => {
    const rows = splitMergedGuideEntries([
      {
        raw: "African Americaꎬ Communistsꎬ and the National Negro Congressꎬ 1933-1947ꎬ K712/ E155 African American Communitiesꎬ 1863-1986ꎬ K712/E137",
      },
    ]);

    expect(rows).toHaveLength(2);
    expect(rows).toMatchObject([
      {
        guideCode: "K712/E155",
      },
      {
        guideCode: "K712/E137",
      },
    ]);
    expect(rows.every((row) => String(row.guideName ?? "").trim() !== "")).toBe(true);
    expect(rows[0]?.guideName).toContain("African America");
    expect(rows[1]?.guideName).toContain("African American Communities");
  });
});
