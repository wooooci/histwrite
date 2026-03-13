import { describe, expect, it, vi } from "vitest";

import { resolvePlatformDriver } from "./registry.js";
import { parsePlatformMatrixRow } from "./contract.js";

describe("platform driver registry", () => {
  it("routes supported platform/download-mode pairs to the expected driver kind", () => {
    expect(resolvePlatformDriver({ platform: "gale", downloadMode: "page_range_dialog" })).toMatchObject({ kind: "gale" });
    expect(resolvePlatformDriver({ platform: "proquest", downloadMode: "record_then_pdf" })).toMatchObject({ kind: "proquest" });
    expect(resolvePlatformDriver({ platform: "jstor", downloadMode: "record_then_pdf" })).toMatchObject({ kind: "jstor" });
    expect(resolvePlatformDriver({ platform: "cnki", downloadMode: "zotero_only" })).toMatchObject({ kind: "cnki" });
    expect(resolvePlatformDriver({ platform: "fallback", downloadMode: "manual_only" })).toMatchObject({ kind: "fallback" });
  });

  it("executes the gale driver through injected snapshot and cdp deps", async () => {
    const driver = resolvePlatformDriver({ platform: "gale", downloadMode: "page_range_dialog" });
    const snapshot = vi.fn().mockResolvedValue({
      id: "s_1",
      metaPath: "/tmp/s_1.json",
      textPath: "/tmp/s_1.txt",
      pngPath: "/tmp/s_1.png",
      tab: { targetId: "t1", title: "Gale", url: "https://go.gale.com/ps/start.do?p=TTDA" },
      capturedAt: "2026-03-12T00:00:00.000Z",
    });
    const runCdp = vi.fn().mockResolvedValue({ rebound: true });

    const result = await driver.run({
      deps: {
        relayBaseUrl: "http://127.0.0.1:18992",
        snapshot,
        runCdp,
      },
      row: parsePlatformMatrixRow({
        guideName: "The Times Digital Archive",
        umichHit: "University of Michigan database record 9041",
        landingUrl: "https://go.gale.com/ps/start.do?p=TTDA&u=umuser",
        landingHost: "go.gale.com",
        platform: "gale",
        downloadMode: "page_range_dialog",
        status: "planned",
      }),
      request: {
        projectDir: "/Users/woooci/Downloads/histwrite",
        targetId: "t1",
        outDir: "/tmp/histwrite-driver-gale",
      },
    });

    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(runCdp).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      ok: true,
      kind: "gale",
      status: "ready",
    });
  });

  it("returns structured manual_required responses for stub drivers", async () => {
    const driver = resolvePlatformDriver({ platform: "cnki", downloadMode: "zotero_only" });

    await expect(
      driver.run({
        deps: {
          relayBaseUrl: "http://127.0.0.1:18992",
          snapshot: vi.fn(),
          runCdp: vi.fn(),
        },
        row: parsePlatformMatrixRow({
          guideName: "CNKI",
          umichHit: null,
          landingUrl: null,
          landingHost: null,
          platform: "cnki",
          downloadMode: "zotero_only",
          status: "planned",
        }),
        request: { projectDir: "/Users/woooci/Downloads/histwrite" },
      }),
    ).resolves.toEqual({
      ok: false,
      kind: "cnki",
      status: "manual_required",
      reason: "unsupported_download_mode",
    });
  });
});
