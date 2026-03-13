import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ensureHistwriteProject } from "../project.js";
import type { WorkOrderV1 } from "./schema.js";
import { applyRevisionWorkOrders } from "./revision.js";

describe("applyRevisionWorkOrders", () => {
  it("applies targeted rewrite instructions without adding new claims", async () => {
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
                content: "〔claim:c1|kind=causal|ev=c1:c1〕税制改革可能导致地方财政调整。〔/claim〕",
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
      const root = await fs.mkdtemp(path.join(os.tmpdir(), "histwrite-revision-"));
      const layout = await ensureHistwriteProject(root);
      const draft = "〔claim:c1|kind=causal|ev=c1:c1〕税制改革必然导致地方财政调整。〔/claim〕";
      const workOrders: WorkOrderV1[] = [
        {
          action: "downgrade",
          targetClaimId: "c1",
          instructions: "把确定语气降格为更审慎的推断。",
        },
      ];

      const out = await applyRevisionWorkOrders({
        layout,
        draft,
        workOrders,
        client: {
          apiBaseUrl: `http://127.0.0.1:${port}`,
          apiKey: "test-key",
          model: "revision-model",
          endpoint: "chat",
        },
      });

      expect(out.revisedDraft).toContain("可能导致");
      expect(out.diff.addedClaims).toBe(0);
      expect(out.applied).toBe(1);
      expect(requests).toHaveLength(1);
      expect(requests[0]).toContain("downgrade");
      expect(requests[0]).toContain("c1");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("returns the original draft when there are no work orders", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "histwrite-revision-empty-"));
    const layout = await ensureHistwriteProject(root);
    const draft = "〔claim:c1|kind=causal|ev=c1:c1〕税制改革导致地方财政调整。〔/claim〕";

    const out = await applyRevisionWorkOrders({
      layout,
      draft,
      workOrders: [],
      client: {
        apiBaseUrl: "http://127.0.0.1:1",
        apiKey: "unused",
        model: "unused",
        endpoint: "chat",
      },
    });

    expect(out.revisedDraft).toBe(draft);
    expect(out.applied).toBe(0);
    expect(out.diff.addedClaims).toBe(0);
  });

  it("rejects revisions that introduce new claim anchors", async () => {
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
                content: [
                  "〔claim:c1|kind=causal|ev=c1:c1〕税制改革可能导致地方财政调整。〔/claim〕",
                  "〔claim:c2|kind=causal|ev=c1:c1〕新增主张。〔/claim〕",
                ].join("\n"),
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
      const root = await fs.mkdtemp(path.join(os.tmpdir(), "histwrite-revision-added-"));
      const layout = await ensureHistwriteProject(root);

      await expect(
        applyRevisionWorkOrders({
          layout,
          draft: "〔claim:c1|kind=causal|ev=c1:c1〕税制改革导致地方财政调整。〔/claim〕",
          workOrders: [
            {
              action: "rewrite_span",
              targetClaimId: "c1",
              instructions: "只做局部修订，不要新增 claim。",
            },
          ],
          client: {
            apiBaseUrl: `http://127.0.0.1:${port}`,
            apiKey: "test-key",
            model: "revision-model",
            endpoint: "chat",
          },
        }),
      ).rejects.toThrow(/introduced new claims/i);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
