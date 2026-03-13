import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

async function seedMatrix(root: string) {
  const indexDir = path.join(root, "材料", "_index");
  await fs.mkdir(indexDir, { recursive: true });

  const rows = [
    {
      guideName: "JSTOR",
      guideCode: null,
      umichHit: "JSTOR",
      landingUrl: "https://www.jstor.org/",
      landingHost: "www.jstor.org",
      platform: "jstor",
      downloadMode: "record_then_pdf",
      status: "planned",
      notes: null,
    },
    {
      guideName: "The Times Digital Archive",
      guideCode: null,
      umichHit: "University of Michigan database record 9041",
      landingUrl: "https://go.gale.com/ps/start.do?p=TTDA&u=umuser",
      landingHost: "go.gale.com",
      platform: "gale",
      downloadMode: "page_range_dialog",
      status: "planned",
      notes: null,
    },
    {
      guideName: "CNKI",
      guideCode: null,
      umichHit: null,
      landingUrl: null,
      landingHost: null,
      platform: "cnki",
      downloadMode: "zotero_only",
      status: "manual_required",
      notes: "needs manual flow",
    },
  ];

  await fs.writeFile(
    path.join(indexDir, "umich_platform_matrix.json"),
    `${JSON.stringify({ generatedAt: "2026-03-12T00:00:00.000Z", rowCount: rows.length, rows }, null, 2)}\n`,
    "utf8",
  );
  await fs.writeFile(path.join(indexDir, "umich_platform_matrix.tsv"), "guideName\tplatform\nJSTOR\tjstor\nThe Times Digital Archive\tgale\nCNKI\tcnki\n", "utf8");
  await fs.writeFile(path.join(indexDir, "umich_platform_matrix.md"), "# UMich Platform Matrix\n", "utf8");
}

describe("histwrite runner cli sources", () => {
  it("returns current matrix artifact paths", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "histwrite-runner-sources-matrix-"));
    await seedMatrix(root);

    const cliPath = fileURLToPath(new URL("./cli.ts", import.meta.url));
    const { stdout } = await execFileAsync(process.execPath, [
      "--import",
      "tsx",
      cliPath,
      "sources",
      "matrix",
      "--project",
      root,
    ]);

    expect(stdout).toContain("umich_platform_matrix.tsv");
    expect(stdout).toContain("umich_platform_matrix.json");
  });

  it("summarizes rows by platform and status", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "histwrite-runner-sources-plan-"));
    await seedMatrix(root);

    const cliPath = fileURLToPath(new URL("./cli.ts", import.meta.url));
    const { stdout } = await execFileAsync(process.execPath, [
      "--import",
      "tsx",
      cliPath,
      "sources",
      "platform-plan",
      "--project",
      root,
    ]);

    const parsed = JSON.parse(stdout.trim()) as {
      ok: boolean;
      platforms: Record<string, { count: number; statuses: Record<string, number> }>;
    };

    expect(parsed.ok).toBe(true);
    expect(parsed.platforms.jstor).toMatchObject({ count: 1, statuses: { planned: 1 } });
    expect(parsed.platforms.cnki).toMatchObject({ count: 1, statuses: { manual_required: 1 } });
  });

  it("dispatches a sources download request through the platform registry", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "histwrite-runner-sources-download-"));
    await seedMatrix(root);

    const cliPath = fileURLToPath(new URL("./cli.ts", import.meta.url));
    const { stdout } = await execFileAsync(process.execPath, [
      "--import",
      "tsx",
      cliPath,
      "sources",
      "download",
      "--project",
      root,
      "--platform",
      "cnki",
      "--mode",
      "zotero_only",
      "--dry-run",
    ]);

    const parsed = JSON.parse(stdout.trim()) as {
      ok: boolean;
      row: { platform: string; downloadMode: string };
      result: { ok: boolean; status: string; reason?: string };
    };

    expect(parsed.ok).toBe(true);
    expect(parsed.row).toMatchObject({ platform: "cnki", downloadMode: "zotero_only" });
    expect(parsed.result).toMatchObject({
      ok: false,
      status: "manual_required",
      reason: "unsupported_download_mode",
    });
  });

  it("runs the gale strong driver in dry-run mode without requiring a live relay snapshot", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "histwrite-runner-sources-download-gale-"));
    await seedMatrix(root);

    const cliPath = fileURLToPath(new URL("./cli.ts", import.meta.url));
    const { stdout } = await execFileAsync(process.execPath, [
      "--import",
      "tsx",
      cliPath,
      "sources",
      "download",
      "--project",
      root,
      "--platform",
      "gale",
      "--mode",
      "page_range_dialog",
      "--term",
      "\"Walter Lippmann\"",
      "--dry-run",
    ]);

    const parsed = JSON.parse(stdout.trim()) as {
      ok: boolean;
      row: { platform: string; downloadMode: string };
      result: { ok: boolean; status: string; data?: { cdp?: { scanner?: string; dryRun?: boolean; term?: string } } };
    };

    expect(parsed.ok).toBe(true);
    expect(parsed.row).toMatchObject({ platform: "gale", downloadMode: "page_range_dialog" });
    expect(parsed.result).toMatchObject({
      ok: true,
      status: "ready",
      data: {
        cdp: {
          scanner: "gale",
          dryRun: true,
          term: "\"Walter Lippmann\"",
        },
      },
    });
  });
});
