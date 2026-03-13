import fs from "node:fs";
import path from "node:path";

import { readArg, trimOptionalString } from "./cdp.js";

export type RelayHistoryEntry = {
  id?: string;
  kind?: string;
  createdAt?: string;
  client?: string;
  runId?: string;
  label?: string;
  note?: string;
  method?: string;
  sessionId?: string;
  targetId?: string;
  title?: string;
  url?: string;
  data?: Record<string, unknown>;
};

type RelayHistorySummary = {
  totalEntries: number;
  byKind: Record<string, number>;
  byMethod: Record<string, number>;
  urls: string[];
  notes: string[];
};

type RelayHistoryResponse = {
  entries?: RelayHistoryEntry[];
  total?: number;
  limit?: number;
  error?: string;
  skipped?: boolean;
};

function deriveHistoryUrlFromCdp(cdpWsUrl: string): string | null {
  try {
    const parsed = new URL(cdpWsUrl);
    parsed.protocol = parsed.protocol === "wss:" ? "https:" : "http:";
    parsed.pathname = parsed.pathname.replace(/\/cdp\/?$/, "/history");
    if (!parsed.pathname.endsWith("/history")) parsed.pathname = "/history";
    parsed.search = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

function buildTaggedCdpWsUrl(cdpWsUrl: string, runId: string | null, client: string | null): string {
  const parsed = new URL(cdpWsUrl);
  if (runId) parsed.searchParams.set("runId", runId);
  if (client) parsed.searchParams.set("client", client);
  return parsed.toString();
}

function buildHistoryQuery(params: {
  runId: string | null;
  client: string | null;
  kind?: string | null;
  limit: number;
}): string {
  const query = new URLSearchParams();
  if (params.runId) query.set("runId", params.runId);
  if (params.client) query.set("client", params.client);
  if (params.kind) query.set("kind", params.kind);
  query.set("limit", String(params.limit));
  return query.toString();
}

function summarizeEntries(entries: RelayHistoryEntry[]): RelayHistorySummary {
  const byKind: Record<string, number> = {};
  const byMethod: Record<string, number> = {};
  const urls: string[] = [];
  const notes: string[] = [];

  for (const entry of entries) {
    const kind = trimOptionalString(entry.kind) || "unknown";
    byKind[kind] = (byKind[kind] || 0) + 1;

    const method = trimOptionalString(entry.method);
    if (method) byMethod[method] = (byMethod[method] || 0) + 1;

    const url = trimOptionalString(entry.url);
    if (url && !urls.includes(url)) urls.push(url);

    const note = trimOptionalString(entry.note);
    if (note) notes.push(note);
  }

  return {
    totalEntries: entries.length,
    byKind,
    byMethod,
    urls: urls.slice(0, 12),
    notes: notes.slice(0, 20),
  };
}

function formatEntryLine(entry: RelayHistoryEntry): string {
  const stamp = trimOptionalString(entry.createdAt) || "?";
  const kind = trimOptionalString(entry.kind) || "unknown";
  const method = trimOptionalString(entry.method);
  const note = trimOptionalString(entry.note);
  const label = trimOptionalString(entry.label);
  const url = trimOptionalString(entry.url);
  const bits = [stamp, kind];
  if (method) bits.push(method);
  if (label) bits.push(label);
  if (note) bits.push(note);
  if (url) bits.push(url);
  return `- ${bits.join(" | ")}`;
}

function toMarkdownReport(params: {
  title?: string;
  runId: string | null;
  client: string | null;
  historyUrl: string | null;
  summary: RelayHistorySummary;
  entries: RelayHistoryEntry[];
  extra?: Record<string, unknown> | null;
}): string {
  const lines: string[] = [];
  lines.push(`# ${params.title || "检索报告"}`);
  lines.push("");
  lines.push(`生成时间：${new Date().toLocaleString("zh-CN", { hour12: false })}`);
  if (params.runId) lines.push(`runId：\`${params.runId}\``);
  if (params.client) lines.push(`client：\`${params.client}\``);
  if (params.historyUrl) lines.push(`history：${params.historyUrl}`);
  lines.push("");
  lines.push("## 摘要");
  lines.push("");
  lines.push(`- 总条目：${params.summary.totalEntries}`);
  lines.push(
    `- 类型分布：${Object.entries(params.summary.byKind).map(([key, value]) => `${key}=${value}`).join("；") || "无"}`,
  );
  lines.push(
    `- 方法分布：${Object.entries(params.summary.byMethod).map(([key, value]) => `${key}=${value}`).join("；") || "无"}`,
  );
  if (params.summary.urls.length > 0) {
    lines.push(`- 关键 URL：${params.summary.urls.join("；")}`);
  }
  if (params.extra && Object.keys(params.extra).length > 0) {
    lines.push("");
    lines.push("## 附加信息");
    lines.push("");
    for (const [key, value] of Object.entries(params.extra)) {
      lines.push(`- ${key}：${typeof value === "string" ? value : JSON.stringify(value)}`);
    }
  }
  lines.push("");
  lines.push("## 时间线");
  lines.push("");
  if (params.entries.length === 0) {
    lines.push("- （无历史条目）");
  } else {
    for (const entry of params.entries) lines.push(formatEntryLine(entry));
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function readJsonResponse<T>(res: Response, fallback: T): Promise<T> {
  const text = await res.text().catch(() => "");
  if (!text.trim()) return fallback;
  return JSON.parse(text) as T;
}

export function summarizeError(error: unknown): string {
  if (!error) return "unknown error";
  if (error instanceof Error) return error.message || String(error);
  return String(error);
}

export function createRelayHistoryReporter(params: {
  args?: string[];
  defaultCdpWsUrl: string;
  defaultClient?: string | null;
  defaultRunId?: string | null;
  defaultHistoryUrl?: string | null;
}) {
  const args = params.args ?? process.argv.slice(2);
  const runId =
    trimOptionalString(readArg(args, "--run-id", null)) ||
    trimOptionalString(process.env.RELAY_RUN_ID) ||
    trimOptionalString(params.defaultRunId) ||
    null;
  const client =
    trimOptionalString(readArg(args, "--client", null)) ||
    trimOptionalString(process.env.RELAY_CLIENT) ||
    trimOptionalString(params.defaultClient) ||
    null;
  const cdpWsUrlRaw =
    trimOptionalString(readArg(args, "--cdp-ws-url", null)) ||
    trimOptionalString(process.env.CDP_WS_URL) ||
    trimOptionalString(params.defaultCdpWsUrl);

  if (!cdpWsUrlRaw) {
    throw new Error("createRelayHistoryReporter requires a CDP websocket URL");
  }

  const historyUrl =
    trimOptionalString(readArg(args, "--relay-http-url", null)) ||
    trimOptionalString(process.env.RELAY_HTTP_URL) ||
    trimOptionalString(params.defaultHistoryUrl) ||
    deriveHistoryUrlFromCdp(cdpWsUrlRaw);
  const cdpWsUrl = buildTaggedCdpWsUrl(cdpWsUrlRaw, runId, client);
  const strict = process.env.RELAY_HISTORY_STRICT === "1";

  return {
    runId,
    client,
    cdpWsUrl,
    historyUrl,
    summarizeError,
    async annotate(payload: {
      label?: string | null;
      note?: string | null;
      data?: Record<string, unknown> | null;
    } = {}) {
      if (!historyUrl) return { ok: false, skipped: true, reason: "history url unavailable" };
      const body = {
        ...(runId ? { runId } : {}),
        ...(client ? { client } : {}),
        ...(payload.label ? { label: payload.label } : {}),
        ...(payload.note ? { note: payload.note } : {}),
        ...(payload.data && typeof payload.data === "object" ? { data: payload.data } : {}),
      };
      try {
        const res = await fetch(historyUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const message = await res.text().catch(() => "");
          throw new Error(`history post failed (${res.status}): ${message || res.statusText}`);
        }
        return await readJsonResponse<Record<string, unknown>>(res, { ok: true });
      } catch (error) {
        if (strict) throw error;
        const message = summarizeError(error);
        console.warn(`[relay-history] warn: ${message}`);
        return { ok: false, skipped: true, error: message };
      }
    },
    async fetchHistory(params: { kind?: string | null; limit?: number } = {}): Promise<RelayHistoryResponse> {
      if (!historyUrl) return { entries: [], total: 0, limit: params.limit ?? 200 };
      const limit = params.limit ?? 200;
      const query = buildHistoryQuery({ runId, client, kind: params.kind ?? null, limit });
      const url = `${historyUrl}${query ? `?${query}` : ""}`;
      try {
        const res = await fetch(url);
        if (!res.ok) {
          const message = await res.text().catch(() => "");
          throw new Error(`history fetch failed (${res.status}): ${message || res.statusText}`);
        }
        return await readJsonResponse<RelayHistoryResponse>(res, { entries: [], total: 0, limit });
      } catch (error) {
        if (strict) throw error;
        const message = summarizeError(error);
        console.warn(`[relay-history] warn: ${message}`);
        return { entries: [], total: 0, limit, error: message, skipped: true };
      }
    },
    async writeSearchReport(params: {
      outDir: string;
      baseName: string;
      title?: string;
      extra?: Record<string, unknown> | null;
      limit?: number;
    }) {
      const history = await this.fetchHistory({ limit: params.limit ?? 200 });
      const rawEntries = Array.isArray(history.entries) ? history.entries : [];
      const entries = [...rawEntries].reverse();
      const summary = summarizeEntries(entries);
      const report = {
        generatedAt: new Date().toISOString(),
        title: params.title || "检索报告",
        runId,
        client,
        historyUrl,
        limit: params.limit ?? 200,
        summary,
        extra: params.extra && typeof params.extra === "object" ? params.extra : null,
        entries,
      };
      const jsonPath = path.join(params.outDir, `${params.baseName}.search-report.json`);
      const mdPath = path.join(params.outDir, `${params.baseName}.search-report.md`);
      fs.mkdirSync(params.outDir, { recursive: true });
      fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
      fs.writeFileSync(
        mdPath,
        toMarkdownReport({
          title: report.title,
          runId,
          client,
          historyUrl,
          summary,
          entries,
          extra: report.extra,
        }),
        "utf8",
      );
      return { jsonPath, mdPath, report };
    },
  };
}
