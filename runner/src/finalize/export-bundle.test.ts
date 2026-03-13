import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ensureHistwriteProject } from "../project.js";
import { exportFinalizeBundle } from "./export-bundle.js";

describe("exportFinalizeBundle", () => {
  it("collects final markdown, reports, runlog and artifact heads into one bundle directory", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), `histwrite-export-bundle-${randomUUID()}-`));
    const layout = await ensureHistwriteProject(tmp);
    const finalMarkdownPath = path.join(layout.exportDir, "section.s1.final.md");
    const factcheckPath = path.join(layout.metaDir, "reports", "factcheck.v1.json");
    const chronologyPath = path.join(layout.metaDir, "reports", "chronology.v1.json");
    const finalcheckPath = path.join(layout.metaDir, "reports", "finalcheck", "section-s1", "latest", "report.md");
    const runLogPath = path.join(layout.logsDir, "run-finalize.jsonl");
    const materialsPath = path.join(layout.materialsIndexDir, "materials.v2.json");
    const cardsPath = path.join(layout.artifactsDir, "cards.v2.json");
    const packPath = path.join(layout.artifactsDir, "section.s1.pack.v1.json");

    await fs.mkdir(path.dirname(finalcheckPath), { recursive: true });
    await fs.writeFile(finalMarkdownPath, "# Final\n", "utf8");
    await fs.writeFile(factcheckPath, '{"blockers":0}\n', "utf8");
    await fs.writeFile(chronologyPath, '{"blockers":0}\n', "utf8");
    await fs.writeFile(finalcheckPath, "# Final Check\n", "utf8");
    await fs.writeFile(runLogPath, '{"name":"command_start"}\n', "utf8");
    await fs.writeFile(materialsPath, '{"version":2,"materials":[]}\n', "utf8");
    await fs.writeFile(cardsPath, '{"version":2,"cards":[]}\n', "utf8");
    await fs.writeFile(packPath, '{"version":1,"cards":[]}\n', "utf8");

    const result = await exportFinalizeBundle({
      layout,
      finalMarkdownPath,
      factcheckReportPath: factcheckPath,
      chronologyReportPath: chronologyPath,
      finalcheckReportPath: finalcheckPath,
      runLogPath,
      artifactPaths: {
        materialsPath,
        cardsPath,
        packPath,
      },
    });

    expect(result.outDir).toContain(path.join(layout.exportDir, "finalize"));
    await expect(fs.readFile(path.join(result.outDir, "Final.md"), "utf8")).resolves.toContain("# Final");
    await expect(fs.readFile(path.join(result.outDir, "reports", "factcheck.json"), "utf8")).resolves.toContain('"blockers":0');
    await expect(fs.readFile(path.join(result.outDir, "reports", "chronology.json"), "utf8")).resolves.toContain('"blockers":0');
    await expect(fs.readFile(path.join(result.outDir, "reports", "finalcheck.md"), "utf8")).resolves.toContain("# Final Check");
    await expect(fs.readFile(path.join(result.outDir, "runlog.jsonl"), "utf8")).resolves.toContain('"command_start"');
    await expect(fs.readFile(path.join(result.outDir, "artifact-heads.json"), "utf8")).resolves.toContain('"version": 1');
    await expect(fs.readFile(path.join(result.outDir, "artifacts", "materials.v2.json"), "utf8")).resolves.toContain('"version":2');
    await expect(fs.readFile(path.join(result.outDir, "artifacts", "cards.v2.json"), "utf8")).resolves.toContain('"version":2');
    await expect(fs.readFile(path.join(result.outDir, "artifacts", "section.s1.pack.v1.json"), "utf8")).resolves.toContain('"version":1');
  });
});
