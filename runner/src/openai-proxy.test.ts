import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { startOpenAiCompatProxy } from "./openai-proxy.js";

describe("openai-proxy", () => {
  it("proxies /v1/chat/completions to upstream /v1/responses (SSE)", async () => {
    let calls = 0;
    let seenAuth = "";
    let seenBody: any = null;

    const upstream = createServer(async (req, res) => {
      if (req.method !== "POST" || req.url !== "/v1/responses") {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      calls += 1;
      seenAuth = String(req.headers.authorization ?? "");
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(Buffer.from(c));
      seenBody = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;

      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write("event: response.output_text.delta\n");
      res.write("data: {\"type\":\"response.output_text.delta\",\"delta\":\"pong\"}\n\n");
      res.write("event: response.completed\n");
      res.write("data: {\"type\":\"response.completed\"}\n\n");
      res.end();
    });

    const upstreamPort = await new Promise<number>((resolve, reject) => {
      upstream.listen(0, "127.0.0.1", () => resolve((upstream.address() as AddressInfo).port));
      upstream.once("error", reject);
    });

    const { server: proxy, url } = await startOpenAiCompatProxy({
      listenHost: "127.0.0.1",
      port: 0,
      upstreamBaseUrl: `http://127.0.0.1:${upstreamPort}`,
      upstreamApiKey: "up",
      defaultModel: "m",
    });

    try {
      const res = await fetch(`${url}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer local" },
        body: JSON.stringify({ model: "m", messages: [{ role: "user", content: "ping" }], temperature: 0 }),
      });
      expect(res.status).toBe(200);
      const json = (await res.json()) as any;
      expect(json?.choices?.[0]?.message?.content).toBe("pong");

      expect(calls).toBe(1);
      expect(seenAuth).toBe("Bearer up");
      expect(seenBody?.stream).toBe(true);
      expect(Array.isArray(seenBody?.input)).toBe(true);
      expect(seenBody?.input?.[0]?.role).toBe("user");
      expect(seenBody?.input?.[0]?.content?.[0]?.type).toBe("input_text");
      expect(seenBody?.input?.[0]?.content?.[0]?.text).toBe("ping");
    } finally {
      await new Promise<void>((resolve) => proxy.close(() => resolve()));
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  });

  it("falls back to defaultModel when the requested model is rejected upstream", async () => {
    let calls = 0;
    const upstream = createServer(async (req, res) => {
      if (req.method !== "POST" || req.url !== "/v1/responses") {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      calls += 1;
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(Buffer.from(c));
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as any;
      if (body?.model === "bad") {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end("{\"error\":\"unknown model\"}");
        return;
      }
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write("event: response.output_text.delta\n");
      res.write("data: {\"type\":\"response.output_text.delta\",\"delta\":\"ok\"}\n\n");
      res.end();
    });

    const upstreamPort = await new Promise<number>((resolve, reject) => {
      upstream.listen(0, "127.0.0.1", () => resolve((upstream.address() as AddressInfo).port));
      upstream.once("error", reject);
    });

    const { server: proxy, url } = await startOpenAiCompatProxy({
      listenHost: "127.0.0.1",
      port: 0,
      upstreamBaseUrl: `http://127.0.0.1:${upstreamPort}`,
      upstreamApiKey: "up",
      defaultModel: "good",
    });

    try {
      const res = await fetch(`${url}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "bad", messages: [{ role: "user", content: "x" }] }),
      });
      expect(res.status).toBe(200);
      const json = (await res.json()) as any;
      expect(json?.choices?.[0]?.message?.content).toBe("ok");
      expect(calls).toBe(2);
    } finally {
      await new Promise<void>((resolve) => proxy.close(() => resolve()));
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  });

  it("caches identical requests when cacheDir is set", async () => {
    let calls = 0;
    const upstream = createServer(async (req, res) => {
      if (req.method !== "POST" || req.url !== "/v1/responses") {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      calls += 1;
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write("event: response.output_text.delta\n");
      res.write("data: {\"type\":\"response.output_text.delta\",\"delta\":\"pong\"}\n\n");
      res.end();
    });

    const upstreamPort = await new Promise<number>((resolve, reject) => {
      upstream.listen(0, "127.0.0.1", () => resolve((upstream.address() as AddressInfo).port));
      upstream.once("error", reject);
    });

    const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), "histwrite-openai-proxy-cache-"));
    const { server: proxy, url } = await startOpenAiCompatProxy({
      listenHost: "127.0.0.1",
      port: 0,
      upstreamBaseUrl: `http://127.0.0.1:${upstreamPort}`,
      upstreamApiKey: "up",
      defaultModel: "m",
      forceModel: true,
      cacheDir,
    });

    try {
      for (let i = 0; i < 2; i += 1) {
        const res = await fetch(`${url}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: "ignored", messages: [{ role: "user", content: "ping" }], temperature: 0 }),
        });
        expect(res.status).toBe(200);
        const json = (await res.json()) as any;
        expect(json?.choices?.[0]?.message?.content).toBe("pong");
      }
      expect(calls).toBe(1);
    } finally {
      await new Promise<void>((resolve) => proxy.close(() => resolve()));
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  });

  it("retries upstream 503 through the scheduler and still returns a completion", async () => {
    let calls = 0;
    const upstream = createServer(async (req, res) => {
      if (req.method !== "POST" || req.url !== "/v1/responses") {
        res.writeHead(404);
        res.end("not found");
        return;
      }

      calls += 1;
      if (calls === 1) {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end("{\"error\":\"temporary unavailable\"}");
        return;
      }

      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write("event: response.output_text.delta\n");
      res.write("data: {\"type\":\"response.output_text.delta\",\"delta\":\"retry-ok\"}\n\n");
      res.end();
    });

    const upstreamPort = await new Promise<number>((resolve, reject) => {
      upstream.listen(0, "127.0.0.1", () => resolve((upstream.address() as AddressInfo).port));
      upstream.once("error", reject);
    });

    const { server: proxy, url } = await startOpenAiCompatProxy({
      listenHost: "127.0.0.1",
      port: 0,
      upstreamBaseUrl: `http://127.0.0.1:${upstreamPort}`,
      upstreamApiKey: "up",
      defaultModel: "m",
      scheduler: {
        maxConcurrency: 1,
        maxRetries: 2,
        baseDelayMs: 1,
        maxDelayMs: 2,
        jitterRatio: 0,
      },
    });

    try {
      const res = await fetch(`${url}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "m", messages: [{ role: "user", content: "retry" }] }),
      });

      expect(res.status).toBe(200);
      const json = (await res.json()) as any;
      expect(json?.choices?.[0]?.message?.content).toBe("retry-ok");
      expect(calls).toBe(2);
    } finally {
      await new Promise<void>((resolve) => proxy.close(() => resolve()));
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  });
});
