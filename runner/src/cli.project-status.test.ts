import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("histwrite runner cli project status", () => {
  it("reports resolved project layout", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "histwrite-runner-project-status-"));

    const { stdout } = await execFileAsync(process.execPath, [
      "--import",
      "tsx",
      path.resolve("runner/src/cli.ts"),
      "project",
      "status",
      "--project",
      root,
    ]);

    const parsed = JSON.parse(stdout.trim()) as {
      ok: boolean;
      projectDir: string;
      materialsDir: string;
      blueprintDir: string;
      exportDir: string;
    };

    expect(parsed.ok).toBe(true);
    expect(parsed.projectDir).toBe(root);
    expect(parsed.materialsDir).toBe(path.join(root, "材料"));
    expect(parsed.blueprintDir).toBe(path.join(root, "蓝图"));
    expect(parsed.exportDir).toBe(path.join(root, "导出"));
  });
});
