import { startCodexBrowserRelayServer } from "./src/server.js";

function readNumberArg(flag: string): number | null {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  const raw = process.argv[idx + 1];
  const n = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n)) return null;
  return n;
}

const port = readNumberArg("--port") ?? 18792;

await startCodexBrowserRelayServer({ port });
// Keep process alive; the relay server runs in the background.
await new Promise(() => {});

