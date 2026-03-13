import { describe, expect, it } from "vitest";

import { buildSearchClausesFromArgs } from "./hathitrust.js";
import {
  buildAdvancedSearchUrl,
  buildResultsPageUrl,
  isProquestAdvancedUrl,
  isProquestResultsUrl,
  parseDocIdFromDocview,
} from "./proquest.js";
import { parsePubDateFromAboutUrl } from "./gale.js";
import { parseTotalFromSummaryText } from "./adammatthew.js";

describe("platform scanner pure helpers", () => {
  it("extracts proquest doc ids from docview urls", () => {
    expect(
      parseDocIdFromDocview(
        "https://www.proquest.com/pqdtglobal/docview/3056029954/abstract/34B3C35A6D1B4F86PQ/1?accountid=14667",
      ),
    ).toBe("3056029954");
  });

  it("builds the live proquest advanced-search url", () => {
    expect(buildAdvancedSearchUrl("14667")).toBe("https://www.proquest.com/advanced?accountid=14667");
  });

  it("recognizes both proquest advanced-search routes", () => {
    expect(isProquestAdvancedUrl("https://www.proquest.com/advanced?accountid=14667")).toBe(true);
    expect(isProquestAdvancedUrl("https://www.proquest.com/pqdtglobal/advanced?accountid=14667")).toBe(
      true,
    );
  });

  it("rewrites proquest results pagination urls", () => {
    expect(
      buildResultsPageUrl(
        "https://www.proquest.com/results/AF0E71FF163C481BPQ/1?accountid=14667",
        4,
      ),
    ).toContain("/results/AF0E71FF163C481BPQ/4?");
  });

  it("recognizes both proquest results routes", () => {
    expect(isProquestResultsUrl("https://www.proquest.com/results/AF0E71FF163C481BPQ/1?accountid=14667")).toBe(
      true,
    );
    expect(
      isProquestResultsUrl("https://www.proquest.com/pqdtglobal/results/6D7D5BF7A6474F0APQ/1?accountid=14667"),
    ).toBe(true);
  });

  it("parses gale pubDate tokens from about urls", () => {
    expect(
      parsePubDateFromAboutUrl("https://go.gale.com/ps/i.do?id=GALE|ABC123&v=2.1&it=r&p=TTDA&sw=w&pubDate=119220614"),
    ).toBe("1922-06-14");
  });

  it("parses adam matthew total counts from bilingual summary text", () => {
    expect(parseTotalFromSummaryText("检索结果 Lippmann: 1 - 150 的 690")).toBe(690);
    expect(parseTotalFromSummaryText("Search results Lippmann: 1 - 150 of 690")).toBe(690);
  });

  it("builds hathitrust clauses from repeated args", () => {
    expect(
      buildSearchClausesFromArgs([
        "--term",
        "Walter Lippmann",
        "--field",
        "all",
        "--match",
        "phrase",
        "--term-2",
        "public opinion",
        "--field-2",
        "title",
        "--match-2",
        "all",
      ]),
    ).toEqual([
      { term: "Walter Lippmann", field: "all", match: "phrase" },
      { term: "public opinion", field: "title", match: "all" },
    ]);
  });
});
