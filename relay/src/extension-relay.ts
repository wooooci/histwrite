import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";

import WebSocket, { WebSocketServer } from "ws";

import { rawDataToString } from "./ws.js";

type CdpCommand = {
  id: number;
  method: string;
  params?: unknown;
  sessionId?: string;
};

type CdpResponse = {
  id: number;
  result?: unknown;
  error?: { message: string };
  sessionId?: string;
};

type CdpEvent = {
  method: string;
  params?: unknown;
  sessionId?: string;
};

type ExtensionForwardCommandMessage = {
  id: number;
  method: "forwardCDPCommand";
  params: { method: string; params?: unknown; sessionId?: string };
};

type ExtensionResponseMessage = {
  id: number;
  result?: unknown;
  error?: string;
};

type ExtensionForwardEventMessage = {
  method: "forwardCDPEvent";
  params: { method: string; params?: unknown; sessionId?: string };
};

type ExtensionPingMessage = { method: "ping" };
type ExtensionPongMessage = { method: "pong" };

type ExtensionMessage =
  | ExtensionResponseMessage
  | ExtensionForwardEventMessage
  | ExtensionPongMessage;

type TargetInfo = {
  targetId: string;
  type?: string;
  title?: string;
  url?: string;
  attached?: boolean;
};

type AttachedToTargetEvent = {
  sessionId: string;
  targetInfo: TargetInfo;
  waitingForDebugger?: boolean;
};

type DetachedFromTargetEvent = {
  sessionId: string;
  targetId?: string;
};

type ConnectedTarget = {
  sessionId: string;
  targetId: string;
  targetInfo: TargetInfo;
};

type RelayHistoryKind = "annotation" | "cdp-command" | "extension-event";

type RelayHistoryEntry = {
  id: string;
  kind: RelayHistoryKind;
  createdAt: string;
  runId?: string;
  client?: string;
  label?: string;
  note?: string;
  method?: string;
  sessionId?: string;
  targetId?: string;
  title?: string;
  url?: string;
  data?: Record<string, unknown>;
};

type RelayClientMeta = {
  clientId: string;
  runId?: string;
  client?: string;
};

export type ChromeExtensionRelayServer = {
  host: string;
  port: number;
  baseUrl: string;
  cdpWsUrl: string;
  extensionConnected: () => boolean;
  stop: () => Promise<void>;
};

function isLoopbackHost(host: string) {
  const h = host.trim().toLowerCase();
  return (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h === "0.0.0.0" ||
    h === "[::1]" ||
    h === "::1" ||
    h === "[::]" ||
    h === "::"
  );
}

function isLoopbackAddress(ip: string | undefined): boolean {
  if (!ip) return false;
  if (ip === "127.0.0.1") return true;
  if (ip.startsWith("127.")) return true;
  if (ip === "::1") return true;
  if (ip.startsWith("::ffff:127.")) return true;
  return false;
}

function parseBaseUrl(raw: string): {
  host: string;
  port: number;
  baseUrl: string;
} {
  const parsed = new URL(raw.trim().replace(/\/$/, ""));
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`extension relay cdpUrl must be http(s), got ${parsed.protocol}`);
  }
  const host = parsed.hostname;
  const port =
    parsed.port?.trim() !== "" ? Number(parsed.port) : parsed.protocol === "https:" ? 443 : 80;
  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    throw new Error(`extension relay cdpUrl has invalid port: ${parsed.port || "(empty)"}`);
  }
  return { host, port, baseUrl: parsed.toString().replace(/\/$/, "") };
}

function text(res: Duplex, status: number, bodyText: string) {
  const body = Buffer.from(bodyText);
  res.write(
    `HTTP/1.1 ${status} ${status === 200 ? "OK" : "ERR"}\r\n` +
      "Content-Type: text/plain; charset=utf-8\r\n" +
      `Content-Length: ${body.length}\r\n` +
      "Connection: close\r\n" +
      "\r\n",
  );
  res.write(body);
  res.end();
}

function jsonResponse(res: ServerResponse, status: number, value: unknown) {
  const body = `${JSON.stringify(value)}\n`;
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

function rejectUpgrade(socket: Duplex, status: number, bodyText: string) {
  text(socket, status, bodyText);
  try {
    socket.destroy();
  } catch {
    // ignore
  }
}

function trimOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function clampHistoryLimit(raw: string | null | undefined): number {
  const fallback = 100;
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw.trim())) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(1, Math.min(500, parsed));
}

function sanitizeHistoryValue(value: unknown, depth = 0): unknown {
  if (depth >= 4) return "[truncated]";
  if (value == null) return value;
  if (typeof value === "string") {
    return value.length > 500 ? `${value.slice(0, 497)}...` : value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeHistoryValue(item, depth + 1));
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).slice(0, 20);
    return Object.fromEntries(
      entries.map(([key, item]) => [key, sanitizeHistoryValue(item, depth + 1)]),
    );
  }
  return String(value);
}

function summarizeHistoryData(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  const sanitized = sanitizeHistoryValue(value);
  if (sanitized == null) return undefined;
  if (Array.isArray(sanitized) || typeof sanitized !== "object") {
    return { value: sanitized };
  }
  return sanitized as Record<string, unknown>;
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > 1_000_000) {
      throw new Error("history body too large");
    }
    chunks.push(buf);
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return {};
  return JSON.parse(text) as unknown;
}

const serversByPort = new Map<number, ChromeExtensionRelayServer>();

export async function ensureChromeExtensionRelayServer(opts: {
  cdpUrl: string;
}): Promise<ChromeExtensionRelayServer> {
  const info = parseBaseUrl(opts.cdpUrl);
  if (!isLoopbackHost(info.host)) {
    throw new Error(`extension relay requires loopback cdpUrl host (got ${info.host})`);
  }

  const existing = serversByPort.get(info.port);
  if (existing) return existing;

  let extensionWs: WebSocket | null = null;
  const cdpClients = new Set<WebSocket>();
  const attachedTargetIdsByClient = new WeakMap<WebSocket, Set<string>>();
  const browserSessionIdByClient = new WeakMap<WebSocket, string>();
  const attachedSessionAliasesByClient = new WeakMap<
    WebSocket,
    Map<string, { realSessionId: string; targetId: string }>
  >();
  const connectedTargets = new Map<string, ConnectedTarget>();
  let nextBrowserSessionId = 1;
  let nextAliasSessionId = 1;

  const pendingExtension = new Map<
    number,
    {
      resolve: (v: unknown) => void;
      reject: (e: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  let nextExtensionId = 1;
  const historyEntries: RelayHistoryEntry[] = [];
  const clientMetaByClient = new WeakMap<WebSocket, RelayClientMeta>();
  let nextHistoryEntryId = 1;
  let nextCdpClientId = 1;

  const pushHistoryEntry = (
    entry: Omit<RelayHistoryEntry, "id" | "createdAt">,
  ): RelayHistoryEntry => {
    const created: RelayHistoryEntry = {
      id: `relay-history-${nextHistoryEntryId++}`,
      createdAt: new Date().toISOString(),
      ...entry,
    };
    historyEntries.push(created);
    if (historyEntries.length > 500) {
      historyEntries.splice(0, historyEntries.length - 500);
    }
    return created;
  };

  const getConnectedTargetByTargetId = (
    targetId: string | undefined,
  ): ConnectedTarget | undefined => {
    if (!targetId) return undefined;
    for (const target of connectedTargets.values()) {
      if (target.targetId === targetId) return target;
    }
    return undefined;
  };

  const getConnectedTargetForSession = (
    ws: WebSocket | null,
    sessionId: string | undefined,
  ): ConnectedTarget | undefined => {
    const resolved = ws ? resolveRealSessionId(ws, sessionId) : sessionId;
    if (!resolved) return undefined;
    return connectedTargets.get(resolved);
  };

  const summarizeCommandParams = (params: unknown): Record<string, unknown> | undefined => {
    return summarizeHistoryData(params);
  };

  const getOrCreateClientMeta = (ws: WebSocket, req?: IncomingMessage): RelayClientMeta => {
    const existing = clientMetaByClient.get(ws);
    if (existing) return existing;
    const parsedUrl = new URL(req?.url ?? "/cdp", info.baseUrl);
    const created: RelayClientMeta = {
      clientId: `cb-cdp-client-${nextCdpClientId++}`,
      runId: trimOptionalString(parsedUrl.searchParams.get("runId")),
      client: trimOptionalString(parsedUrl.searchParams.get("client")),
    };
    clientMetaByClient.set(ws, created);
    return created;
  };

  const describeEventTarget = (
    sessionId: string | undefined,
    params: unknown,
  ): { targetId?: string; title?: string; url?: string } => {
    const paramRecord =
      params && typeof params === "object" && !Array.isArray(params)
        ? (params as Record<string, unknown>)
        : undefined;
    const targetInfo =
      paramRecord?.targetInfo &&
      typeof paramRecord.targetInfo === "object" &&
      !Array.isArray(paramRecord.targetInfo)
        ? (paramRecord.targetInfo as Record<string, unknown>)
        : undefined;
    const targetId =
      trimOptionalString(targetInfo?.targetId) ?? trimOptionalString(paramRecord?.targetId);
    const target =
      getConnectedTargetByTargetId(targetId) ?? getConnectedTargetForSession(null, sessionId);
    return {
      targetId: targetId ?? target?.targetId,
      title: trimOptionalString(targetInfo?.title) ?? target?.targetInfo.title,
      url: trimOptionalString(targetInfo?.url) ?? target?.targetInfo.url,
    };
  };

  const recordExtensionEventHistory = (
    method: string,
    sessionId: string | undefined,
    params: unknown,
  ) => {
    const target = describeEventTarget(sessionId, params);
    pushHistoryEntry({
      kind: "extension-event",
      method,
      sessionId,
      targetId: target.targetId,
      title: target.title,
      url: target.url,
      data: summarizeCommandParams(params),
    });
  };

  const recordCdpCommandHistory = (
    ws: WebSocket,
    cmd: CdpCommand,
    outcome: "ok" | "error",
    errorMessage?: string,
  ) => {
    const meta = getOrCreateClientMeta(ws);
    const paramRecord =
      cmd.params && typeof cmd.params === "object" && !Array.isArray(cmd.params)
        ? (cmd.params as Record<string, unknown>)
        : undefined;
    const explicitTargetId = trimOptionalString(paramRecord?.targetId);
    const explicitUrl = trimOptionalString(paramRecord?.url);
    const resolvedSessionId = resolveRealSessionId(ws, cmd.sessionId) ?? cmd.sessionId;
    const target =
      getConnectedTargetByTargetId(explicitTargetId) ??
      getConnectedTargetForSession(ws, cmd.sessionId);
    pushHistoryEntry({
      kind: "cdp-command",
      runId: meta.runId,
      client: meta.client,
      method: cmd.method,
      sessionId: resolvedSessionId,
      targetId: explicitTargetId ?? target?.targetId,
      title: target?.targetInfo.title,
      url: explicitUrl ?? target?.targetInfo.url,
      note: outcome === "error" ? errorMessage : undefined,
      data: {
        clientId: meta.clientId,
        outcome,
        ...(summarizeCommandParams(cmd.params)
          ? { params: summarizeCommandParams(cmd.params) }
          : {}),
      },
    });
  };

  const sendToExtension = async (payload: ExtensionForwardCommandMessage): Promise<unknown> => {
    const ws = extensionWs;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error("Chrome extension not connected");
    }
    ws.send(JSON.stringify(payload));
    return await new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingExtension.delete(payload.id);
        reject(new Error(`extension request timeout: ${payload.params.method}`));
      }, 30_000);
      pendingExtension.set(payload.id, { resolve, reject, timer });
    });
  };

  const broadcastToCdpClients = (evt: CdpEvent) => {
    const msg = JSON.stringify(evt);
    for (const ws of cdpClients) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      ws.send(msg);
    }
  };

  const sendResponseToCdp = (ws: WebSocket, res: CdpResponse) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(res));
  };

  const clientAttachedTargets = (ws: WebSocket): Set<string> => {
    const existing = attachedTargetIdsByClient.get(ws);
    if (existing) return existing;
    const created = new Set<string>();
    attachedTargetIdsByClient.set(ws, created);
    return created;
  };

  const markTargetAttached = (ws: WebSocket, targetId: string) => {
    if (!targetId) return;
    clientAttachedTargets(ws).add(targetId);
  };

  const markTargetDetached = (ws: WebSocket, targetId: string) => {
    if (!targetId) return;
    clientAttachedTargets(ws).delete(targetId);
  };

  const clientBrowserSessionId = (ws: WebSocket): string => {
    const existing = browserSessionIdByClient.get(ws);
    if (existing) return existing;
    const created = `cb-browser-${nextBrowserSessionId++}`;
    browserSessionIdByClient.set(ws, created);
    return created;
  };

  const clientAttachedAliases = (ws: WebSocket) => {
    const existing = attachedSessionAliasesByClient.get(ws);
    if (existing) return existing;
    const created = new Map<string, { realSessionId: string; targetId: string }>();
    attachedSessionAliasesByClient.set(ws, created);
    return created;
  };

  const resolveRealSessionId = (
    ws: WebSocket,
    sessionId: string | undefined,
  ): string | undefined => {
    if (!sessionId) return undefined;
    const browserSessionId = browserSessionIdByClient.get(ws);
    if (browserSessionId && sessionId === browserSessionId) return undefined;
    const aliases = attachedSessionAliasesByClient.get(ws);
    const mapped = aliases?.get(sessionId);
    return mapped?.realSessionId ?? sessionId;
  };

  const ensureTargetEventsForClient = (ws: WebSocket, mode: "autoAttach" | "discover") => {
    const known = clientAttachedTargets(ws);
    for (const target of connectedTargets.values()) {
      const targetId = target.targetId;
      if (targetId && known.has(targetId)) continue;
      if (mode === "autoAttach") {
        ws.send(
          JSON.stringify({
            method: "Target.attachedToTarget",
            params: {
              sessionId: target.sessionId,
              targetInfo: { ...target.targetInfo, attached: true },
              waitingForDebugger: false,
            },
          } satisfies CdpEvent),
        );
        if (targetId) markTargetAttached(ws, targetId);
      } else {
        ws.send(
          JSON.stringify({
            method: "Target.targetCreated",
            params: { targetInfo: { ...target.targetInfo, attached: true } },
          } satisfies CdpEvent),
        );
        if (targetId) markTargetAttached(ws, targetId);
      }
    }
  };

  const routeCdpCommand = async (ws: WebSocket, cmd: CdpCommand): Promise<unknown> => {
    switch (cmd.method) {
      case "Browser.getVersion":
        return {
          protocolVersion: "1.3",
          product: "Chrome/Clawdbot-Extension-Relay",
          revision: "0",
          userAgent: "Clawdbot-Extension-Relay",
          jsVersion: "V8",
        };
      case "Browser.setDownloadBehavior":
        return {};
      case "Target.setAutoAttach":
      case "Target.setDiscoverTargets":
        return {};
      case "Target.attachToBrowserTarget": {
        return { sessionId: clientBrowserSessionId(ws) };
      }
      case "Target.getTargets":
        return {
          targetInfos: Array.from(connectedTargets.values()).map((t) => ({
            ...t.targetInfo,
            attached: true,
          })),
        };
      case "Target.getTargetInfo": {
        const params = (cmd.params ?? {}) as { targetId?: string };
        const targetId = typeof params.targetId === "string" ? params.targetId : undefined;
        if (targetId) {
          for (const t of connectedTargets.values()) {
            if (t.targetId === targetId) return { targetInfo: t.targetInfo };
          }
        }
        const realSessionId = resolveRealSessionId(ws, cmd.sessionId);
        if (realSessionId && connectedTargets.has(realSessionId)) {
          const t = connectedTargets.get(realSessionId);
          if (t) return { targetInfo: t.targetInfo };
        }
        const first = Array.from(connectedTargets.values())[0];
        return { targetInfo: first?.targetInfo };
      }
      case "Target.attachToTarget": {
        const params = (cmd.params ?? {}) as { targetId?: string };
        const targetId = typeof params.targetId === "string" ? params.targetId : undefined;
        if (!targetId) throw new Error("targetId required");
        for (const t of connectedTargets.values()) {
          if (t.targetId !== targetId) continue;
          const alias = `cb-session-${nextAliasSessionId++}`;
          clientAttachedAliases(ws).set(alias, { realSessionId: t.sessionId, targetId });
          markTargetAttached(ws, targetId);
          return { sessionId: alias };
        }
        throw new Error("target not found");
      }
      case "Target.detachFromTarget": {
        const params = (cmd.params ?? {}) as { sessionId?: string };
        const detachSessionId = typeof params.sessionId === "string" ? params.sessionId : undefined;
        if (detachSessionId) {
          clientAttachedAliases(ws).delete(detachSessionId);
        }
        return {};
      }
      default: {
        const id = nextExtensionId++;
        const realSessionId = resolveRealSessionId(ws, cmd.sessionId);
        return await sendToExtension({
          id,
          method: "forwardCDPCommand",
          params: {
            method: cmd.method,
            sessionId: realSessionId,
            params: cmd.params,
          },
        });
      }
    }
  };

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", info.baseUrl);
    const path = url.pathname;

    if (req.method === "HEAD" && path === "/") {
      res.writeHead(200);
      res.end();
      return;
    }

    if (path === "/") {
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("OK");
      return;
    }

    if (path === "/extension/status") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ connected: Boolean(extensionWs) }));
      return;
    }

    if (path === "/history" && req.method === "GET") {
      const limit = clampHistoryLimit(url.searchParams.get("limit"));
      const kind = trimOptionalString(url.searchParams.get("kind"));
      const runId = trimOptionalString(url.searchParams.get("runId"));
      const client = trimOptionalString(url.searchParams.get("client"));
      const filtered = historyEntries.filter((entry) => {
        if (kind && entry.kind !== kind) return false;
        if (runId && entry.runId !== runId) return false;
        if (client && entry.client !== client) return false;
        return true;
      });
      const entries = filtered.slice(Math.max(0, filtered.length - limit)).reverse();
      jsonResponse(res, 200, {
        entries,
        total: filtered.length,
        limit,
        filters: { kind, runId, client },
      });
      return;
    }

    if (path === "/history" && req.method === "POST") {
      void (async () => {
        try {
          const payload = await readJsonBody(req);
          if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
            jsonResponse(res, 400, { error: "history body must be a JSON object" });
            return;
          }
          const body = payload as Record<string, unknown>;
          const entry = pushHistoryEntry({
            kind: "annotation",
            runId: trimOptionalString(body.runId),
            client: trimOptionalString(body.client),
            label: trimOptionalString(body.label),
            note: trimOptionalString(body.note),
            data: summarizeHistoryData(body.data),
          });
          jsonResponse(res, 201, { ok: true, entry });
        } catch (err) {
          jsonResponse(res, 400, { error: err instanceof Error ? err.message : String(err) });
        }
      })();
      return;
    }

    if (path === "/tabs" && req.method === "GET") {
      const tabs = Array.from(connectedTargets.values()).map((t) => ({
        sessionId: t.sessionId,
        targetId: t.targetId,
        type: t.targetInfo.type ?? "page",
        title: t.targetInfo.title ?? "",
        url: t.targetInfo.url ?? "",
      }));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ tabs }));
      return;
    }

    if (path === "/snapshot" && req.method === "GET") {
      if (!extensionWs) {
        jsonResponse(res, 409, { error: "Extension not connected" });
        return;
      }

      const wantPng = url.searchParams.get("png") !== "0";
      const wantText = url.searchParams.get("text") !== "0";
      const maxCharsRaw = url.searchParams.get("maxChars")?.trim();
      const maxChars =
        maxCharsRaw && /^\d+$/.test(maxCharsRaw) ? Number.parseInt(maxCharsRaw, 10) : 200_000;
      const maxCharsClamped = Math.max(0, Math.min(2_000_000, maxChars));

      const requestedTargetId = url.searchParams.get("targetId")?.trim() ?? "";
      const targets = Array.from(connectedTargets.values());
      const selected = requestedTargetId
        ? (targets.find((t) => t.targetId === requestedTargetId) ?? null)
        : targets.length
          ? (targets[targets.length - 1] ?? null)
          : null;

      if (!selected) {
        jsonResponse(res, requestedTargetId ? 404 : 409, {
          error: requestedTargetId ? "targetId not found" : "No attached tabs",
        });
        return;
      }

      void (async () => {
        try {
          let pngBase64: string | null = null;
          if (wantPng) {
            const result = (await sendToExtension({
              id: nextExtensionId++,
              method: "forwardCDPCommand",
              params: {
                method: "Page.captureScreenshot",
                sessionId: selected.sessionId,
                params: { format: "png" },
              },
            })) as unknown;
            if (
              result &&
              typeof result === "object" &&
              "data" in result &&
              typeof (result as { data?: unknown }).data === "string"
            ) {
              pngBase64 = (result as { data: string }).data;
            }
          }

          let textContent: string | null = null;
          if (wantText) {
            await sendToExtension({
              id: nextExtensionId++,
              method: "forwardCDPCommand",
              params: { method: "Runtime.enable", sessionId: selected.sessionId },
            }).catch(() => {});

            const expression = `(() => { try { const t = document.body ? document.body.innerText : ""; return t.slice(0, ${maxCharsClamped}); } catch { return ""; } })()`;
            const evalResult = (await sendToExtension({
              id: nextExtensionId++,
              method: "forwardCDPCommand",
              params: {
                method: "Runtime.evaluate",
                sessionId: selected.sessionId,
                params: { expression, returnByValue: true, awaitPromise: true, userGesture: true },
              },
            })) as unknown;

            const value =
              evalResult &&
              typeof evalResult === "object" &&
              "result" in evalResult &&
              (evalResult as { result?: unknown }).result &&
              typeof (evalResult as { result?: { value?: unknown } }).result?.value === "string"
                ? ((evalResult as { result: { value: string } }).result.value as string)
                : null;
            textContent = value ?? "";
          }

          jsonResponse(res, 200, {
            ok: true,
            capturedAt: new Date().toISOString(),
            tab: {
              sessionId: selected.sessionId,
              targetId: selected.targetId,
              title: selected.targetInfo.title ?? "",
              url: selected.targetInfo.url ?? "",
            },
            pngBase64,
            text: textContent,
          });
        } catch (err) {
          jsonResponse(res, 500, { error: err instanceof Error ? err.message : String(err) });
        }
      })();
      return;
    }

    const hostHeader = req.headers.host?.trim() || `${info.host}:${info.port}`;
    const wsHost = `ws://${hostHeader}`;
    const cdpWsUrl = `${wsHost}/cdp`;

    if (
      (path === "/json/version" || path === "/json/version/") &&
      (req.method === "GET" || req.method === "PUT")
    ) {
      const payload: Record<string, unknown> = {
        Browser: "Clawdbot/extension-relay",
        "Protocol-Version": "1.3",
      };
      // Only advertise the WS URL if a real extension is connected.
      if (extensionWs) payload.webSocketDebuggerUrl = cdpWsUrl;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload));
      return;
    }

    const listPaths = new Set(["/json", "/json/", "/json/list", "/json/list/"]);
    if (listPaths.has(path) && (req.method === "GET" || req.method === "PUT")) {
      const list = Array.from(connectedTargets.values()).map((t) => ({
        id: t.targetId,
        type: t.targetInfo.type ?? "page",
        title: t.targetInfo.title ?? "",
        description: t.targetInfo.title ?? "",
        url: t.targetInfo.url ?? "",
        webSocketDebuggerUrl: cdpWsUrl,
        devtoolsFrontendUrl: `/devtools/inspector.html?ws=${cdpWsUrl.replace("ws://", "")}`,
      }));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(list));
      return;
    }

    const activateMatch = path.match(/^\/json\/activate\/(.+)$/);
    if (activateMatch && (req.method === "GET" || req.method === "PUT")) {
      const targetId = decodeURIComponent(activateMatch[1] ?? "").trim();
      if (!targetId) {
        res.writeHead(400);
        res.end("targetId required");
        return;
      }
      void (async () => {
        try {
          await sendToExtension({
            id: nextExtensionId++,
            method: "forwardCDPCommand",
            params: { method: "Target.activateTarget", params: { targetId } },
          });
        } catch {
          // ignore
        }
      })();
      res.writeHead(200);
      res.end("OK");
      return;
    }

    const closeMatch = path.match(/^\/json\/close\/(.+)$/);
    if (closeMatch && (req.method === "GET" || req.method === "PUT")) {
      const targetId = decodeURIComponent(closeMatch[1] ?? "").trim();
      if (!targetId) {
        res.writeHead(400);
        res.end("targetId required");
        return;
      }
      void (async () => {
        try {
          await sendToExtension({
            id: nextExtensionId++,
            method: "forwardCDPCommand",
            params: { method: "Target.closeTarget", params: { targetId } },
          });
        } catch {
          // ignore
        }
      })();
      res.writeHead(200);
      res.end("OK");
      return;
    }

    res.writeHead(404);
    res.end("not found");
  });

  const wssExtension = new WebSocketServer({ noServer: true });
  const wssCdp = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", info.baseUrl);
    const pathname = url.pathname;
    const remote = req.socket.remoteAddress;

    if (!isLoopbackAddress(remote)) {
      rejectUpgrade(socket, 403, "Forbidden");
      return;
    }

    if (pathname === "/extension") {
      if (extensionWs) {
        rejectUpgrade(socket, 409, "Extension already connected");
        return;
      }
      wssExtension.handleUpgrade(req, socket, head, (ws) => {
        wssExtension.emit("connection", ws, req);
      });
      return;
    }

    if (pathname === "/cdp") {
      if (!extensionWs) {
        rejectUpgrade(socket, 503, "Extension not connected");
        return;
      }
      wssCdp.handleUpgrade(req, socket, head, (ws) => {
        wssCdp.emit("connection", ws, req);
      });
      return;
    }

    rejectUpgrade(socket, 404, "Not Found");
  });

  wssExtension.on("connection", (ws) => {
    extensionWs = ws;

    const ping = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ method: "ping" } satisfies ExtensionPingMessage));
    }, 5000);

    ws.on("message", (data) => {
      let parsed: ExtensionMessage | null = null;
      try {
        parsed = JSON.parse(rawDataToString(data)) as ExtensionMessage;
      } catch {
        return;
      }

      if (parsed && typeof parsed === "object" && "id" in parsed && typeof parsed.id === "number") {
        const pending = pendingExtension.get(parsed.id);
        if (!pending) return;
        pendingExtension.delete(parsed.id);
        clearTimeout(pending.timer);
        if ("error" in parsed && typeof parsed.error === "string" && parsed.error.trim()) {
          pending.reject(new Error(parsed.error));
        } else {
          pending.resolve((parsed as ExtensionResponseMessage).result);
        }
        return;
      }

      if (parsed && typeof parsed === "object" && "method" in parsed) {
        if ((parsed as ExtensionPongMessage).method === "pong") return;
        if ((parsed as ExtensionForwardEventMessage).method !== "forwardCDPEvent") return;
        const evt = parsed as ExtensionForwardEventMessage;
        const method = evt.params?.method;
        const params = evt.params?.params;
        const sessionId = evt.params?.sessionId;
        if (!method || typeof method !== "string") return;

        if (method === "Target.attachedToTarget") {
          const attached = (params ?? {}) as AttachedToTargetEvent;
          const targetType = attached?.targetInfo?.type ?? "page";
          if (targetType !== "page") return;
          if (attached?.sessionId && attached?.targetInfo?.targetId) {
            const prev = connectedTargets.get(attached.sessionId);
            const nextTargetId = attached.targetInfo.targetId;
            const prevTargetId = prev?.targetId;
            const changedTarget = Boolean(prev && prevTargetId && prevTargetId !== nextTargetId);
            connectedTargets.set(attached.sessionId, {
              sessionId: attached.sessionId,
              targetId: nextTargetId,
              targetInfo: attached.targetInfo,
            });
            if (changedTarget && prevTargetId) {
              for (const client of cdpClients) markTargetDetached(client, prevTargetId);
              broadcastToCdpClients({
                method: "Target.detachedFromTarget",
                params: { sessionId: attached.sessionId, targetId: prevTargetId },
                sessionId: attached.sessionId,
              });
            }
            if (!prev || changedTarget) {
              for (const client of cdpClients) markTargetAttached(client, nextTargetId);
              broadcastToCdpClients({ method, params, sessionId });
            }
            recordExtensionEventHistory(method, sessionId, params);
            return;
          }
        }

        if (method === "Target.detachedFromTarget") {
          const detached = (params ?? {}) as DetachedFromTargetEvent;
          const sessionId = detached?.sessionId;
          const prevTargetId = sessionId ? connectedTargets.get(sessionId)?.targetId : undefined;
          if (sessionId) connectedTargets.delete(sessionId);
          const targetId =
            typeof detached?.targetId === "string" ? detached.targetId : prevTargetId;
          if (targetId) {
            for (const client of cdpClients) markTargetDetached(client, targetId);
          }
          broadcastToCdpClients({ method, params, sessionId });
          recordExtensionEventHistory(method, sessionId, params);
          return;
        }

        // Keep cached tab metadata fresh for /json/list.
        // After navigation, Chrome updates URL/title via Target.targetInfoChanged.
        if (method === "Target.targetInfoChanged") {
          const changed = (params ?? {}) as { targetInfo?: { targetId?: string; type?: string } };
          const targetInfo = changed?.targetInfo;
          const targetId = targetInfo?.targetId;
          if (targetId && (targetInfo?.type ?? "page") === "page") {
            for (const [sid, target] of connectedTargets) {
              if (target.targetId !== targetId) continue;
              connectedTargets.set(sid, {
                ...target,
                targetInfo: { ...target.targetInfo, ...(targetInfo as object) },
              });
            }
          }
        }

        broadcastToCdpClients({ method, params, sessionId });
        recordExtensionEventHistory(method, sessionId, params);
      }
    });

    ws.on("close", () => {
      clearInterval(ping);
      extensionWs = null;
      for (const [, pending] of pendingExtension) {
        clearTimeout(pending.timer);
        pending.reject(new Error("extension disconnected"));
      }
      pendingExtension.clear();
      connectedTargets.clear();

      for (const client of cdpClients) {
        try {
          client.close(1011, "extension disconnected");
        } catch {
          // ignore
        }
      }
      cdpClients.clear();
    });
  });

  wssCdp.on("connection", (ws, req) => {
    cdpClients.add(ws);
    clientAttachedTargets(ws);
    getOrCreateClientMeta(ws, req);

    ws.on("message", async (data) => {
      let cmd: CdpCommand | null = null;
      try {
        cmd = JSON.parse(rawDataToString(data)) as CdpCommand;
      } catch {
        return;
      }
      if (!cmd || typeof cmd !== "object") return;
      if (typeof cmd.id !== "number" || typeof cmd.method !== "string") return;

      if (!extensionWs) {
        sendResponseToCdp(ws, {
          id: cmd.id,
          sessionId: cmd.sessionId,
          error: { message: "Extension not connected" },
        });
        return;
      }

      try {
        const result = await routeCdpCommand(ws, cmd);

        if (cmd.method === "Target.setAutoAttach" && !cmd.sessionId) {
          ensureTargetEventsForClient(ws, "autoAttach");
        }
        if (cmd.method === "Target.setDiscoverTargets") {
          const discover = (cmd.params ?? {}) as { discover?: boolean };
          if (discover.discover === true) {
            ensureTargetEventsForClient(ws, "discover");
          }
        }
        recordCdpCommandHistory(ws, cmd, "ok");
        sendResponseToCdp(ws, { id: cmd.id, sessionId: cmd.sessionId, result });
      } catch (err) {
        recordCdpCommandHistory(ws, cmd, "error", err instanceof Error ? err.message : String(err));
        sendResponseToCdp(ws, {
          id: cmd.id,
          sessionId: cmd.sessionId,
          error: { message: err instanceof Error ? err.message : String(err) },
        });
      }
    });

    ws.on("close", () => {
      cdpClients.delete(ws);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(info.port, info.host, () => resolve());
    server.once("error", reject);
  });

  const addr = server.address() as AddressInfo | null;
  const port = addr?.port ?? info.port;
  const host = info.host;
  const baseUrl = `${new URL(info.baseUrl).protocol}//${host}:${port}`;

  const relay: ChromeExtensionRelayServer = {
    host,
    port,
    baseUrl,
    cdpWsUrl: `ws://${host}:${port}/cdp`,
    extensionConnected: () => Boolean(extensionWs),
    stop: async () => {
      serversByPort.delete(port);
      try {
        extensionWs?.close(1001, "server stopping");
      } catch {
        // ignore
      }
      for (const ws of cdpClients) {
        try {
          ws.close(1001, "server stopping");
        } catch {
          // ignore
        }
      }
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
      wssExtension.close();
      wssCdp.close();
    },
  };

  serversByPort.set(port, relay);
  return relay;
}

export async function stopChromeExtensionRelayServer(opts: { cdpUrl: string }): Promise<boolean> {
  const info = parseBaseUrl(opts.cdpUrl);
  const existing = serversByPort.get(info.port);
  if (!existing) return false;
  await existing.stop();
  return true;
}
