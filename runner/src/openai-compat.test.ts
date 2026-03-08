import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { describe, expect, it } from "vitest";

import { extractFirstJsonObject, openAiCompatGenerateText, parseJsonFromText } from "./openai-compat.js";

describe("openai-compat", () => {
  it("extractFirstJsonObject finds the first balanced object", () => {
    const s = `prefix {"a":1,"b":{"c":2}} suffix`;
    expect(extractFirstJsonObject(s)).toBe(`{"a":1,"b":{"c":2}}`);
  });

  it("parseJsonFromText supports fenced json", () => {
    const s = "```json\n{\"a\":1}\n```";
    expect(parseJsonFromText(s)).toEqual({ a: 1 });
  });

  it("calls chat.completions on an OpenAI-compatible server", async () => {
    let seenAuth = "";
    const server = createServer(async (req, res) => {
      if (req.url !== "/v1/chat/completions" || req.method !== "POST") {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      seenAuth = String(req.headers.authorization ?? "");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content: "{\"ok\":true}" } }] }));
    });

    const port = await new Promise<number>((resolve, reject) => {
      server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
      server.once("error", reject);
    });

    try {
      const r = await openAiCompatGenerateText({
        client: { apiBaseUrl: `http://127.0.0.1:${port}`, apiKey: "k", model: "m" },
        system: "s",
        prompt: "p",
        endpoint: "chat",
      });
      expect(r.endpoint).toBe("chat");
      expect(r.text).toContain("\"ok\":true");
      expect(seenAuth).toBe("Bearer k");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("calls responses and parses text/event-stream output", async () => {
    let seenAuth = "";
    let seenBody: any = null;
    const server = createServer(async (req, res) => {
      if (req.url !== "/v1/responses" || req.method !== "POST") {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      seenAuth = String(req.headers.authorization ?? "");
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(Buffer.from(c));
      seenBody = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;

      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write("event: response.output_text.delta\n");
      res.write("data: {\"type\":\"response.output_text.delta\",\"delta\":\"a\"}\n\n");
      res.write("event: response.output_text.delta\n");
      res.write("data: {\"type\":\"response.output_text.delta\",\"delta\":\"b\"}\n\n");
      res.write("event: response.output_text.done\n");
      res.write("data: {\"type\":\"response.output_text.done\",\"text\":\"ab\"}\n\n");
      res.end();
    });

    const port = await new Promise<number>((resolve, reject) => {
      server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
      server.once("error", reject);
    });

    try {
      const r = await openAiCompatGenerateText({
        client: { apiBaseUrl: `http://127.0.0.1:${port}`, apiKey: "k", model: "m" },
        system: "sys",
        prompt: "user",
        endpoint: "responses",
      });
      expect(r.endpoint).toBe("responses");
      expect(r.text).toBe("ab");
      expect(seenAuth).toBe("Bearer k");
      expect(seenBody?.stream).toBe(true);
      expect(seenBody?.instructions).toBe("sys");
      expect(Array.isArray(seenBody?.input)).toBe(true);
      expect(seenBody?.input?.[0]?.role).toBe("user");
      expect(seenBody?.input?.[0]?.content?.[0]?.type).toBe("input_text");
      expect(seenBody?.input?.[0]?.content?.[0]?.text).toBe("user");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
