import type { PlatformDriver } from "../driver-contract.js";

export const galePlatformDriver: PlatformDriver = {
  kind: "gale",
  supportedDownloadModes: ["page_range_dialog"],
  matches(params) {
    return params.platform === "gale" && params.downloadMode === "page_range_dialog";
  },
  async run(ctx) {
    const snapshot = await ctx.deps.snapshot({
      projectDir: ctx.request.projectDir,
      outDir: ctx.request.outDir,
      targetId: ctx.request.targetId,
      includePng: ctx.request.includePng,
      includeText: ctx.request.includeText,
      maxChars: ctx.request.maxChars,
    });
    const cdp = await ctx.deps.runCdp({
      kind: "gale",
      relayBaseUrl: ctx.deps.relayBaseUrl,
      row: ctx.row,
      request: ctx.request,
    });

    return {
      ok: true,
      kind: "gale",
      status: "ready",
      data: {
        relayBaseUrl: ctx.deps.relayBaseUrl,
        landingUrl: ctx.row.landingUrl,
        snapshot,
        cdp,
      },
    };
  },
};
