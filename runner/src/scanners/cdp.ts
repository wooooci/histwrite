import { WebSocket } from "undici";

export type CdpResult = Record<string, unknown>;

export type CdpClientLike = {
  send(
    method: string,
    params?: Record<string, unknown>,
    sessionId?: string,
    timeoutMs?: number,
  ): Promise<CdpResult>;
};

type PendingRequest = {
  resolve: (value: CdpResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type CdpEnvelope = {
  id?: number;
  result?: CdpResult;
  error?: { message?: string };
};

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function trimOptionalString(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

export function readArg(args: string[], name: string, fallback: string | null = null): string | null {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  const value = args[index + 1];
  if (value == null || String(value).startsWith("--")) return fallback;
  return value;
}

export function readRepeated(args: string[], name: string): string[] {
  const out: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== name) continue;
    const value = args[index + 1];
    if (value != null && !String(value).startsWith("--")) out.push(String(value));
  }
  return out;
}

export class CdpClient implements CdpClientLike {
  private readonly pending = new Map<number, PendingRequest>();
  private nextId = 1;

  constructor(private readonly ws: WebSocket) {
    ws.addEventListener("message", (event) => {
      const raw =
        typeof event.data === "string"
          ? event.data
          : Buffer.isBuffer(event.data)
            ? event.data.toString("utf8")
            : Buffer.from(event.data as ArrayBufferLike).toString("utf8");
      let payload: CdpEnvelope;
      try {
        payload = JSON.parse(raw) as CdpEnvelope;
      } catch {
        return;
      }
      if (!payload.id || !this.pending.has(payload.id)) return;
      const entry = this.pending.get(payload.id);
      if (!entry) return;
      clearTimeout(entry.timer);
      this.pending.delete(payload.id);
      if (payload.error) {
        entry.reject(new Error(payload.error.message || JSON.stringify(payload.error)));
        return;
      }
      entry.resolve(payload.result ?? {});
    });
  }

  async send(
    method: string,
    params?: Record<string, unknown>,
    sessionId?: string,
    timeoutMs = 60_000,
  ): Promise<CdpResult> {
    const id = this.nextId++;
    const payload: Record<string, unknown> = { id, method };
    if (params && Object.keys(params).length > 0) payload.params = params;
    if (sessionId) payload.sessionId = sessionId;

    const response = await new Promise<CdpResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`timeout: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify(payload));
    });

    return response;
  }
}

export async function connectCdp(url: string): Promise<{ ws: WebSocket; cdp: CdpClient }> {
  const ws = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve(), { once: true });
    ws.addEventListener("error", (error) => reject(error), { once: true });
  });
  return { ws, cdp: new CdpClient(ws) };
}

export async function waitForEval<T>(
  cdp: CdpClientLike,
  sessionId: string,
  expression: string,
  predicate: (value: T) => boolean,
  timeoutMs = 120_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await cdp.send(
      "Runtime.evaluate",
      { expression, returnByValue: true },
      sessionId,
      Math.min(60_000, timeoutMs),
    );
    if (result.exceptionDetails) {
      const exception = result.exceptionDetails as {
        exception?: { description?: string };
      };
      throw new Error(exception.exception?.description || "Runtime.evaluate exception");
    }
    const value = (result.result as { value?: T } | undefined)?.value as T;
    if (predicate(value)) return value;
    await sleep(500);
  }
  throw new Error(`timeout waiting for eval: ${expression}`);
}

export async function openAndAttach(cdp: CdpClientLike, url: string): Promise<{ targetId: string; sessionId: string }> {
  const created = await cdp.send("Target.createTarget", { url });
  const targetId = trimOptionalString(created.targetId);
  if (!targetId) throw new Error(`Target.createTarget returned no targetId for ${url}`);
  const attached = await cdp.send("Target.attachToTarget", { targetId });
  const sessionId = trimOptionalString(attached.sessionId);
  if (!sessionId) throw new Error(`Target.attachToTarget returned no sessionId for ${targetId}`);
  await cdp.send("Page.enable", {}, sessionId);
  await cdp.send("Runtime.enable", {}, sessionId);
  return { targetId, sessionId };
}

export async function navigate(cdp: CdpClientLike, sessionId: string, url: string): Promise<void> {
  await cdp.send("Page.navigate", { url }, sessionId, 60_000);
}
