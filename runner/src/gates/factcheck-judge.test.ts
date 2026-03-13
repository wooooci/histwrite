import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { buildClaimMapV1, type ClaimMapItemV1 } from "../artifacts/claims.js";
import { buildFactCheckReportV1 } from "../artifacts/reports.js";
import { ensureHistwriteProject } from "../project.js";
import { runFactCheckJudge } from "./factcheck-judge.js";

function makeClaim(params: {
  claimId: string;
  kind: string;
  text: string;
}): ClaimMapItemV1 {
  return {
    claimId: params.claimId,
    kind: params.kind,
    text: params.text,
    evidenceRefs: [],
    riskFlags: [],
  };
}

describe("runFactCheckJudge", () => {
  it("judges only inference_ok and contested items into structured decisions", async () => {
    const requests: string[] = [];
    const server = createServer(async (req, res) => {
      if (req.url !== "/v1/chat/completions" || req.method !== "POST") {
        res.writeHead(404);
        res.end("not found");
        return;
      }

      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      requests.push(Buffer.concat(chunks).toString("utf8"));

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  items: [
                    {
                      claimId: "c2",
                      baseStatus: "inference_ok",
                      needsCounterExplanation: false,
                      toneOverclaim: true,
                      recommendedAction: "downgrade",
                      reason: "推断语气过满，建议降格。",
                    },
                    {
                      claimId: "c3",
                      baseStatus: "contested",
                      needsCounterExplanation: true,
                      toneOverclaim: false,
                      recommendedAction: "add_contested",
                      reason: "争议性主张需要补充对立解释。",
                    },
                  ],
                }),
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
      const root = await fs.mkdtemp(path.join(os.tmpdir(), "histwrite-factcheck-judge-"));
      const layout = await ensureHistwriteProject(root);

      const claims = buildClaimMapV1([
        makeClaim({ claimId: "c1", kind: "fact", text: "这是一条已支持主张。" }),
        makeClaim({ claimId: "c2", kind: "causal", text: "这是一条推断主张。" }),
        makeClaim({ claimId: "c3", kind: "quote", text: "这是一条争议主张。" }),
      ]);

      const report = buildFactCheckReportV1({
        items: [
          { claimId: "c1", status: "supported", evidenceAlignment: "aligned", issues: [] },
          { claimId: "c2", status: "inference_ok", evidenceAlignment: "aligned", issues: [] },
          { claimId: "c3", status: "contested", evidenceAlignment: "ambiguous", issues: [] },
        ],
      });

      const out = await runFactCheckJudge({
        layout,
        claims,
        report,
        client: {
          apiBaseUrl: `http://127.0.0.1:${port}`,
          apiKey: "test-key",
          model: "judge-model",
          endpoint: "chat",
        },
      });

      expect(out.cacheHit).toBe(false);
      expect(out.items).toHaveLength(2);
      expect(out.items[0]).toMatchObject({
        claimId: "c2",
        recommendedAction: "downgrade",
        toneOverclaim: true,
      });
      expect(out.items[1]).toMatchObject({
        claimId: "c3",
        recommendedAction: "add_contested",
        needsCounterExplanation: true,
      });
      expect(requests).toHaveLength(1);
      expect(requests[0]).toContain("c2");
      expect(requests[0]).toContain("c3");
      expect(requests[0]).not.toContain("c1");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("throws when the model returns a claim outside the pending set", async () => {
    const server = createServer((req, res) => {
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
                content: JSON.stringify({
                  items: [
                    {
                      claimId: "outside",
                      baseStatus: "contested",
                      needsCounterExplanation: true,
                      toneOverclaim: false,
                      recommendedAction: "add_contested",
                      reason: "越界 claim",
                    },
                  ],
                }),
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
      const root = await fs.mkdtemp(path.join(os.tmpdir(), "histwrite-factcheck-judge-invalid-"));
      const layout = await ensureHistwriteProject(root);
      const claims = buildClaimMapV1([makeClaim({ claimId: "c2", kind: "causal", text: "这是一条推断主张。" })]);
      const report = buildFactCheckReportV1({
        items: [{ claimId: "c2", status: "inference_ok", evidenceAlignment: "aligned", issues: [] }],
      });

      await expect(
        runFactCheckJudge({
          layout,
          claims,
          report,
          client: {
            apiBaseUrl: `http://127.0.0.1:${port}`,
            apiKey: "test-key",
            model: "judge-model",
            endpoint: "chat",
          },
        }),
      ).rejects.toThrow(/outside the pending factcheck judge set/i);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("returns empty output without calling the model when no item needs arbitration", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "histwrite-factcheck-judge-empty-"));
    const layout = await ensureHistwriteProject(root);
    const claims = buildClaimMapV1([makeClaim({ claimId: "c1", kind: "fact", text: "这是一条已支持主张。" })]);
    const report = buildFactCheckReportV1({
      items: [{ claimId: "c1", status: "supported", evidenceAlignment: "aligned", issues: [] }],
    });

    const out = await runFactCheckJudge({
      layout,
      claims,
      report,
      client: {
        apiBaseUrl: "http://127.0.0.1:1",
        apiKey: "unused",
        model: "unused",
        endpoint: "chat",
      },
    });

    expect(out.items).toEqual([]);
    expect(out.cacheHit).toBe(false);
  });
});
