import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("histwrite runner cli scan", () => {
  it("routes scan commands into the scanner dispatcher", async () => {
    const cliPath = fileURLToPath(new URL("./cli.ts", import.meta.url));

    const failure = await execFileAsync(process.execPath, [
      "--import",
      "tsx",
      cliPath,
      "scan",
      "unknown",
    ]).then(
      () => null,
      (error) => error as { code?: number; stdout?: string; stderr?: string },
    );

    expect(failure).toBeTruthy();
    expect(String(failure?.stderr || failure?.stdout || "")).toMatch(/unsupported scanner/i);
  });
});
