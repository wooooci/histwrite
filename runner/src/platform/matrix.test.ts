import { describe, expect, it } from "vitest";

import {
  backfillPlatformMatrixRowsFromCatalog,
  classifyUmichEntryKind,
  extractUmichHits,
  hydrateUmichHitsWithVendorLanding,
  matchGuideEntriesToUmichHits,
  renderPlatformMatrixTsv,
  resolvePlatformFromHostOrName,
} from "./matrix.js";
import { parseUmichCatalogCsv } from "./umich-csv.js";

describe("platform matrix builder", () => {
  it("classifies UMich directory URLs before matching", () => {
    expect(classifyUmichEntryKind({ url: "https://ddm.dnd.lib.umich.edu/database/link/9041" })).toBe(
      "umich_database_link",
    );
    expect(
      classifyUmichEntryKind({
        url: "https://proxy.lib.umich.edu/login?url=https://go.gale.com/ps/start.do?p=TTDA",
      }),
    ).toBe("umich_proxy_login");
    expect(classifyUmichEntryKind({ url: "https://search.lib.umich.edu/databases/record/12345" })).toBe("umich_search");
    expect(classifyUmichEntryKind({ url: "https://www.jstor.org/" })).toBe("direct_vendor");
  });

  it("resolves platform ids from either vendor host or hit name", () => {
    expect(resolvePlatformFromHostOrName({ host: "www.jstor.org" })).toBe("jstor");
    expect(resolvePlatformFromHostOrName({ host: "www-amexplorer-amdigital-co-uk.proxy.lib.umich.edu" })).toBe(
      "adammatthew",
    );
    expect(resolvePlatformFromHostOrName({ name: "历史与文化珍稀史料数据库集成 AMD" })).toBe("adammatthew");
    expect(resolvePlatformFromHostOrName({ name: "CNKI 中国知网" })).toBe("cnki");
    expect(resolvePlatformFromHostOrName({ name: "Electronic Archives of Greek and Latin Epigraphy (Egale)" })).toBe(
      "fallback",
    );
    expect(resolvePlatformFromHostOrName({ host: "example.com", name: "Unknown Database" })).toBe("fallback");
  });

  it("matches guide rows to UMich hits by direct name and then by resolved platform", () => {
    const rows = matchGuideEntriesToUmichHits(
      [
        { guideName: "JSTOR" },
        { guideName: "The Times Digital Archive" },
      ],
      [
        {
          name: "JSTOR",
          url: "https://www.jstor.org/",
        },
        {
          name: "University of Michigan database record 9041",
          url: "https://ddm.dnd.lib.umich.edu/database/link/9041",
          resolvedUrl: "https://go.gale.com/ps/start.do?p=TTDA&u=umuser",
        },
      ],
    );

    expect(rows[0]).toMatchObject({
      guideName: "JSTOR",
      umichHit: "JSTOR",
      landingHost: "www.jstor.org",
      platform: "jstor",
    });
    expect(rows[1]).toMatchObject({
      guideName: "The Times Digital Archive",
      umichHit: "University of Michigan database record 9041",
      landingHost: "go.gale.com",
      platform: "gale",
    });
  });

  it("avoids forcing weak title overlaps into false-positive matches", () => {
    const rows = matchGuideEntriesToUmichHits(
      [
        { guideName: "17th and 18th Century Burney Collection Newspapers" },
        { guideName: "Academic Research Library, ProQuest Research Library (PRL)" },
        { guideName: "Aden: Records of the U.S. Department of State, 1880-1906" },
      ],
      [
        {
          title: "Chinese Newspapers Collection, 1832-1953",
          url: "https://ddm.dnd.lib.umich.edu/database/link/30728",
        },
        {
          title: "ProQuest Historical Newspapers",
          url: "https://ddm.dnd.lib.umich.edu/database/link/9371",
        },
        {
          title: "Argentina: Records of the U.S. Department of State, 1960-1963",
          url: "https://ddm.dnd.lib.umich.edu/database/link/45391",
        },
      ],
    );

    expect(rows).toMatchObject([
      {
        guideName: "17th and 18th Century Burney Collection Newspapers",
        umichHit: null,
        status: "manual_required",
      },
      {
        guideName: "Academic Research Library, ProQuest Research Library (PRL)",
        umichHit: null,
        status: "manual_required",
      },
      {
        guideName: "Aden: Records of the U.S. Department of State, 1880-1906",
        umichHit: null,
        status: "manual_required",
      },
    ]);
  });

  it("flattens UMich raw discipline buckets and deduplicates repeated record ids", () => {
    const hits = extractUmichHits({
      scrapedAt: "2026-02-07T12:48:47.614Z",
      disciplines: [
        {
          discipline: "History (General)",
          rows: [
            {
              recordId: "9371",
              title: "ProQuest Historical Newspapers",
              permalink: "https://ddm.dnd.lib.umich.edu/database/link/9371",
              recordUrl: "https://search.lib.umich.edu/databases/record/9371",
            },
          ],
        },
        {
          discipline: "United States History",
          rows: [
            {
              recordId: "9371",
              title: "ProQuest Historical Newspapers",
              permalink: "https://ddm.dnd.lib.umich.edu/database/link/9371",
              recordUrl: "https://search.lib.umich.edu/databases/record/9371",
            },
            {
              recordId: "9041",
              title: "JSTOR",
              permalink: "https://ddm.dnd.lib.umich.edu/database/link/9041",
              recordUrl: "https://search.lib.umich.edu/databases/record/9041",
            },
          ],
        },
      ],
    });

    expect(hits).toHaveLength(2);
    expect(hits).toMatchObject([
      {
        title: "ProQuest Historical Newspapers",
        url: "https://ddm.dnd.lib.umich.edu/database/link/9371",
      },
      {
        title: "JSTOR",
        url: "https://ddm.dnd.lib.umich.edu/database/link/9041",
      },
    ]);
  });

  it("hydrates ddm permalink hits into vendor landing hosts before platform matching", async () => {
    const hits = await hydrateUmichHitsWithVendorLanding(
      [
        {
          title: "World History in Context",
          url: "https://ddm.dnd.lib.umich.edu/database/link/46062",
        },
      ],
      {
        resolveViaRelay: async () =>
          "https://proxy.lib.umich.edu/login?qurl=http%3A%2F%2Ffind.galegroup.com%2Fmenu%2Fstart%3FuserGroupName%3Dumuser%26prod%3DWHIC",
      },
    );

    const rows = matchGuideEntriesToUmichHits([{ guideName: "Gale in Context: World History" }], hits);
    expect(rows[0]).toMatchObject({
      umichHit: "World History in Context",
      landingHost: "find.galegroup.com",
      platform: "gale",
      status: "planned",
    });
  });

  it("backfills manual rows from richer UMich csv catalog rows", async () => {
    const baseRows = matchGuideEntriesToUmichHits([{ guideName: "ProQuest Research Library (PRL)" }], []);
    const csvRows = parseUmichCatalogCsv(`title,platform,vendor_hint,company_guess,ddm_link,access_type
"ProQuest Research Library","ProQuest",,"ProQuest (Clarivate)","https://ddm.dnd.lib.umich.edu/database/link/9851","Authorized U-M users (+ guests in U-M Libraries)"
`);

    const rows = await backfillPlatformMatrixRowsFromCatalog(baseRows, csvRows, {
      resolveHit: async (hit) => ({
        ...hit,
        resolvedUrl: "https://www.proquest.com/advanced?accountid=14667",
      }),
    });

    expect(rows[0]).toMatchObject({
      guideName: "ProQuest Research Library (PRL)",
      umichHit: "ProQuest Research Library",
      landingHost: "www.proquest.com",
      platform: "proquest",
      status: "planned",
    });
  });

  it("renders matrix rows as TSV with a stable header", () => {
    const tsv = renderPlatformMatrixTsv([
      {
        guideName: "JSTOR",
        guideCode: null,
        umichHit: "JSTOR",
        landingUrl: "https://www.jstor.org/",
        landingHost: "www.jstor.org",
        platform: "jstor",
        downloadMode: "record_then_pdf",
        status: "planned",
        notes: null,
      },
    ]);

    expect(tsv).toContain(
      "guideName\tguideCode\tumichHit\tlandingUrl\tlandingHost\tplatform\tdownloadMode\tstatus\tnotes",
    );
    expect(tsv).toContain("JSTOR\t\tJSTOR\thttps://www.jstor.org/\twww.jstor.org\tjstor\trecord_then_pdf\tplanned\t");
  });
});
