import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("histwrite runner cli platform classify", () => {
  it("builds classification json/tsv/md artifacts from the stored matrix and richer UMich csv", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "histwrite-runner-platform-classify-"));
    const indexDir = path.join(root, "材料", "_index");
    const csvPath = path.join(root, "umich.csv");
    await fs.mkdir(indexDir, { recursive: true });

    const rows = [
      {
        guideName: "NATO",
        guideCode: null,
        umichHit: "Rise and Fall of Senator Joseph R. McCarthy",
        landingUrl: "https://link.gale.com/apps/doc/CX123",
        landingHost: "link.gale.com",
        platform: "gale",
        downloadMode: "page_range_dialog",
        status: "planned",
        notes: null,
      },
      {
        guideName: "HathiTrust Digital Library",
        guideCode: null,
        umichHit: null,
        landingUrl: null,
        landingHost: null,
        platform: "fallback",
        downloadMode: "manual_only",
        status: "manual_required",
        notes: null,
      },
      {
        guideName: "ProQuest Research Library (PRL)",
        guideCode: null,
        umichHit: null,
        landingUrl: null,
        landingHost: null,
        platform: "fallback",
        downloadMode: "manual_only",
        status: "manual_required",
        notes: null,
      },
    ];

    await fs.writeFile(
      path.join(indexDir, "umich_platform_matrix.json"),
      `${JSON.stringify({ generatedAt: "2026-03-13T04:22:29.257Z", rowCount: rows.length, rows }, null, 2)}\n`,
      "utf8",
    );
    await fs.writeFile(csvPath, `title,platform,vendor_hint,company_guess,ddm_link,access_type
"HathiTrust Digital Library",,,,"https://ddm.dnd.lib.umich.edu/database/link/10197","Open access for all users"
"ProQuest Research Library","ProQuest",,"ProQuest (Clarivate)","https://ddm.dnd.lib.umich.edu/database/link/9851","Authorized U-M users (+ guests in U-M Libraries)"
`, "utf8");

    const cliPath = fileURLToPath(new URL("./cli.ts", import.meta.url));
    const { stdout } = await execFileAsync(process.execPath, [
      "--import",
      "tsx",
      cliPath,
      "platform",
      "classify",
      "--project",
      root,
      "--umich-csv",
      csvPath,
    ]);

    const parsed = JSON.parse(stdout.trim()) as {
      ok: boolean;
      rowCount: number;
      summary: Record<string, number>;
      jsonPath: string;
      tsvPath: string;
      mdPath: string;
    };

    expect(parsed.ok).toBe(true);
    expect(parsed.rowCount).toBe(3);
    expect(parsed.summary).toMatchObject({
      matched_needs_review: 1,
      public_open_access: 1,
      csv_vendor_hint: 1,
    });

    const classificationJson = JSON.parse(await fs.readFile(parsed.jsonPath, "utf8")) as {
      rows: Array<{ guideName: string; category: string; nextAction: string }>;
    };
    const classificationTsv = await fs.readFile(parsed.tsvPath, "utf8");
    const classificationMd = await fs.readFile(parsed.mdPath, "utf8");

    expect(classificationJson.rows).toMatchObject([
      { guideName: "NATO", category: "matched_needs_review", nextAction: "review_existing_match" },
      { guideName: "HathiTrust Digital Library", category: "public_open_access", nextAction: "public_resolver" },
      { guideName: "ProQuest Research Library (PRL)", category: "csv_vendor_hint", nextAction: "reuse_catalog_ddm_link" },
    ]);
    expect(classificationTsv).toContain("matched_needs_review\treview_existing_match\tNATO");
    expect(classificationMd).toContain("UMich Platform Resolution Classification");
  });
});
