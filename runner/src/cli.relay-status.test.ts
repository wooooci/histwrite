import { execFile } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("histwrite runner cli relay status", () => {
  let server: ReturnType<typeof createServer> | null = null;

  afterEach(async () => {
    if (!server) return;
    await new Promise<void>((resolve, reject) => server!.close((err) => (err ? reject(err) : resolve())));
    server = null;
  });

  it("reads relay status and tabs from base url", async () => {
    server = createServer((req, res) => {
      if (req.url === "/extension/status") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ connected: true }));
        return;
      }
      if (req.url === "/tabs") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify([{ targetId: "t1", title: "Example", url: "https://example.com" }]));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", () => resolve()));
    const port = (server.address() as AddressInfo).port;

    const { stdout } = await execFileAsync(process.execPath, [
      "--import",
      "tsx",
      path.resolve("runner/src/cli.ts"),
      "relay",
      "status",
      "--relay",
      `http://127.0.0.1:${port}`,
    ]);

    const parsed = JSON.parse(stdout.trim()) as {
      ok: boolean;
      connected: boolean;
      tabs: Array<{ targetId: string; title?: string; url?: string }>;
    };

    expect(parsed.ok).toBe(true);
    expect(parsed.connected).toBe(true);
    expect(parsed.tabs[0]?.targetId).toBe("t1");
  });
});
