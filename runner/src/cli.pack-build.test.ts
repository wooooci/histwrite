import { execFile } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { normalizeSelectorBundle, normalizeTextQuoteSelector, selectorContractVersion } from "./selector/contract.js";
import { resolveSelector } from "./selector/resolve.js";

const execFileAsync = promisify(execFile);

function makeCard(id: string, fact: string, quote: string, confidence: number) {
  const rawText = `材料 ${id}：${quote}。`;
  const selectorBundle = normalizeSelectorBundle({
    quote: normalizeTextQuoteSelector({
      type: "TextQuoteSelector",
      layer: "rawText",
      exact: quote,
    }),
  });
  return {
    cardId: id,
    materialId: `m-${id}`,
    fact,
    level: "direct" as const,
    confidence,
    selectorBundle,
    resolvedSpan: resolveSelector({ rawText, selector: selectorBundle }),
  };
}

async function writeFixtureInputs(root: string) {
  const blueprintDir = path.join(root, "蓝图");
  const artifactsDir = path.join(root, ".histwrite", "artifacts");
  const materialsIndexDir = path.join(root, "材料", "_index");
  await fs.mkdir(blueprintDir, { recursive: true });
  await fs.mkdir(artifactsDir, { recursive: true });
  await fs.mkdir(materialsIndexDir, { recursive: true });

  const blueprintPath = path.join(blueprintDir, "blueprint.v2.json");
  const cardsPath = path.join(artifactsDir, "cards.v2.json");
  const qaPath = path.join(artifactsDir, "qa.v1.json");
  const materialsPath = path.join(materialsIndexDir, "materials.v2.json");

  await fs.writeFile(
    materialsPath,
    `${JSON.stringify(
      {
        version: 2,
        selectorContractVersion,
        materials: [
          {
            materialId: "m-c1",
            provenance: {
              kind: "archive",
              title: "材料 c1",
              sourcePath: "/tmp/m-c1.txt",
              sourceSha256: "m-c1",
              textPath: "/tmp/m-c1.txt",
              textSha256: "m-c1",
            },
            rawText: "材料 c1：税制改革。",
            normText: "材料 c1：税制改革。",
            indexText: "材料 c1：税制改革。",
            selectorContractVersion,
          },
          {
            materialId: "m-c2",
            provenance: {
              kind: "archive",
              title: "材料 c2",
              sourcePath: "/tmp/m-c2.txt",
              sourceSha256: "m-c2",
              textPath: "/tmp/m-c2.txt",
              textSha256: "m-c2",
            },
            rawText: "材料 c2：其他议题。",
            normText: "材料 c2：其他议题。",
            indexText: "材料 c2：其他议题。",
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
    blueprintPath,
    `${JSON.stringify(
      {
        version: 2,
        sections: [
          {
            sectionId: "s1",
            title: "税制改革",
            timeWindow: { start: "1900", end: "1905" },
            textWindow: { topic: "税制改革" },
            keywords: ["税制"],
            maxCards: 1,
            maxQa: 2,
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
      {
        version: 2,
        createdAt: new Date().toISOString(),
        selectorContractVersion,
        cards: [makeCard("c1", "材料直接记载税制改革。", "税制改革", 0.9), makeCard("c2", "其他议题。", "其他议题", 0.95)],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  await fs.writeFile(
    qaPath,
    `${JSON.stringify(
      {
        version: 1,
        createdAt: new Date().toISOString(),
        selectorContractVersion,
        items: [
          {
            qaId: "q1",
            question: "材料直接说明了什么？",
            answer: "它直接说明了税制改革。",
            answerType: "direct",
            evidenceRefs: [
              {
                cardId: "c1",
                materialId: "m-c1",
                selectorBundle: makeCard("c1-shadow", "材料直接记载税制改革。", "税制改革", 0.9).selectorBundle,
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

  return { blueprintPath, cardsPath, qaPath, materialsPath };
}

describe("histwrite runner cli pack build", () => {
  it("prints pack paths and head info", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "histwrite-runner-pack-build-"));
    const { blueprintPath, cardsPath, qaPath } = await writeFixtureInputs(root);
    const cliPath = fileURLToPath(new URL("./cli.ts", import.meta.url));
    const outDir = path.join(root, ".histwrite", "artifacts", "packs");

    const { stdout } = await execFileAsync(process.execPath, [
      "--import",
      "tsx",
      cliPath,
      "pack",
      "build",
      "--project",
      root,
      "--blueprint",
      blueprintPath,
      "--cards",
      cardsPath,
      "--qa",
      qaPath,
      "--outDir",
      outDir,
      "--json",
    ]);

    const parsed = JSON.parse(stdout.trim()) as {
      ok: boolean;
      packPaths: string[];
      head: { artifactId: string; sha256: string };
      manifestPath: string;
    };

    expect(parsed.ok).toBe(true);
    expect(parsed.packPaths.length).toBe(1);
    expect(parsed.head.artifactId).toContain("sha256:");
    await expect(fs.access(parsed.packPaths[0]!)).resolves.toBeUndefined();
    await expect(fs.access(parsed.manifestPath)).resolves.toBeUndefined();
  });

  it("returns cacheHit on repeated runs with the same inputs", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "histwrite-runner-pack-build-cache-"));
    const { blueprintPath, cardsPath } = await writeFixtureInputs(root);
    const cliPath = fileURLToPath(new URL("./cli.ts", import.meta.url));

    await execFileAsync(process.execPath, [
      "--import",
      "tsx",
      cliPath,
      "pack",
      "build",
      "--project",
      root,
      "--blueprint",
      blueprintPath,
      "--cards",
      cardsPath,
      "--json",
    ]);

    const { stdout } = await execFileAsync(process.execPath, [
      "--import",
      "tsx",
      cliPath,
      "pack",
      "build",
      "--project",
      root,
      "--blueprint",
      blueprintPath,
      "--cards",
      cardsPath,
      "--json",
    ]);

    const parsed = JSON.parse(stdout.trim()) as { cacheHit: boolean };
    expect(parsed.cacheHit).toBe(true);
  });

  it("creates the output directory automatically when missing", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "histwrite-runner-pack-build-outdir-"));
    const { blueprintPath, cardsPath } = await writeFixtureInputs(root);
    const cliPath = fileURLToPath(new URL("./cli.ts", import.meta.url));
    const outDir = path.join(root, "自定义输出", "packs");

    const { stdout } = await execFileAsync(process.execPath, [
      "--import",
      "tsx",
      cliPath,
      "pack",
      "build",
      "--project",
      root,
      "--blueprint",
      blueprintPath,
      "--cards",
      cardsPath,
      "--outDir",
      outDir,
      "--json",
    ]);

    const parsed = JSON.parse(stdout.trim()) as { packPaths: string[] };
    expect(parsed.packPaths[0]?.startsWith(outDir)).toBe(true);
    await expect(fs.access(outDir)).resolves.toBeUndefined();
  });

  it("migrates legacy quote-only cards during pack build", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "histwrite-runner-pack-build-legacy-"));
    const { blueprintPath, cardsPath } = await writeFixtureInputs(root);
    const cliPath = fileURLToPath(new URL("./cli.ts", import.meta.url));

    await fs.writeFile(
      cardsPath,
      `${JSON.stringify(
        {
          version: 1,
          createdAt: new Date().toISOString(),
          cards: [
            {
              cardId: "c1",
              materialId: "m-c1",
              fact: "材料直接记载税制改革。",
              level: "direct",
              confidence: 0.9,
              quote: "税制改革",
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const { stdout } = await execFileAsync(process.execPath, [
      "--import",
      "tsx",
      cliPath,
      "pack",
      "build",
      "--project",
      root,
      "--blueprint",
      blueprintPath,
      "--cards",
      cardsPath,
      "--json",
    ]);

    const parsed = JSON.parse(stdout.trim()) as { packPaths: string[] };
    const pack = JSON.parse(await fs.readFile(parsed.packPaths[0]!, "utf8")) as {
      cards: Array<{
        selectorBundles: Array<{ quote: { exact: string } }>;
        resolvedSpans: Array<{ method: string }>;
      }>;
    };

    expect(pack.cards[0]?.selectorBundles[0]?.quote.exact).toBe("税制改革");
    expect(pack.cards[0]?.resolvedSpans[0]?.method).toBe("position_verified");
  });

  it("uses judge ranking when --useJudge is enabled", async () => {
    let calls = 0;
    const server = createServer(async (req, res) => {
      if (req.url !== "/v1/chat/completions" || req.method !== "POST") {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      calls += 1;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  "{\"chosenId\":\"cand_0002\",\"ranked\":[{\"id\":\"cand_0002\",\"score\":0.91,\"pass\":true,\"reason\":\"更贴题\"},{\"id\":\"cand_0001\",\"score\":0.52,\"pass\":false,\"reason\":\"略弱\"}]}",
              },
            },
          ],
        }),
      );
    });

    const port = await new Promise<number>((resolve, reject) => {
      server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
      server.once("error", reject);
    });

    try {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), "histwrite-runner-pack-build-judge-"));
      const { blueprintPath, cardsPath } = await writeFixtureInputs(root);
      const cliPath = fileURLToPath(new URL("./cli.ts", import.meta.url));

      await fs.writeFile(
        cardsPath,
        `${JSON.stringify(
          {
            version: 2,
            createdAt: new Date().toISOString(),
            selectorContractVersion,
            cards: [
              makeCard("c1", "税制改革的核心线索。", "税制改革", 0.95),
              makeCard("c2", "税制改革的替代线索。", "税制改革", 0.6),
            ],
          },
          null,
          2,
        )}\n`,
        "utf8",
      );

      const { stdout } = await execFileAsync(process.execPath, [
        "--import",
        "tsx",
        cliPath,
        "pack",
        "build",
        "--project",
        root,
        "--blueprint",
        blueprintPath,
        "--cards",
        cardsPath,
        "--useJudge",
        "--apiBaseUrl",
        `http://127.0.0.1:${port}`,
        "--apiKeyEnv",
        "OPENAI_API_KEY",
        "--model",
        "judge-pack-test",
      ], {
        env: { ...process.env, OPENAI_API_KEY: "test-key" },
      });

      const parsed = JSON.parse(stdout.trim()) as { packPaths: string[] };
      const pack = JSON.parse(await fs.readFile(parsed.packPaths[0]!, "utf8")) as {
        cards: Array<{ cardId: string }>;
      };

      expect(pack.cards.map((card) => card.cardId)).toEqual(["c2"]);
      expect(calls).toBe(1);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
