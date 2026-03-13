import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import type { SectionPackV1 } from "./packs/schema.js";

const execFileAsync = promisify(execFile);

function makePack(): SectionPackV1 {
  return {
    version: 1,
    createdAt: "2026-03-12T00:00:00.000Z",
    packId: "pack_cli_claims",
    blueprintRef: {
      artifactId: "sha256:blueprint",
      sha256: "blueprint",
      path: "/tmp/blueprint.json",
      builtAt: "2026-03-12T00:00:00.000Z",
    },
    sectionId: "s1",
    timeWindow: { start: "1900", end: "1905" },
    textWindow: { topic: "税制改革" },
    cards: [
      {
        cardId: "c1",
        selectedEvidenceIds: ["c1"],
        selectorBundles: [],
        resolvedSpans: [
          {
            rawStart: 0,
            rawEnd: 4,
            extractedExactRaw: "税制改革",
            method: "quote_anchored",
          },
        ],
      },
    ],
    qa: [],
    constraints: { finalMissingGapsBlock: true, noNewClaims: true },
  };
}

describe("histwrite runner cli claims extract", () => {
  it("extracts a claims artifact from a draft file", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "histwrite-runner-claims-extract-"));
    const packPath = path.join(root, "pack.v1.json");
    const draftPath = path.join(root, "正文", "section.s1.md");
    const outPath = path.join(root, ".histwrite", "artifacts", "claims", "section.s1.claims.v1.json");
    await fs.mkdir(path.dirname(draftPath), { recursive: true });
    await fs.writeFile(packPath, `${JSON.stringify(makePack(), null, 2)}\n`, "utf8");
    await fs.writeFile(
      draftPath,
      "〔claim:c1|kind=causal|ev=c1:c1〕税制改革推动了地方财政调整。〔/claim〕\n",
      "utf8",
    );

    const cliPath = fileURLToPath(new URL("./cli.ts", import.meta.url));
    const { stdout } = await execFileAsync(process.execPath, [
      "--import",
      "tsx",
      cliPath,
      "claims",
      "extract",
      "--project",
      root,
      "--pack",
      packPath,
      "--draft",
      draftPath,
      "--out",
      outPath,
    ]);

    const parsed = JSON.parse(stdout.trim()) as {
      ok: boolean;
      outPath: string;
      claims: number;
      invalidClaims: number;
      claimSet: number;
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.outPath).toBe(outPath);
    expect(parsed.claims).toBe(1);
    expect(parsed.invalidClaims).toBe(0);
    expect(parsed.claimSet).toBe(1);

    const artifact = JSON.parse(await fs.readFile(outPath, "utf8")) as {
      claims: Array<{ claimId: string; text: string; kind: string; riskFlags: string[] }>;
    };
    expect(artifact.claims).toMatchObject([
      {
        claimId: "c1",
        kind: "causal",
        riskFlags: [],
        text: "税制改革推动了地方财政调整。",
      },
    ]);
  });
});
