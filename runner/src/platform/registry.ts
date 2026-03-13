import type { DownloadMode, PlatformId } from "./contract.js";
import { createManualPlatformDriver, type PlatformDriver } from "./driver-contract.js";
import { adamMatthewPlatformDriver } from "./drivers/adammatthew.js";
import { galePlatformDriver } from "./drivers/gale.js";
import { jstorPlatformDriver } from "./drivers/jstor.js";
import { proquestPlatformDriver } from "./drivers/proquest.js";

export const defaultPlatformDrivers: PlatformDriver[] = [
  galePlatformDriver,
  proquestPlatformDriver,
  jstorPlatformDriver,
  adamMatthewPlatformDriver,
  createManualPlatformDriver("hathitrust", ["direct_pdf"]),
  createManualPlatformDriver("cnki", ["zotero_only"]),
  createManualPlatformDriver("fallback", ["manual_only"]),
];

export function resolvePlatformDriver(
  params: { platform: PlatformId; downloadMode: DownloadMode },
  registry: PlatformDriver[] = defaultPlatformDrivers,
): PlatformDriver {
  const matched = registry.find((driver) => driver.matches(params));
  if (matched) return matched;
  return createManualPlatformDriver(params.platform, [params.downloadMode]);
}
