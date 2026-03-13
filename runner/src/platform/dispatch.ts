import { normalizeRelayBaseUrl } from "../capture.js";
import type { PlatformMatrixRow } from "./contract.js";
import type { PlatformDownloadRequest, PlatformDriverDeps, PlatformDriverResult } from "./driver-contract.js";
import { resolvePlatformDriver } from "./registry.js";

export async function dispatchPlatformDownload(params: {
  deps: PlatformDriverDeps;
  row: PlatformMatrixRow;
  request: PlatformDownloadRequest;
}): Promise<PlatformDriverResult> {
  const driver = resolvePlatformDriver({
    platform: params.row.platform,
    downloadMode: params.row.downloadMode,
  });

  return await driver.run({
    deps: {
      ...params.deps,
      relayBaseUrl: normalizeRelayBaseUrl(params.deps.relayBaseUrl),
    },
    row: params.row,
    request: params.request,
  });
}
