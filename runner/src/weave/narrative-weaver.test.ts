import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { describe, expect, it } from "vitest";

import { weaveNarrativeDraft } from "./narrative-weaver.js";

describe("weaveNarrativeDraft", () => {
  it("preserves all existing claim anchors while smoothing surrounding prose", async () => {
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
                  "首先交代背景。",
                  "〔claim:c1|kind=causal|ev=c1:c1〕税制改革推动了地方财政调整。〔/claim〕",
                  "于是下文顺势转入下一层论述。",
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
      const out = await weaveNarrativeDraft({
        draft: "〔claim:c1|kind=causal|ev=c1:c1〕税制改革推动了地方财政调整。〔/claim〕",
        client: {
          apiBaseUrl: `http://127.0.0.1:${port}`,
          apiKey: "test-key",
          model: "weave-model",
          endpoint: "chat",
        },
      });

      expect(out.wovenDraft).toContain("首先交代背景。");
      expect(out.anchorDiff.addedClaims).toBe(0);
      expect(out.anchorDiff.removedClaims).toBe(0);
      expect(out.anchorDiff.changedClaims).toBe(0);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("rejects output that introduces new claim anchors", async () => {
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
                  "〔claim:c1|kind=causal|ev=c1:c1〕税制改革推动了地方财政调整。〔/claim〕",
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
      await expect(
        weaveNarrativeDraft({
          draft: "〔claim:c1|kind=causal|ev=c1:c1〕税制改革推动了地方财政调整。〔/claim〕",
          client: {
            apiBaseUrl: `http://127.0.0.1:${port}`,
            apiKey: "test-key",
            model: "weave-model",
            endpoint: "chat",
          },
        }),
      ).rejects.toThrow(/introduced new claim anchors/i);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("rejects output that tampers with existing anchor metadata", async () => {
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
                content: "〔claim:c1|kind=chronology|ev=c1:c1〕税制改革推动了地方财政调整。〔/claim〕",
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
      await expect(
        weaveNarrativeDraft({
          draft: "〔claim:c1|kind=causal|ev=c1:c1〕税制改革推动了地方财政调整。〔/claim〕",
          client: {
            apiBaseUrl: `http://127.0.0.1:${port}`,
            apiKey: "test-key",
            model: "weave-model",
            endpoint: "chat",
          },
        }),
      ).rejects.toThrow(/tampered with existing claim anchors/i);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
