import { describe, expect, it } from "vitest";

import { SchedulerHttpError, createProviderScheduler } from "./scheduler.js";

async function waitUntil(check: () => boolean, maxTurns = 50): Promise<void> {
  for (let i = 0; i < maxTurns; i += 1) {
    if (check()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("waitUntil timed out");
}

describe("provider scheduler", () => {
  it("enforces maxConcurrency per provider", async () => {
    const scheduler = createProviderScheduler({
      providers: {
        openai: {
          maxConcurrency: 2,
          maxRetries: 0,
          baseDelayMs: 10,
          maxDelayMs: 20,
          jitterRatio: 0,
        },
      },
    });

    let running = 0;
    let maxRunning = 0;
    const releases: Array<() => void> = [];

    const runTask = (name: string) =>
      scheduler.schedule({
        provider: "openai",
        priority: "draft",
        run: async () => {
          running += 1;
          maxRunning = Math.max(maxRunning, running);
          await new Promise<void>((resolve) => {
            releases.push(() => {
              running -= 1;
              resolve();
            });
          });
          return name;
        },
      });

    const first = runTask("first");
    const second = runTask("second");
    const third = runTask("third");

    await waitUntil(() => releases.length === 2);
    expect(maxRunning).toBe(2);

    releases.shift()?.();
    await waitUntil(() => releases.length === 2);
    releases.splice(0).forEach((release) => release());

    await expect(Promise.all([first, second, third])).resolves.toEqual(["first", "second", "third"]);
    expect(maxRunning).toBe(2);
  });

  it("prefers higher priority work once a slot becomes free", async () => {
    const scheduler = createProviderScheduler({
      providers: {
        openai: {
          maxConcurrency: 1,
          maxRetries: 0,
          baseDelayMs: 10,
          maxDelayMs: 20,
          jitterRatio: 0,
        },
      },
    });

    const started: string[] = [];
    let releaseFirst: (() => void) | null = null;

    const first = scheduler.schedule({
      provider: "openai",
      priority: "draft",
      run: async () => {
        started.push("first");
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
        return "first";
      },
    });

    const second = scheduler.schedule({
      provider: "openai",
      priority: "draft",
      run: async () => {
        started.push("second");
        return "second";
      },
    });

    const third = scheduler.schedule({
      provider: "openai",
      priority: "verify",
      run: async () => {
        started.push("third");
        return "third";
      },
    });

    await Promise.resolve();
    expect(started).toEqual(["first"]);

    releaseFirst?.();
    await expect(Promise.all([first, second, third])).resolves.toEqual(["first", "second", "third"]);
    expect(started).toEqual(["first", "third", "second"]);
  });

  it("retries 429 and 5xx with exponential backoff", async () => {
    const sleeps: number[] = [];
    let attempts = 0;

    const scheduler = createProviderScheduler({
      providers: {
        openai: {
          maxConcurrency: 1,
          maxRetries: 2,
          baseDelayMs: 10,
          maxDelayMs: 25,
          jitterRatio: 0,
        },
      },
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    const result = await scheduler.schedule({
      provider: "openai",
      priority: "finalize",
      run: async () => {
        attempts += 1;
        if (attempts === 1) throw new SchedulerHttpError(429, "too many requests");
        if (attempts === 2) throw new SchedulerHttpError(503, "upstream unavailable");
        return "ok";
      },
    });

    expect(result).toBe("ok");
    expect(attempts).toBe(3);
    expect(sleeps).toEqual([10, 20]);
  });
});
