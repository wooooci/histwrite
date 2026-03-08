import { ensureChromeExtensionRelayServer, stopChromeExtensionRelayServer } from "./extension-relay.js";

export type CodexBrowserRelay = {
  cdpUrl: string;
  port: number;
  baseUrl: string;
  cdpWsUrl: string;
  extensionConnected: () => boolean;
  stop: () => Promise<void>;
};

export async function startCodexBrowserRelayServer(params: { port: number }): Promise<CodexBrowserRelay> {
  const cdpUrl = `http://127.0.0.1:${params.port}`;
  const relay = await ensureChromeExtensionRelayServer({ cdpUrl });
  return { cdpUrl, ...relay };
}

export async function stopCodexBrowserRelayServer(params: { cdpUrl: string }): Promise<boolean> {
  return await stopChromeExtensionRelayServer({ cdpUrl });
}

