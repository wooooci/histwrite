import { describe, expect, it } from "vitest";

import {
  decodeVendorUrlFromProxyUrl,
  normalizeVendorLandingLocation,
  resolveVendorLandingForHit,
} from "./vendor-landing.js";

describe("platform vendor landing resolver", () => {
  it("decodes proxy qurl into the underlying vendor url", () => {
    expect(
      decodeVendorUrlFromProxyUrl("https://proxy.lib.umich.edu/login?qurl=https%3A%2F%2Fwww.proquest.com%2Fhvhistoryvault%3Faccountid%3D14667"),
    ).toBe("https://www.proquest.com/hvhistoryvault?accountid=14667");
    expect(
      decodeVendorUrlFromProxyUrl("https://proxy.lib.umich.edu/login?url=http%3A%2F%2Fwww.jstor.org%2F"),
    ).toBe("http://www.jstor.org/");
  });

  it("normalizes ddm redirect locations into vendor landing urls", () => {
    expect(
      normalizeVendorLandingLocation(
        "https://proxy.lib.umich.edu/login?qurl=http%3A%2F%2Ffind.galegroup.com%2Fmenu%2Fstart%3FuserGroupName%3Dumuser%26prod%3DWHIC",
      ),
    ).toBe("http://find.galegroup.com/menu/start?userGroupName=umuser&prod=WHIC");
    expect(normalizeVendorLandingLocation("http://catalog.hathitrust.org/")).toBe("http://catalog.hathitrust.org/");
    expect(
      normalizeVendorLandingLocation(
        "https://proxy.lib.umich.edu/login?qurl=https%3A%2F%2Flink.gale.com%2Fapps%2Fcollection%2F5888%2FGDSC%3Fu%3Dumuser%26amp%253Bsid%3DGDSC",
      ),
    ).toBe("https://link.gale.com/apps/collection/5888/GDSC?u=umuser&sid=GDSC");
  });

  it("resolves ddm hits by reading the first redirect without following it", async () => {
    const hit = await resolveVendorLandingForHit(
      {
        title: "JSTOR",
        url: "https://ddm.dnd.lib.umich.edu/database/link/8235",
      },
      {
        fetchImpl: async () =>
          new Response("", {
            status: 302,
            headers: {
              location: "https://proxy.lib.umich.edu/login?qurl=http%3A%2F%2Fwww.jstor.org%2F",
            },
          }),
      },
    );

    expect(hit).toMatchObject({
      resolvedUrl: "http://www.jstor.org/",
    });
  });

  it("keeps non-ddm hits untouched", async () => {
    const original = {
      title: "JSTOR",
      url: "https://www.jstor.org/",
    };
    const hit = await resolveVendorLandingForHit(original, {
      fetchImpl: async () => {
        throw new Error("should not fetch");
      },
    });

    expect(hit).toEqual(original);
  });
});
