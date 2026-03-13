import { describe, expect, it } from "vitest";

import type { PlatformMatrixRow } from "./contract.js";
import {
  classifyPlatformResolutionRows,
  renderPlatformResolutionClassificationMarkdown,
  renderPlatformResolutionClassificationTsv,
} from "./classification.js";
import { parseUmichCatalogCsv } from "./umich-csv.js";

function row(input: Partial<PlatformMatrixRow> & Pick<PlatformMatrixRow, "guideName" | "platform" | "downloadMode" | "status">): PlatformMatrixRow {
  return {
    guideName: input.guideName,
    guideCode: input.guideCode ?? null,
    umichHit: input.umichHit ?? null,
    landingUrl: input.landingUrl ?? null,
    landingHost: input.landingHost ?? null,
    platform: input.platform,
    downloadMode: input.downloadMode,
    status: input.status,
    notes: input.notes ?? null,
  };
}

describe("platform resolution classification", () => {
  it("separates suspicious planned matches from high-confidence ones", () => {
    const rows = classifyPlatformResolutionRows(
      [
        row({
          guideName: "NATO",
          umichHit: "Rise and Fall of Senator Joseph R. McCarthy",
          landingHost: "link.gale.com",
          landingUrl: "https://link.gale.com/apps/doc/CX123",
          platform: "gale",
          downloadMode: "page_range_dialog",
          status: "planned",
        }),
        row({
          guideName: "JSTOR",
          umichHit: "JSTOR",
          landingHost: "www.jstor.org",
          landingUrl: "https://www.jstor.org/",
          platform: "jstor",
          downloadMode: "record_then_pdf",
          status: "planned",
        }),
      ],
      [],
    );

    expect(rows[0]).toMatchObject({
      category: "matched_needs_review",
      reviewReasons: ["low_name_overlap"],
    });
    expect(rows[1]).toMatchObject({
      category: "matched_high_confidence",
      reviewReasons: [],
    });
  });

  it("routes manual rows with open access catalog matches into the public queue", () => {
    const csvRows = parseUmichCatalogCsv(`title,platform,vendor_hint,company_guess,ddm_link,access_type
"HathiTrust Digital Library",,,,"https://ddm.dnd.lib.umich.edu/database/link/10197","Open access for all users"
`);
    const rows = classifyPlatformResolutionRows(
      [
        row({
          guideName: "HathiTrust Digital Library",
          platform: "fallback",
          downloadMode: "manual_only",
          status: "manual_required",
        }),
      ],
      csvRows,
    );

    expect(rows[0]).toMatchObject({
      category: "public_open_access",
      nextAction: "public_resolver",
      csvTitle: "HathiTrust Digital Library",
      csvDdmLink: "https://ddm.dnd.lib.umich.edu/database/link/10197",
    });
  });

  it("keeps high-confidence matched open-access rows in the public queue", () => {
    const csvRows = parseUmichCatalogCsv(`title,platform,vendor_hint,company_guess,ddm_link,access_type
"HathiTrust Digital Library",,,,"https://ddm.dnd.lib.umich.edu/database/link/10197","Open access for all users"
`);
    const rows = classifyPlatformResolutionRows(
      [
        row({
          guideName: "HathiTrust Digital Library",
          umichHit: "HathiTrust Digital Library",
          landingHost: "catalog.hathitrust.org",
          landingUrl: "http://catalog.hathitrust.org/",
          platform: "hathitrust",
          downloadMode: "direct_pdf",
          status: "planned",
        }),
      ],
      csvRows,
    );

    expect(rows[0]).toMatchObject({
      category: "public_open_access",
      nextAction: "public_resolver",
      reviewReasons: ["catalog_open_access"],
    });
  });

  it("routes manual rows with vendor hints into the csv enrichment queue", () => {
    const csvRows = parseUmichCatalogCsv(`title,platform,vendor_hint,company_guess,ddm_link,access_type
"ProQuest Research Library","ProQuest",,"ProQuest (Clarivate)","https://ddm.dnd.lib.umich.edu/database/link/9851","Authorized U-M users (+ guests in U-M Libraries)"
`);
    const rows = classifyPlatformResolutionRows(
      [
        row({
          guideName: "ProQuest Research Library (PRL)",
          platform: "fallback",
          downloadMode: "manual_only",
          status: "manual_required",
        }),
      ],
      csvRows,
    );

    expect(rows[0]).toMatchObject({
      category: "csv_vendor_hint",
      nextAction: "reuse_catalog_ddm_link",
      csvPlatformHint: "proquest",
      csvDdmLink: "https://ddm.dnd.lib.umich.edu/database/link/9851",
    });
  });

  it("leaves unmatched manual rows in the umich direct-search queue", () => {
    const rows = classifyPlatformResolutionRows(
      [
        row({
          guideName: "Web of Science",
          platform: "fallback",
          downloadMode: "manual_only",
          status: "manual_required",
        }),
      ],
      [],
    );

    expect(rows[0]).toMatchObject({
      category: "umich_direct_search",
      nextAction: "run_umich_database_search",
    });
  });

  it("renders classification artifacts with stable headers and sections", () => {
    const classified = classifyPlatformResolutionRows(
      [
        row({
          guideName: "HathiTrust Digital Library",
          platform: "fallback",
          downloadMode: "manual_only",
          status: "manual_required",
        }),
      ],
      parseUmichCatalogCsv(`title,platform,vendor_hint,company_guess,ddm_link,access_type
"HathiTrust Digital Library",,,,"https://ddm.dnd.lib.umich.edu/database/link/10197","Open access for all users"
`),
    );

    const tsv = renderPlatformResolutionClassificationTsv(classified);
    const md = renderPlatformResolutionClassificationMarkdown(classified);

    expect(tsv).toContain("category\tnextAction\tguideName\tguideCode\tplatform\tstatus");
    expect(tsv).toContain("public_open_access\tpublic_resolver\tHathiTrust Digital Library");
    expect(md).toContain("# UMich Platform Resolution Classification");
    expect(md).toContain("public_open_access");
  });
});
