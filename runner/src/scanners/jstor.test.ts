import { describe, expect, it } from "vitest";

import {
  buildAdvancedSearchUrl,
  buildItemsFromResultBlocks,
  isJstorResultsReadySnapshot,
  parseJstorTotalText,
  slugify,
  toMarkdownDigest,
} from "./jstor.js";

describe("jstor scanner helpers", () => {
  it("builds a JSTOR advanced search URL with q0/q1 and filters", () => {
    const url = buildAdvancedSearchUrl({
      origin: "https://www-jstor-org.proxy.lib.umich.edu",
      baseTerm: "Walter Lippmann",
      term2: "public opinion",
      dateFrom: "1910",
      dateTo: "1930",
      accessibleOnly: true,
      lang: "eng",
      sort: "rel",
    });

    expect(url).toContain("/action/doAdvancedSearch");
    expect(url).toContain("q0=Walter+Lippmann");
    expect(url).toContain("q1=public+opinion");
    expect(url).toContain("sd=1910");
    expect(url).toContain("ed=1930");
    expect(url).toContain("acc=on");
  });

  it("slugifies query labels for deterministic filenames", () => {
    expect(slugify("Walter Lippmann / Public Opinion")).toBe("walter_lippmann_public_opinion");
  });

  it("renders a readable markdown digest from extracted results", () => {
    const markdown = toMarkdownDigest({
      baseTerm: "Walter Lippmann",
      dateFrom: "1910",
      dateTo: "1930",
      origin: "https://www-jstor-org.proxy.lib.umich.edu",
      accessibleOnly: true,
      queries: [
        {
          key: "public_opinion",
          term_2: "public opinion",
          date_from: "1910",
          date_to: "1930",
          total_results: 42,
          current_url: "https://www-jstor-org.proxy.lib.umich.edu/action/doAdvancedSearch?foo=bar",
          items: [
            {
              title: "Public Opinion and Propaganda",
              authors: "Walter Lippmann",
              source: "Political Science Quarterly",
              content_type: "Article",
              stable_id: "123456",
              doi: "10.2307/123456",
              url: "https://www-jstor-org.proxy.lib.umich.edu/stable/123456",
            },
          ],
        },
      ],
    });

    expect(markdown).toContain("# JSTOR 高级检索候选");
    expect(markdown).toContain("Walter Lippmann");
    expect(markdown).toContain("命中总量：42");
    expect(markdown).toContain("Public Opinion and Propaganda");
    expect(markdown).toContain("Stable：123456；DOI：10.2307/123456");
  });

  it("builds rows from shadow-host result blocks and de-dupes by stable id", () => {
    const items = buildItemsFromResultBlocks([
      {
        titleText: "From Public Opinion to Public Philosophy: Walter Lippmann's Classic Reexamined",
        stableHref:
          "https://www-jstor-org.proxy.lib.umich.edu/stable/3484293?searchText=((Walter%20Lippmann)%20AND%20(public%20opinion))",
        authorsText: "Heinz Eulau",
        sourceText:
          "The American Journal of Economics and Sociology, Vol. 15, No. 4 (Jul., 1956), pp. 439-451",
        contentTypeText: "Journal Article",
        containerText:
          "From Public Opinion to Public Philosophy: Walter Lippmann's Classic Reexamined Heinz Eulau The American Journal of Economics and Sociology, Vol. 15, No. 4 (Jul., 1956), pp. 439-451",
      },
      {
        titleText: "From Public Opinion",
        stableHref:
          "https://www-jstor-org.proxy.lib.umich.edu/stable/3484293?searchText=((Walter%20Lippmann)%20AND%20(public%20opinion))",
        authorsText: "",
        sourceText: "",
        contentTypeText: "",
        containerText: "duplicate block",
      },
    ]);

    expect(items).toEqual([
      {
        title: "From Public Opinion to Public Philosophy: Walter Lippmann's Classic Reexamined",
        authors: "Heinz Eulau",
        source:
          "The American Journal of Economics and Sociology, Vol. 15, No. 4 (Jul., 1956), pp. 439-451",
        content_type: "Journal Article",
        stable_id: "3484293",
        doi: "",
        url:
          "https://www-jstor-org.proxy.lib.umich.edu/stable/3484293?searchText=((Walter%20Lippmann)%20AND%20(public%20opinion))",
      },
    ]);
  });

  it("parses JSTOR result totals without falling through to unrelated years", () => {
    expect(
      parseJstorTotalText(
        "Search results for ((Walter Lippmann) AND (public opinion)) AND la:(eng OR en) 5,400 results 2026",
      ),
    ).toBe(5400);
    expect(
      parseJstorTotalText(
        "The Public Opinion Quarterly, Vol. 22, No. 2 (Summer, 1958), pp. 91-106",
      ),
    ).toBeNull();
  });

  it("treats result-item/title-host counts as the ready signal", () => {
    expect(isJstorResultsReadySnapshot({ itemCount: 0, titleHostCount: 0, no: false })).toBe(false);
    expect(isJstorResultsReadySnapshot({ itemCount: 2, titleHostCount: 0, no: false })).toBe(true);
    expect(isJstorResultsReadySnapshot({ itemCount: 0, titleHostCount: 3, no: false })).toBe(true);
    expect(isJstorResultsReadySnapshot({ itemCount: 0, titleHostCount: 0, no: true })).toBe(true);
  });
});
