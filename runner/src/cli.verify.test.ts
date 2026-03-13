import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { selectorContractVersion } from "./selector/contract.js";

const execFileAsync = promisify(execFile);

async function writeVerifyFixture(root: string, draftText: string, options?: { legacyCards?: boolean }) {
  const materialsIndexDir = path.join(root, "材料", "_index");
  const artifactsDir = path.join(root, ".histwrite", "artifacts");
  const reportsDir = path.join(root, ".histwrite", "reports");
  const draftDir = path.join(root, "正文");
  await fs.mkdir(materialsIndexDir, { recursive: true });
  await fs.mkdir(artifactsDir, { recursive: true });
  await fs.mkdir(draftDir, { recursive: true });
  await fs.mkdir(reportsDir, { recursive: true });

  const materialsPath = path.join(materialsIndexDir, "materials.v2.json");
  const cardsPath = path.join(artifactsDir, "cards.v2.json");
  const packPath = path.join(artifactsDir, "section.s1.pack.v1.json");
  const draftPath = path.join(draftDir, "section.s1.md");

  const rawText = "1902年地方财政调整已经开始。";
  const selectorBundle = {
    quote: {
      type: "TextQuoteSelector",
      layer: "rawText",
      exact: "地方财政调整",
    },
  };

  await fs.writeFile(
    materialsPath,
    `${JSON.stringify(
      {
        version: 2,
        selectorContractVersion,
        materials: [
          {
            materialId: "m1",
            provenance: {
              kind: "archive",
              title: "材料一",
              sourcePath: "/tmp/m1.txt",
              sourceSha256: "m1",
              textPath: "/tmp/m1.txt",
              textSha256: "m1",
            },
            rawText,
            normText: rawText,
            indexText: rawText,
            selectorContractVersion,
          },
        ],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  await fs.writeFile(
    cardsPath,
    `${JSON.stringify(
      options?.legacyCards
        ? {
            version: 1,
            createdAt: "2026-03-12T00:00:00.000Z",
            cards: [
              {
                cardId: "c1",
                materialId: "m1",
                fact: "材料记载地方财政调整已经开始。",
                level: "direct",
                confidence: 0.95,
                quote: "地方财政调整",
              },
            ],
          }
        : {
            version: 2,
            createdAt: "2026-03-12T00:00:00.000Z",
            selectorContractVersion,
            cards: [
              {
                cardId: "c1",
                materialId: "m1",
                fact: "材料记载地方财政调整已经开始。",
                level: "direct",
                confidence: 0.95,
                selectorBundle,
                resolvedSpan: {
                  rawStart: 5,
                  rawEnd: 11,
                  extractedExactRaw: "地方财政调整",
                  method: "quote_anchored",
                },
              },
            ],
          },
      null,
      2,
    )}\n`,
    "utf8",
  );

  await fs.writeFile(
    packPath,
    `${JSON.stringify(
      {
        version: 1,
        createdAt: "2026-03-12T00:00:00.000Z",
        packId: "pack_verify",
        blueprintRef: {
          artifactId: "sha256:blueprint",
          sha256: "blueprint",
          path: "/tmp/blueprint.json",
          builtAt: "2026-03-12T00:00:00.000Z",
        },
        sectionId: "s1",
        timeWindow: { start: "1900", end: "1905" },
        textWindow: { topic: "财政调整" },
        cards: [
          {
            cardId: "c1",
            selectedEvidenceIds: ["c1"],
            selectorBundles: [selectorBundle],
            resolvedSpans: [
              {
                rawStart: 5,
                rawEnd: 11,
                extractedExactRaw: "地方财政调整",
                method: "quote_anchored",
              },
            ],
          },
        ],
        qa: [],
        constraints: { finalMissingGapsBlock: true, noNewClaims: true },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  await fs.writeFile(draftPath, `${draftText}\n`, "utf8");

  return { materialsPath, cardsPath, packPath, draftPath, reportsDir };
}

describe("histwrite runner cli verify", () => {
  it("writes factcheck and chronology reports and returns passed json status", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "histwrite-runner-verify-pass-"));
    const { materialsPath, cardsPath, packPath, draftPath, reportsDir } = await writeVerifyFixture(
      root,
      "〔claim:c1|kind=causal|ev=c1:c1〕1902年地方财政调整已经开始。〔/claim〕",
    );
    const cliPath = fileURLToPath(new URL("./cli.ts", import.meta.url));

    const { stdout } = await execFileAsync(process.execPath, [
      "--import",
      "tsx",
      cliPath,
      "verify",
      "--project",
      root,
      "--pack",
      packPath,
      "--draft",
      draftPath,
      "--materials",
      materialsPath,
      "--cards",
      cardsPath,
      "--mode",
      "final",
      "--json",
    ]);

    const parsed = JSON.parse(stdout.trim()) as {
      ok: boolean;
      status: "passed" | "failed";
      factcheck: { blockers: number; path: string };
      chronology: { blockers: number; path: string };
    };

    expect(parsed.ok).toBe(true);
    expect(parsed.status).toBe("passed");
    expect(parsed.factcheck.blockers).toBe(0);
    expect(parsed.chronology.blockers).toBe(0);
    await expect(fs.access(path.join(reportsDir, "factcheck.v1.json"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(reportsDir, "chronology.v1.json"))).resolves.toBeUndefined();
  });

  it("returns failed json status when blockers remain", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "histwrite-runner-verify-fail-"));
    const { materialsPath, cardsPath, packPath, draftPath } = await writeVerifyFixture(
      root,
      "〔claim:c1|kind=causal|ev=c1:c1〕1910年地方财政调整已经开始。〔/claim〕",
    );
    const cliPath = fileURLToPath(new URL("./cli.ts", import.meta.url));

    const { stdout } = await execFileAsync(process.execPath, [
      "--import",
      "tsx",
      cliPath,
      "verify",
      "--project",
      root,
      "--pack",
      packPath,
      "--draft",
      draftPath,
      "--materials",
      materialsPath,
      "--cards",
      cardsPath,
      "--mode",
      "final",
      "--json",
    ]);

    const parsed = JSON.parse(stdout.trim()) as {
      status: "passed" | "failed";
      blockers: number;
      chronology: { blockers: number };
    };

    expect(parsed.status).toBe("failed");
    expect(parsed.blockers).toBeGreaterThan(0);
    expect(parsed.chronology.blockers).toBeGreaterThan(0);
  });

  it("migrates legacy quote-only cards during verify", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "histwrite-runner-verify-legacy-"));
    const { materialsPath, cardsPath, packPath, draftPath } = await writeVerifyFixture(
      root,
      "〔claim:c1|kind=causal|ev=c1:c1〕1902年地方财政调整已经开始。〔/claim〕",
      { legacyCards: true },
    );
    const cliPath = fileURLToPath(new URL("./cli.ts", import.meta.url));

    const { stdout } = await execFileAsync(process.execPath, [
      "--import",
      "tsx",
      cliPath,
      "verify",
      "--project",
      root,
      "--pack",
      packPath,
      "--draft",
      draftPath,
      "--materials",
      materialsPath,
      "--cards",
      cardsPath,
      "--mode",
      "final",
      "--json",
    ]);

    const parsed = JSON.parse(stdout.trim()) as { status: "passed" | "failed"; blockers: number };
    expect(parsed.status).toBe("passed");
    expect(parsed.blockers).toBe(0);
  });
});
