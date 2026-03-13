import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { captureRelaySnapshot } from "./capture.js";
import { ensureHistwriteProject } from "./project.js";

describe("captureRelaySnapshot", () => {
  it("writes snapshot artifacts into the project index dir", async () => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== "/snapshot") {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(
        JSON.stringify({
          ok: true,
          capturedAt: "2026-02-15T00:00:00.000Z",
          tab: { sessionId: "cb-tab-1", targetId: "t1", title: "Example", url: "https://example.com" },
          pngBase64: "dGVzdA==",
          text: "hello",
        }),
      );
    });

    const port = await new Promise<number>((resolve, reject) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address() as AddressInfo;
        resolve(addr.port);
      });
      server.once("error", reject);
    });

    try {
      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), `histwrite-capture-${randomUUID()}-`));
      const layout = await ensureHistwriteProject(path.join(tmp, "proj"));

      const result = await captureRelaySnapshot({
        layout,
        relayBaseUrl: `http://127.0.0.1:${port}`,
        outDir: path.join(layout.materialsIndexDir, "snapshots"),
      });

      expect(result.tab.targetId).toBe("t1");
      expect(await fs.readFile(result.metaPath, "utf8")).toContain("\"targetId\": \"t1\"");
      expect(result.textPath).toBeTruthy();
      expect(result.pngPath).toBeTruthy();
      expect(result.textPath ? await fs.readFile(result.textPath, "utf8") : "").toContain("hello");
      expect(result.pngPath ? (await fs.readFile(result.pngPath)).length : 0).toBeGreaterThan(0);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("falls back to relay port 18992 when relay base url is blank", async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          capturedAt: "2026-02-15T00:00:00.000Z",
          tab: { sessionId: "cb-tab-2", targetId: "t2", title: "Blank Relay", url: "https://example.com/blank" },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json; charset=utf-8" },
        },
      ),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    try {
      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), `histwrite-capture-default-relay-${randomUUID()}-`));
      const layout = await ensureHistwriteProject(path.join(tmp, "proj"));

      await captureRelaySnapshot({
        layout,
        relayBaseUrl: "   ",
        includePng: false,
        includeText: false,
        outDir: path.join(layout.materialsIndexDir, "snapshots"),
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(String(fetchMock.mock.calls[0]?.[0] ?? "")).toContain("http://127.0.0.1:18992/snapshot");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
