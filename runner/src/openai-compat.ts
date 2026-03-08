export type OpenAiCompatEndpoint = "chat" | "responses";

import { Agent } from "undici";

export type OpenAiCompatClient = {
  apiBaseUrl: string;
  apiKey: string;
  model: string;
  endpoint?: OpenAiCompatEndpoint;
  timeoutMs?: number;
  temperature?: number;
  maxTokens?: number;
};

let sharedHttp1Dispatcher: Agent | null = null;
function getSharedHttp1Dispatcher(): Agent {
  if (sharedHttp1Dispatcher) return sharedHttp1Dispatcher;
  sharedHttp1Dispatcher = new Agent({
    connect: {
      allowH2: false,
      timeout: 30_000,
    },
  });
  return sharedHttp1Dispatcher;
}

export function normalizeOpenAiCompatBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  if (trimmed.endsWith("/v1")) return trimmed;
  return `${trimmed}/v1`;
}

function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  const m = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (m?.[1]) return m[1].trim();
  return trimmed;
}

export function extractFirstJsonObject(text: string): string | null {
  const s = stripCodeFences(text);
  const start = s.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < s.length; i += 1) {
    const ch = s[i]!;
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === "\"") {
        inString = false;
        continue;
      }
      continue;
    }

    if (ch === "\"") {
      inString = true;
      continue;
    }
    if (ch === "{") depth += 1;
    if (ch === "}") depth -= 1;
    if (depth === 0) {
      return s.slice(start, i + 1).trim();
    }
  }
  return null;
}

export function parseJsonFromText(text: string): unknown {
  const trimmed = stripCodeFences(text);
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const extracted = extractFirstJsonObject(trimmed);
    if (!extracted) throw new Error("no json object found");
    return JSON.parse(extracted) as unknown;
  }
}

function resolveTimeoutSignal(timeoutMs: number): AbortSignal {
  // Node 18+ supports AbortSignal.timeout().
  const anySig = AbortSignal as unknown as { timeout?: (ms: number) => AbortSignal };
  if (typeof anySig.timeout === "function") return anySig.timeout(timeoutMs);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  ctrl.signal.addEventListener("abort", () => clearTimeout(t), { once: true });
  return ctrl.signal;
}

async function readResponseTextSafe(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

function isRetryableError(err: unknown): boolean {
  if (!err) return false;
  if (typeof err === "object") {
    const anyErr = err as any;
    const code = String(anyErr?.code ?? "");
    if (
      code === "UND_ERR_SOCKET" ||
      code === "UND_ERR_CONNECT_TIMEOUT" ||
      code === "UND_ERR_HEADERS_TIMEOUT" ||
      code === "UND_ERR_BODY_TIMEOUT"
    ) {
      return true;
    }
    const causeCode = String(anyErr?.cause?.code ?? "");
    if (
      causeCode === "UND_ERR_SOCKET" ||
      causeCode === "UND_ERR_CONNECT_TIMEOUT" ||
      causeCode === "UND_ERR_HEADERS_TIMEOUT" ||
      causeCode === "UND_ERR_BODY_TIMEOUT"
    ) {
      return true;
    }
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (/fetch failed/i.test(msg)) return true;
  if (/empty reply from server/i.test(msg)) return true;
  if (/socket/i.test(msg) && /closed/i.test(msg)) return true;
  if (/timeout/i.test(msg)) return true;
  if (/empty content/i.test(msg)) return true;
  return false;
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callChatCompletions(params: {
  client: OpenAiCompatClient;
  system: string;
  prompt: string;
}): Promise<{ text: string; endpoint: OpenAiCompatEndpoint }> {
  const base = normalizeOpenAiCompatBaseUrl(params.client.apiBaseUrl);
  if (!base) throw new Error("apiBaseUrl required");
  const url = `${base}/chat/completions`;

  const timeoutMs = Math.max(1000, params.client.timeoutMs ?? 60_000);
  const signal = resolveTimeoutSignal(timeoutMs);

  const body = {
    model: params.client.model,
    messages: [
      { role: "system", content: params.system },
      { role: "user", content: params.prompt },
    ],
    temperature: params.client.temperature ?? 0,
    ...(typeof params.client.maxTokens === "number" ? { max_tokens: params.client.maxTokens } : {}),
  };

  const maxAttempts = 3;
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${params.client.apiKey}`,
        },
        body: JSON.stringify(body),
        signal,
        // Prefer HTTP/1.1 for flaky OpenAI-compatible gateways.
        dispatcher: getSharedHttp1Dispatcher(),
      } as any);

      if (!res.ok) {
        const raw = await readResponseTextSafe(res);
        const err = new Error(`chat.completions HTTP ${res.status}: ${raw.slice(0, 500)}`);
        // Retry on 429/5xx.
        if ((res.status === 429 || res.status >= 500) && attempt < maxAttempts) {
          await sleepMs(300 * attempt);
          lastErr = err;
          continue;
        }
        throw err;
      }

      const json = (await res.json()) as any;
      const content =
        json?.choices?.[0]?.message?.content ??
        json?.choices?.[0]?.text ??
        json?.output_text ??
        "";
      const text = String(content ?? "");
      if (!text.trim()) {
        const finish = String(json?.choices?.[0]?.finish_reason ?? "");
        const err = new Error(`chat.completions HTTP 200: empty content (finish_reason=${finish || "unknown"})`);
        if (attempt < maxAttempts) {
          await sleepMs(300 * attempt);
          lastErr = err;
          continue;
        }
        throw err;
      }
      return { text, endpoint: "chat" };
    } catch (err) {
      lastErr = err;
      if (attempt >= maxAttempts || !isRetryableError(err)) throw err;
      await sleepMs(300 * attempt);
    }
  }
  throw lastErr ?? new Error("chat.completions: unknown error");
}

async function callResponses(params: {
  client: OpenAiCompatClient;
  system: string;
  prompt: string;
}): Promise<{ text: string; endpoint: OpenAiCompatEndpoint }> {
  const base = normalizeOpenAiCompatBaseUrl(params.client.apiBaseUrl);
  if (!base) throw new Error("apiBaseUrl required");
  const url = `${base}/responses`;

  const timeoutMs = Math.max(1000, params.client.timeoutMs ?? 60_000);
  const signal = resolveTimeoutSignal(timeoutMs);

  const body = {
    model: params.client.model,
    // Some OpenAI-compatible providers (e.g. responses-only proxies) require `input` to be a list.
    // Use the Responses API message-style input format for broad compatibility.
    instructions: params.system,
    input: [
      {
        role: "user",
        content: [{ type: "input_text", text: params.prompt }],
      },
    ],
    temperature: params.client.temperature ?? 0,
    ...(typeof params.client.maxTokens === "number" ? { max_output_tokens: params.client.maxTokens } : {}),
    // Prefer streaming for compatibility with providers that only implement SSE.
    stream: true,
  };

  const maxAttempts = 3;
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          Authorization: `Bearer ${params.client.apiKey}`,
        },
        body: JSON.stringify(body),
        signal,
        dispatcher: getSharedHttp1Dispatcher(),
      } as any);

      if (!res.ok) {
        const raw = await readResponseTextSafe(res);
        const err = new Error(`responses HTTP ${res.status}: ${raw.slice(0, 500)}`);
        if ((res.status === 429 || res.status >= 500) && attempt < maxAttempts) {
          await sleepMs(300 * attempt);
          lastErr = err;
          continue;
        }
        throw err;
      }

      const contentType = String(res.headers.get("content-type") ?? "");
      const raw = await readResponseTextSafe(res);
      if (!raw.trim()) {
        const err = new Error("responses HTTP 200: empty body");
        if (attempt < maxAttempts) {
          await sleepMs(300 * attempt);
          lastErr = err;
          continue;
        }
        throw err;
      }

      if (/text\/event-stream/i.test(contentType) || raw.includes("\nevent:") || raw.startsWith("event:")) {
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
          if (
            !sawDelta &&
            typeof obj?.text === "string" &&
            typeof obj?.type === "string" &&
            /output_text/i.test(obj.type)
          ) {
            // e.g. response.output_text.done
            out = obj.text;
            continue;
          }
          if (!sawDelta && typeof obj?.output_text === "string") {
            out = obj.output_text;
            continue;
          }
        }
        if (!out.trim()) {
          const err = new Error("responses HTTP 200: empty content");
          if (attempt < maxAttempts) {
            await sleepMs(300 * attempt);
            lastErr = err;
            continue;
          }
          throw err;
        }
        return { text: out, endpoint: "responses" };
      }

      let json: any;
      try {
        json = JSON.parse(raw) as unknown;
      } catch (err) {
        throw new Error(`responses HTTP 200: invalid json (${String(err)})`);
      }

      const direct = json?.output_text;
      if (typeof direct === "string" && direct.trim()) return { text: direct, endpoint: "responses" };

      const outputs: unknown[] = Array.isArray(json?.output) ? json.output : [];
      for (const out of outputs) {
        const content: unknown[] = Array.isArray((out as any)?.content) ? (out as any).content : [];
        for (const item of content) {
          if ((item as any)?.type === "output_text" && typeof (item as any)?.text === "string") {
            const t = String((item as any).text);
            if (t.trim()) return { text: t, endpoint: "responses" };
          }
        }
      }

      const err = new Error("responses HTTP 200: empty content");
      if (attempt < maxAttempts) {
        await sleepMs(300 * attempt);
        lastErr = err;
        continue;
      }
      throw err;
    } catch (err) {
      lastErr = err;
      if (attempt >= maxAttempts || !isRetryableError(err)) throw err;
      await sleepMs(300 * attempt);
    }
  }
  throw lastErr ?? new Error("responses: unknown error");
}

export async function openAiCompatGenerateText(params: {
  client: OpenAiCompatClient;
  system: string;
  prompt: string;
  endpoint?: "auto" | OpenAiCompatEndpoint;
}): Promise<{ text: string; endpoint: OpenAiCompatEndpoint }> {
  const mode = params.endpoint ?? params.client.endpoint ?? "auto";
  if (mode === "chat") return await callChatCompletions(params);
  if (mode === "responses") return await callResponses(params);

  try {
    return await callChatCompletions(params);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/HTTP 404/.test(msg) && !/not found/i.test(msg)) throw err;
  }
  return await callResponses(params);
}
