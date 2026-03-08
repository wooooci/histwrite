import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";

import { normalizeOpenAiCompatBaseUrl } from "./openai-compat.js";
import { cacheKey, createCasCache } from "./cache.js";
import type { CasCache } from "./cache.js";

export type OpenAiCompatProxyConfig = {
  listenHost: string;
  port: number;
  upstreamBaseUrl: string;
  upstreamApiKey: string;
  defaultModel?: string;
  forceModel?: boolean;
  timeoutMs?: number;
  cacheDir?: string;
};

function setCors(res: ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function toText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts = content
      .map((p) => {
        if (typeof p === "string") return p;
        if (p && typeof p === "object") {
          const t = (p as any).text;
          if (typeof t === "string") return t;
        }
        try {
          return JSON.stringify(p);
        } catch {
          return String(p);
        }
      })
      .filter(Boolean);
    return parts.join("");
  }
  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
}

async function readBodyUtf8(req: IncomingMessage, maxBytes = 10_000_000): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const c of req) {
    const b = Buffer.from(c);
    total += b.length;
    if (total > maxBytes) throw new Error("request body too large");
    chunks.push(b);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseResponsesSseToText(raw: string): string {
  let out = "";
  let sawDelta = false;
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const data = trimmed.slice("data:".length).trim();
    if (!data || data === "[DONE]") continue;
    let obj: any;
    try {
      obj = JSON.parse(data) as unknown;
    } catch {
      continue;
    }
    if (typeof obj?.delta === "string") {
      out += obj.delta;
      sawDelta = true;
      continue;
    }
    if (!sawDelta && typeof obj?.text === "string" && typeof obj?.type === "string" && /output_text/i.test(obj.type)) {
      out = obj.text;
      continue;
    }
    if (!sawDelta && typeof obj?.output_text === "string") {
      out = obj.output_text;
      continue;
    }
  }
  return out;
}

async function callUpstreamResponses(params: {
  upstreamBaseUrl: string;
  upstreamApiKey: string;
  model: string;
  input: unknown[];
  temperature: number;
  maxOutputTokens: number | null;
  timeoutMs: number;
}): Promise<{ text: string; model: string }> {
  const base = normalizeOpenAiCompatBaseUrl(params.upstreamBaseUrl);
  if (!base) throw new Error("upstreamBaseUrl required");
  const url = `${base}/responses`;

  const body: any = {
    model: params.model,
    input: params.input,
    stream: true,
    temperature: params.temperature,
  };
  if (typeof params.maxOutputTokens === "number") body.max_output_tokens = params.maxOutputTokens;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), Math.max(1000, params.timeoutMs));
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        Authorization: `Bearer ${params.upstreamApiKey}`,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });

    const contentType = String(res.headers.get("content-type") ?? "");
    const raw = await res.text();
    if (!res.ok) {
      throw new Error(`upstream responses HTTP ${res.status}: ${raw.slice(0, 500)}`);
    }
    if (!raw.trim()) throw new Error("upstream responses HTTP 200: empty body");

    if (/text\/event-stream/i.test(contentType) || raw.includes("\nevent:") || raw.startsWith("event:")) {
      return { text: parseResponsesSseToText(raw), model: params.model };
    }

    let json: any;
    try {
      json = JSON.parse(raw) as unknown;
    } catch (err) {
      throw new Error(`upstream responses HTTP 200: invalid json (${String(err)})`);
    }
    const direct = json?.output_text;
    if (typeof direct === "string") return { text: direct, model: params.model };

    const outputs: unknown[] = Array.isArray(json?.output) ? json.output : [];
    for (const out of outputs) {
      const content: unknown[] = Array.isArray((out as any)?.content) ? (out as any).content : [];
      for (const item of content) {
        if ((item as any)?.type === "output_text" && typeof (item as any)?.text === "string") {
          return { text: String((item as any).text), model: params.model };
        }
      }
    }

    return { text: "", model: params.model };
  } finally {
    clearTimeout(t);
  }
}

function normalizeChatModel(raw: unknown): string {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s) return "";
  const idx = s.indexOf("/");
  if (idx !== -1) {
    const prefix = s.slice(0, idx).trim();
    const rest = s.slice(idx + 1).trim();
    if (prefix === "openai" || prefix === "openai-codex") return rest;
  }
  return s;
}

async function handleChatCompletions(params: {
  req: IncomingMessage;
  res: ServerResponse;
  config: OpenAiCompatProxyConfig;
  body: any;
  cache: CasCache | null;
}) {
  const { req, res, config, body, cache } = params;
  const created = Math.floor(Date.now() / 1000);
  const chatId = `chatcmpl_${randomUUID().replaceAll("-", "")}`;
  const temperature = typeof body?.temperature === "number" && Number.isFinite(body.temperature) ? body.temperature : 0;
  const maxTokens =
    typeof body?.max_tokens === "number" && Number.isFinite(body.max_tokens) ? Math.max(1, Math.floor(body.max_tokens)) : null;

  const messagesRaw: unknown[] = Array.isArray(body?.messages) ? body.messages : [];
  const input: any[] = [];
  for (const m of messagesRaw) {
    if (!m || typeof m !== "object") continue;
    const role = typeof (m as any).role === "string" ? String((m as any).role).trim() : "user";
    const contentText = toText((m as any).content);
    input.push({
      role: role || "user",
      content: [{ type: "input_text", text: contentText }],
    });
  }
  if (!input.length) {
    input.push({ role: "user", content: [{ type: "input_text", text: "" }] });
  }

  const requestedModel = normalizeChatModel(body?.model);
  const defaultModel = normalizeChatModel(config.defaultModel ?? "");
  const primaryModel = config.forceModel ? defaultModel : requestedModel || defaultModel;
  if (!primaryModel) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: "model required", type: "invalid_request_error" } }));
    return;
  }

  const stream = Boolean(body?.stream);
  const timeoutMs = Math.max(1000, config.timeoutMs ?? 60_000);

  const promptVersion = "openai_proxy_chat_to_responses_v1";
  const upstreamNormalized = normalizeOpenAiCompatBaseUrl(config.upstreamBaseUrl);
  const makeKey = (modelForKey: string) =>
    cacheKey({
      model: modelForKey,
      promptVersion,
      inputs: {
        upstreamBaseUrl: upstreamNormalized,
        temperature,
        maxTokens,
        input,
      },
    });

  let upstreamText = "";
  let upstreamModelUsed = primaryModel;
  try {
    const key1 = makeKey(primaryModel);
    const cached = cache ? await cache.getJson<{ text?: unknown; model?: unknown }>(key1) : null;
    if (cached && typeof cached.text === "string") {
      upstreamText = cached.text;
      upstreamModelUsed = typeof cached.model === "string" ? cached.model : primaryModel;
    } else {
      const out1 = await callUpstreamResponses({
        upstreamBaseUrl: config.upstreamBaseUrl,
        upstreamApiKey: config.upstreamApiKey,
        model: primaryModel,
        input,
        temperature,
        maxOutputTokens: maxTokens,
        timeoutMs,
      });
      upstreamText = out1.text;
      upstreamModelUsed = out1.model;
      if (cache) await cache.putJson(key1, { v: 1, at: Date.now(), model: upstreamModelUsed, text: upstreamText });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!config.forceModel && defaultModel && defaultModel !== primaryModel) {
      // Best-effort fallback: if the requested model is not supported upstream, retry using the configured default model.
      if (/model/i.test(msg) || /HTTP 404/.test(msg) || /not found/i.test(msg) || /invalid/i.test(msg)) {
        const key2 = makeKey(defaultModel);
        const cached2 = cache ? await cache.getJson<{ text?: unknown; model?: unknown }>(key2) : null;
        if (cached2 && typeof cached2.text === "string") {
          upstreamText = cached2.text;
          upstreamModelUsed = typeof cached2.model === "string" ? cached2.model : defaultModel;
        } else {
          const out2 = await callUpstreamResponses({
            upstreamBaseUrl: config.upstreamBaseUrl,
            upstreamApiKey: config.upstreamApiKey,
            model: defaultModel,
            input,
            temperature,
            maxOutputTokens: maxTokens,
            timeoutMs,
          });
          upstreamText = out2.text;
          upstreamModelUsed = out2.model;
          if (cache) await cache.putJson(key2, { v: 1, at: Date.now(), model: upstreamModelUsed, text: upstreamText });
        }
      } else {
        throw err;
      }
    } else {
      throw err;
    }
  }

  if (stream) {
    setCors(res);
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    });
    const writeEvent = (obj: unknown) => {
      res.write(`data: ${JSON.stringify(obj)}\n\n`);
    };

    writeEvent({
      id: chatId,
      object: "chat.completion.chunk",
      created,
      model: upstreamModelUsed,
      choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
    });
    if (upstreamText) {
      writeEvent({
        id: chatId,
        object: "chat.completion.chunk",
        created,
        model: upstreamModelUsed,
        choices: [{ index: 0, delta: { content: upstreamText }, finish_reason: null }],
      });
    }
    writeEvent({
      id: chatId,
      object: "chat.completion.chunk",
      created,
      model: upstreamModelUsed,
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    });
    res.write("data: [DONE]\n\n");
    res.end();
    return;
  }

  setCors(res);
  res.writeHead(200, { "Content-Type": "application/json" });
  const response = {
    id: chatId,
    object: "chat.completion",
    created,
    model: upstreamModelUsed,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: upstreamText },
        finish_reason: "stop",
      },
    ],
  };
  res.end(`${JSON.stringify(response)}\n`);
}

async function handleModels(params: { res: ServerResponse; config: OpenAiCompatProxyConfig }) {
  const { res, config } = params;
  setCors(res);
  res.writeHead(200, { "Content-Type": "application/json" });
  const model = normalizeChatModel(config.defaultModel ?? "");
  res.end(
    `${JSON.stringify({
      object: "list",
      data: model ? [{ id: model, object: "model", created: 0, owned_by: "openai-proxy" }] : [],
    })}\n`,
  );
}

export async function startOpenAiCompatProxy(config: OpenAiCompatProxyConfig): Promise<{
  server: Server;
  url: string;
}> {
  const cacheDir = config.cacheDir?.trim() ? config.cacheDir.trim() : "";
  const cache = cacheDir ? await createCasCache(cacheDir) : null;

  const server = createServer(async (req, res) => {
    setCors(res);
    const method = (req.method ?? "GET").toUpperCase();
    const u = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);

    if (method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (method === "GET" && (u.pathname === "/" || u.pathname === "/health" || u.pathname === "/healthz")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(`${JSON.stringify({ ok: true, service: "openai-compat-proxy" })}\n`);
      return;
    }

    if (method === "GET" && u.pathname === "/v1/models") {
      await handleModels({ res, config });
      return;
    }

    if (method === "POST" && u.pathname === "/v1/chat/completions") {
      try {
        const raw = await readBodyUtf8(req);
        const body = raw.trim() ? (JSON.parse(raw) as unknown) : {};
        await handleChatCompletions({ req, res, config, body, cache });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: msg, type: "internal_error" } }));
      }
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: `not found: ${method} ${u.pathname}`, type: "not_found" } }));
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(config.port, config.listenHost, () => resolve());
    server.once("error", reject);
  });

  const addr = server.address();
  const port =
    addr && typeof addr === "object" && typeof (addr as any).port === "number"
      ? ((addr as any).port as number)
      : config.port;
  const url = `http://${config.listenHost}:${port}/v1`;
  return { server, url };
}
