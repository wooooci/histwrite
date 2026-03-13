import { describe, expect, it } from "vitest";

import {
  decodeVendorUrlFromProxyUrl,
  normalizeVendorLandingLocation,
  resolveVendorLandingForHit,
  resolveVendorLandingViaRelay,
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

  it("resolves ddm hits through the relay-backed resolver by default", async () => {
    const hit = await resolveVendorLandingForHit(
      {
        title: "JSTOR",
        url: "https://ddm.dnd.lib.umich.edu/database/link/8235",
      },
      {
        resolveViaRelay: async (url) => {
          expect(url).toBe("https://ddm.dnd.lib.umich.edu/database/link/8235");
          return "http://www.jstor.org/";
        },
        fetchImpl: async () => {
          throw new Error("should not fetch");
        },
      },
    );

    expect(hit).toMatchObject({
      resolvedUrl: "http://www.jstor.org/",
    });
  });

  it("extracts the vendor landing url from relay/CDP current location snapshots", async () => {
    const sent: Array<{ method: string; sessionId?: string }> = [];
    const closed: string[] = [];
    const evaluated: string[] = [];

    const resolved = await resolveVendorLandingViaRelay("https://ddm.dnd.lib.umich.edu/database/link/46062", {
      connectCdpImpl: async () => ({
        ws: { close: () => undefined },
        cdp: {
          async send(method, params, sessionId) {
            sent.push({ method, sessionId });
            if (method === "Target.createTarget") return { targetId: "seed-target" };
            if (method === "Target.attachToTarget") {
              return { sessionId: sessionId ? sessionId : params?.targetId === "seed-target" ? "seed-session" : "redirect-session" };
            }
            if (method === "Page.enable" || method === "Runtime.enable" || method === "Page.navigate") return {};
            if (method === "Runtime.evaluate") {
              evaluated.push(String(sessionId ?? ""));
              if (sessionId === "seed-session") {
                return {
                  result: {
                    value:
                      "https://proxy.lib.umich.edu/login?qurl=http%3A%2F%2Ffind.galegroup.com%2Fmenu%2Fstart%3FuserGroupName%3Dumuser%26prod%3DWHIC",
                  },
                };
              }
              return { result: { value: "https://ddm.dnd.lib.umich.edu/database/link/46062" } };
            }
            if (method === "Target.closeTarget") {
              closed.push(String((params as { targetId?: string } | undefined)?.targetId ?? ""));
              return { success: true };
            }
            throw new Error(`unexpected method: ${method}`);
          },
        },
      }),
      sleepImpl: async () => undefined,
    });

    expect(resolved).toBe("http://find.galegroup.com/menu/start?userGroupName=umuser&prod=WHIC");
    expect(evaluated).toContain("seed-session");
    expect(closed).toContain("seed-target");
    expect(sent.map((item) => item.method)).toContain("Page.navigate");
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

  it("falls back to the original hit when relay navigation times out", async () => {
    const original = {
      title: "Slow Vendor",
      url: "https://ddm.dnd.lib.umich.edu/database/link/99999",
    };

    const hit = await resolveVendorLandingForHit(original, {
      resolveViaRelay: async () => {
        throw new Error("extension request timeout: Page.navigate");
      },
    });

    expect(hit).toEqual(original);
  });
});
