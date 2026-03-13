import { main as runJstorScanner } from "./jstor.js";
import { main as runProquestScanner } from "./proquest.js";
import { main as runGaleScanner } from "./gale.js";
import { main as runAdamMatthewScanner } from "./adammatthew.js";
import { main as runHathiTrustScanner } from "./hathitrust.js";

export type ScannerRunner = (args: string[]) => Promise<void>;

export type ScannerCommandDeps = {
  jstor: ScannerRunner;
  proquest: ScannerRunner;
  gale: ScannerRunner;
  adammatthew: ScannerRunner;
  hathitrust: ScannerRunner;
};

export const defaultScannerCommandDeps: ScannerCommandDeps = {
  jstor: runJstorScanner,
  proquest: runProquestScanner,
  gale: runGaleScanner,
  adammatthew: runAdamMatthewScanner,
  hathitrust: runHathiTrustScanner,
};

export async function runScannerCommand(
  argv: string[],
  deps: ScannerCommandDeps = defaultScannerCommandDeps,
): Promise<void> {
  const platform = String(argv[1] ?? "").trim().toLowerCase();
  const forwardedArgs = argv.slice(2);

  switch (platform) {
    case "jstor":
      await deps.jstor(forwardedArgs);
      return;
    case "proquest":
      await deps.proquest(forwardedArgs);
      return;
    case "gale":
      await deps.gale(forwardedArgs);
      return;
    case "adammatthew":
      await deps.adammatthew(forwardedArgs);
      return;
    case "hathitrust":
      await deps.hathitrust(forwardedArgs);
      return;
    default:
      throw new Error(
        `unsupported scanner: ${platform || "(missing)"}; expected one of jstor, proquest, gale, adammatthew, hathitrust`,
      );
  }
}
