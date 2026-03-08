import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { startCodexBrowserRelayServer, stopCodexBrowserRelayServer } from "./server.js";

async function getFreePort(): Promise<number> {
  while (true) {
    const port = await new Promise<number>((resolve, reject) => {
      const s = createServer();
      s.once("error", reject);
      s.listen(0, "127.0.0.1", () => {
        const assigned = (s.address() as AddressInfo).port;
        s.close((err) => (err ? reject(err) : resolve(assigned)));
      });
    });
    if (port < 65535) return port;
  }
}

describe("codex browser relay server", () => {
  let cdpUrl = "";

  afterEach(async () => {
    if (!cdpUrl) return;
    await stopCodexBrowserRelayServer({ cdpUrl }).catch(() => {});
    cdpUrl = "";
  });

  it("serves HEAD / and reports extension disconnected by default", async () => {
    const port = await getFreePort();
    const relay = await startCodexBrowserRelayServer({ port });
    cdpUrl = relay.cdpUrl;

    const head = await fetch(`${cdpUrl}/`, { method: "HEAD" });
    expect(head.status).toBe(200);

    const status = (await fetch(`${cdpUrl}/extension/status`).then((r) => r.json())) as {
      connected?: boolean;
    };
    expect(status.connected).toBe(false);
  });
});

