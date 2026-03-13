import { describe, expect, it, vi } from "vitest";

import { runScannerCommand } from "./command.js";

describe("scanner command dispatcher", () => {
  it("dispatches jstor args to the jstor scanner", async () => {
    const jstor = vi.fn().mockResolvedValue(undefined);

    await runScannerCommand(["scan", "jstor", "--project", "/tmp/demo", "--max-items", "3"], {
      jstor,
      proquest: vi.fn(),
      gale: vi.fn(),
      adammatthew: vi.fn(),
      hathitrust: vi.fn(),
    });

    expect(jstor).toHaveBeenCalledTimes(1);
    expect(jstor).toHaveBeenCalledWith(["--project", "/tmp/demo", "--max-items", "3"]);
  });

  it("dispatches all supported platform aliases to matching scanner", async () => {
    const deps = {
      jstor: vi.fn().mockResolvedValue(undefined),
      proquest: vi.fn().mockResolvedValue(undefined),
      gale: vi.fn().mockResolvedValue(undefined),
      adammatthew: vi.fn().mockResolvedValue(undefined),
      hathitrust: vi.fn().mockResolvedValue(undefined),
    };

    await runScannerCommand(["scan", "proquest"], deps);
    await runScannerCommand(["scan", "gale"], deps);
    await runScannerCommand(["scan", "adammatthew"], deps);
    await runScannerCommand(["scan", "hathitrust"], deps);

    expect(deps.proquest).toHaveBeenCalledWith([]);
    expect(deps.gale).toHaveBeenCalledWith([]);
    expect(deps.adammatthew).toHaveBeenCalledWith([]);
    expect(deps.hathitrust).toHaveBeenCalledWith([]);
  });

  it("throws a helpful error for unsupported scanners", async () => {
    await expect(
      runScannerCommand(["scan", "unknown"], {
        jstor: vi.fn(),
        proquest: vi.fn(),
        gale: vi.fn(),
        adammatthew: vi.fn(),
        hathitrust: vi.fn(),
      }),
    ).rejects.toThrow(/unsupported scanner/i);
  });
});
