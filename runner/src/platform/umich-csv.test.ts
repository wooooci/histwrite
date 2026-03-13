import { describe, expect, it } from "vitest";

import { parseUmichCatalogCsv, resolveCatalogPlatformHint } from "./umich-csv.js";

describe("umich richer catalog csv", () => {
  it("parses quoted multiline description rows into structured entries", () => {
    const entries = parseUmichCatalogCsv(`title,platform,vendor_hint,company_guess,ddm_link,access_type,description
"HathiTrust Digital Library",,,,"https://ddm.dnd.lib.umich.edu/database/link/10197","Open access for all users","Line 1
Line 2"
"ProQuest Research Library","ProQuest",,"ProQuest (Clarivate)","https://ddm.dnd.lib.umich.edu/database/link/9851","Authorized U-M users (+ guests in U-M Libraries)","Structured abstract"
`);

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      title: "HathiTrust Digital Library",
      ddmLink: "https://ddm.dnd.lib.umich.edu/database/link/10197",
      accessType: "Open access for all users",
      description: "Line 1\nLine 2",
    });
    expect(entries[1]).toMatchObject({
      title: "ProQuest Research Library",
      platformLabel: "ProQuest",
      companyGuess: "ProQuest (Clarivate)",
    });
  });

  it("maps platform and vendor hints onto the known platform ids", () => {
    const entries = parseUmichCatalogCsv(`title,platform,vendor_hint,company_guess,ddm_link,access_type
"HathiTrust Digital Library",,,,"https://ddm.dnd.lib.umich.edu/database/link/10197","Open access for all users"
"American Jewish Newspapers","ProQuest Historical Newspapers",,"ProQuest (Clarivate)","https://ddm.dnd.lib.umich.edu/database/link/31379","Authorized U-M users (+ guests in U-M Libraries)"
"Age of Exploration","Adam Matthew Digital",,"Adam Matthew Digital (SAGE)","https://ddm.dnd.lib.umich.edu/database/link/48000","Authorized U-M users (+ guests in U-M Libraries)"
`);

    expect(resolveCatalogPlatformHint(entries[0])).toBe("hathitrust");
    expect(resolveCatalogPlatformHint(entries[1])).toBe("proquest");
    expect(resolveCatalogPlatformHint(entries[2])).toBe("adammatthew");
  });
});
