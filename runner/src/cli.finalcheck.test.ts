import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("histwrite runner cli finalcheck", () => {
  it("writes report.md and report.json for a draft file", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "histwrite-runner-finalcheck-"));
    const draftPath = path.join(root, "draft.md");
    await fs.writeFile(
      draftPath,
      [
        "# 标题",
        "",
        "正文。[^1]",
        "",
        "## 参考文献",
        "",
        "### 一手史料",
        "- 示例一手史料",
        "",
        "### 二手研究",
        "- 示例二手研究",
        "",
        "[^1]: 参见 file:///tmp/local-only.pdf **###**",
        "",
    ].join("\n"),
      "utf8",
    );

    const cliPath = fileURLToPath(new URL("./cli.ts", import.meta.url));
    const { stdout } = await execFileAsync(process.execPath, [
      "--import",
      "tsx",
      cliPath,
      "finalcheck",
      "--project",
      root,
      "--file",
      draftPath,
    ]);

    const parsed = JSON.parse(stdout.trim()) as {
      ok: boolean;
      reportPath: string;
      jsonPath: string;
      summary: { localPathRisks: number; placeholderCount: number };
    };

    expect(parsed.ok).toBe(true);
    expect(parsed.summary.localPathRisks).toBeGreaterThan(0);
    expect(parsed.summary.placeholderCount).toBeGreaterThan(0);
    await expect(fs.access(parsed.reportPath)).resolves.toBeUndefined();
    await expect(fs.access(parsed.jsonPath)).resolves.toBeUndefined();
  });
});
