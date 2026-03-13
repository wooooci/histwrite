import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { artifactRefFromValue } from "../artifacts/heads.js";
import { ensureHistwriteProject } from "../project.js";
import { writeSectionDraft } from "./write-section.js";

function makePack(params: { withCards?: boolean }) {
  return {
    version: 1 as const,
    createdAt: new Date().toISOString(),
    packId: "pack_test",
    blueprintRef: artifactRefFromValue({ outPath: "/tmp/blueprint.json", value: { version: 2, sections: [] } }),
    sectionId: "s1",
    timeWindow: { start: "1900", end: "1905" },
    textWindow: { topic: "税制改革" },
    cards: params.withCards === false
      ? []
      : [
          {
            cardId: "c1",
            selectedEvidenceIds: ["c1"],
            selectorBundles: [
              {
                quote: {
                  type: "TextQuoteSelector" as const,
                  layer: "rawText" as const,
                  exact: "税制改革",
                },
              },
            ],
            resolvedSpans: [
              {
                rawStart: 0,
                rawEnd: 4,
                extractedExactRaw: "税制改革",
                method: "quote_anchored" as const,
              },
            ],
          },
        ],
    qa: [],
    constraints: { finalMissingGapsBlock: true, noNewClaims: true },
  };
}

describe("writeSectionDraft", () => {
  it("writes a draft with at least one claim anchor when pack has evidence", async () => {
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
                content: "〔claim:c1|kind=causal|ev=c1:c1〕税制改革推动了地方财政调整。〔/claim〕",
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
      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), `histwrite-write-section-${randomUUID()}-`));
      const layout = await ensureHistwriteProject(path.join(tmp, "proj"));
      const outPath = path.join(layout.draftDir, "section.s1.md");

      const result = await writeSectionDraft({
        layout,
        pack: makePack({ withCards: true }),
        outPath,
        client: { apiBaseUrl: `http://127.0.0.1:${port}`, apiKey: "k", model: "m", endpoint: "chat" },
      });

      expect(result.claims).toBe(1);
      expect(result.cacheHit).toBe(false);
      expect(await fs.readFile(outPath, "utf8")).toContain("〔claim:c1|kind=causal|ev=c1:c1〕");
      expect(calls).toBe(1);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("rejects outputs that reference evidence outside the pack", async () => {
    const server = createServer(async (req, res) => {
      if (req.url !== "/v1/chat/completions" || req.method !== "POST") {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: "〔claim:c1|kind=causal|ev=outside:e0〕越界引用。〔/claim〕",
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
      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), `histwrite-write-section-${randomUUID()}-`));
      const layout = await ensureHistwriteProject(path.join(tmp, "proj"));

      await expect(
        writeSectionDraft({
          layout,
          pack: makePack({ withCards: true }),
          outPath: path.join(layout.draftDir, "section.s1.md"),
          client: { apiBaseUrl: `http://127.0.0.1:${port}`, apiKey: "k", model: "m", endpoint: "chat" },
        }),
      ).rejects.toThrow(/outside the pack/);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("allows zero claim anchors when the pack has no evidence cards", async () => {
    const server = createServer(async (req, res) => {
      if (req.url !== "/v1/chat/completions" || req.method !== "POST") {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content: "本节暂记材料缺口，待补证。" } }] }));
    });

    const port = await new Promise<number>((resolve, reject) => {
      server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
      server.once("error", reject);
    });

    try {
      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), `histwrite-write-section-${randomUUID()}-`));
      const layout = await ensureHistwriteProject(path.join(tmp, "proj"));

      const result = await writeSectionDraft({
        layout,
        pack: makePack({ withCards: false }),
        outPath: path.join(layout.draftDir, "section.s1.md"),
        client: { apiBaseUrl: `http://127.0.0.1:${port}`, apiKey: "k", model: "m", endpoint: "chat" },
      });

      expect(result.claims).toBe(0);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

