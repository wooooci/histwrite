import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("histwrite runner cli platform matrix", () => {
  it("builds json/tsv/md platform matrix artifacts under 材料/_index", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "histwrite-runner-platform-matrix-"));
    const guideJson = path.join(root, "guide.json");
    const umichJson = path.join(root, "umich.json");

    await fs.writeFile(
      guideJson,
      `${JSON.stringify([{ guideName: "JSTOR" }, { guideName: "The Times Digital Archive" }], null, 2)}\n`,
      "utf8",
    );
    await fs.writeFile(
      umichJson,
      `${JSON.stringify(
        [
          { name: "JSTOR", url: "https://www.jstor.org/" },
          {
            name: "University of Michigan database record 9041",
            url: "https://ddm.dnd.lib.umich.edu/database/link/9041",
            resolvedUrl: "https://go.gale.com/ps/start.do?p=TTDA&u=umuser",
          },
        ],
        null,
        2,
      )}\n`,
      "utf8",
    );

    const cliPath = fileURLToPath(new URL("./cli.ts", import.meta.url));
    const { stdout } = await execFileAsync(process.execPath, [
      "--import",
      "tsx",
      cliPath,
      "platform",
      "matrix",
      "--project",
      root,
      "--guide-json",
      guideJson,
      "--umich-json",
      umichJson,
      "--no-resolve-landing",
    ]);

    const parsed = JSON.parse(stdout.trim()) as {
      ok: boolean;
      rowCount: number;
      jsonPath: string;
      tsvPath: string;
      mdPath: string;
    };

    expect(parsed.ok).toBe(true);
    expect(parsed.rowCount).toBe(2);

    const matrixJson = JSON.parse(await fs.readFile(parsed.jsonPath, "utf8")) as {
      rows: Array<{ guideName: string; platform: string; landingHost: string | null }>;
    };
    const matrixMd = await fs.readFile(parsed.mdPath, "utf8");
    const matrixTsv = await fs.readFile(parsed.tsvPath, "utf8");

    expect(matrixJson.rows[0]).toMatchObject({ guideName: "JSTOR", platform: "jstor" });
    expect(matrixJson.rows[1]).toMatchObject({ guideName: "The Times Digital Archive", platform: "gale" });
    expect(matrixMd).toContain("UMich Platform Matrix");
    expect(matrixTsv).toContain("guideName\tguideCode\tumichHit");
  });

  it("accepts full guide items shape and UMich raw disciplines shape", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "histwrite-runner-platform-matrix-raw-"));
    const guideJson = path.join(root, "guide.json");
    const umichJson = path.join(root, "umich-raw.json");

    await fs.writeFile(
      guideJson,
      `${JSON.stringify(
        {
          count: 2,
          items: [
            {
              name: "JSTOR",
              code: "K14/B01",
              raw: "JSTORꎬ K14/B01",
            },
            {
              name: "ProQuest Historical Newspapers",
              code: "K712/D99",
              raw: "ProQuest Historical Newspapersꎬ K712/D99",
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await fs.writeFile(
      umichJson,
      `${JSON.stringify(
        {
          scrapedAt: "2026-02-07T12:48:47.614Z",
          disciplines: [
            {
              discipline: "History (General)",
              rows: [
                {
                  recordId: "9041",
                  title: "JSTOR",
                  permalink: "https://ddm.dnd.lib.umich.edu/database/link/9041",
                  recordUrl: "https://search.lib.umich.edu/databases/record/9041",
                },
                {
                  recordId: "9371",
                  title: "ProQuest Historical Newspapers",
                  permalink: "https://ddm.dnd.lib.umich.edu/database/link/9371",
                  recordUrl: "https://search.lib.umich.edu/databases/record/9371",
                },
              ],
            },
            {
              discipline: "United States History",
              rows: [
                {
                  recordId: "9371",
                  title: "ProQuest Historical Newspapers",
                  permalink: "https://ddm.dnd.lib.umich.edu/database/link/9371",
                  recordUrl: "https://search.lib.umich.edu/databases/record/9371",
                },
              ],
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const cliPath = fileURLToPath(new URL("./cli.ts", import.meta.url));
    const { stdout } = await execFileAsync(process.execPath, [
      "--import",
      "tsx",
      cliPath,
      "platform",
      "matrix",
      "--project",
      root,
      "--guide-json",
      guideJson,
      "--umich-json",
      umichJson,
      "--no-resolve-landing",
    ]);

    const parsed = JSON.parse(stdout.trim()) as {
      ok: boolean;
      rowCount: number;
      jsonPath: string;
    };

    expect(parsed.ok).toBe(true);
    expect(parsed.rowCount).toBe(2);

    const matrixJson = JSON.parse(await fs.readFile(parsed.jsonPath, "utf8")) as {
      rows: Array<{ guideName: string; platform: string; umichHit: string | null }>;
    };

    expect(matrixJson.rows).toMatchObject([
      { guideName: "JSTOR", platform: "jstor", umichHit: "JSTOR" },
      {
        guideName: "ProQuest Historical Newspapers",
        platform: "proquest",
        umichHit: "ProQuest Historical Newspapers",
      },
    ]);
  });
});
