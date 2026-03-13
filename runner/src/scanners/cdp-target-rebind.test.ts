import { describe, expect, it } from "vitest";

import {
  chooseReattachTarget,
  getTargets,
  resolveSessionAfterNavigation,
  reattachAfterRedirect,
  waitForTargetUrlMatch,
} from "./cdp-target-rebind.js";

describe("cdp-target-rebind", () => {
  it("reads targetInfos from Target.getTargets", async () => {
    const calls: Array<{ method: string; params: unknown; sessionId: string | undefined }> = [];
    const cdp = {
      async send(method: string, params?: unknown, sessionId?: string) {
        calls.push({ method, params, sessionId });
        expect(method).toBe("Target.getTargets");
        return {
          targetInfos: [
            { targetId: "seed", type: "page", url: "about:blank" },
            { targetId: "real", type: "page", url: "https://example.com/" },
          ],
        };
      },
    };

    await expect(getTargets(cdp)).resolves.toEqual([
      { targetId: "seed", type: "page", url: "about:blank" },
      { targetId: "real", type: "page", url: "https://example.com/" },
    ]);
    expect(calls).toHaveLength(1);
  });

  it("prefers redirected vendor targets over the blank seed page", () => {
    const chosen = chooseReattachTarget(
      [
        { targetId: "1", type: "page", url: "about:blank", openerId: "seed" },
        {
          targetId: "2",
          type: "page",
          url: "https://www-jstor-org.proxy.lib.umich.edu/action/doAdvancedSearch",
          openerId: "seed",
        },
        {
          targetId: "3",
          type: "page",
          url: "https://www-jstor-org.proxy.lib.umich.edu/",
          openerId: "other",
        },
      ],
      {
        seedTargetId: "1",
        expectedHosts: ["jstor", "proxy.lib.umich.edu"],
        expectedUrlSubstrings: ["/action/doAdvancedSearch"],
      },
    );

    expect(chosen).toEqual({
      targetId: "2",
      type: "page",
      url: "https://www-jstor-org.proxy.lib.umich.edu/action/doAdvancedSearch",
      openerId: "seed",
    });
  });

  it("returns null when only unrelated pages are visible", () => {
    const chosen = chooseReattachTarget(
      [
        { targetId: "seed", type: "page", url: "about:blank" },
        { targetId: "other", type: "page", url: "https://example.com/" },
      ],
      {
        seedTargetId: "seed",
        expectedHosts: ["jstor", "proxy.lib.umich.edu"],
        expectedUrlSubstrings: ["/action/doAdvancedSearch"],
      },
    );

    expect(chosen).toBeNull();
  });

  it("does not treat a generic proxy-host match as sufficient when a specific url substring is required", () => {
    const chosen = chooseReattachTarget(
      [
        { targetId: "seed", type: "page", url: "about:blank" },
        {
          targetId: "jstor-proxy",
          type: "page",
          url: "https://www-jstor-org.proxy.lib.umich.edu/action/doAdvancedSearch?q0=Walter+Lippmann",
        },
      ],
      {
        seedTargetId: "seed",
        expectedHosts: ["gale", "proxy.lib.umich.edu", "galegroup"],
        expectedUrlSubstrings: ["/ps/"],
      },
    );

    expect(chosen).toBeNull();
  });

  it("waits until a redirect target appears", async () => {
    const batches = [
      [{ targetId: "1", type: "page", url: "about:blank", openerId: "seed" }],
      [
        { targetId: "1", type: "page", url: "about:blank", openerId: "seed" },
        {
          targetId: "2",
          type: "page",
          url: "https://www.proquest.com/pqdtglobal/results/abc/1",
          openerId: "seed",
        },
      ],
    ];

    const cdp = {
      async send(method: string) {
        expect(method).toBe("Target.getTargets");
        return { targetInfos: batches.shift() ?? [] };
      },
    };

    const matched = await waitForTargetUrlMatch(cdp, {
      seedTargetId: "1",
      expectedHosts: ["proquest.com"],
      expectedUrlSubstrings: ["/pqdtglobal/results/"],
      timeoutMs: 1_000,
      intervalMs: 1,
    });

    expect(matched?.targetId).toBe("2");
    expect(matched?.url ?? "").toMatch(/pqdtglobal\/results/);
  });

  it("detaches stale session and attaches the matching target", async () => {
    const calls: Array<{ method: string; params: unknown; sessionId: string | undefined }> = [];
    const cdp = {
      async send(method: string, params?: unknown, sessionId?: string) {
        calls.push({ method, params, sessionId });

        if (method === "Target.getTargets") {
          return {
            targetInfos: [
              { targetId: "seed", type: "page", url: "about:blank" },
              {
                targetId: "real-target",
                type: "page",
                url: "https://www-jstor-org.proxy.lib.umich.edu/action/doAdvancedSearch",
                openerId: "seed",
              },
            ],
          };
        }

        if (method === "Target.detachFromTarget") return {};
        if (method === "Target.attachToTarget") return { sessionId: "real-session" };
        if (method === "Page.enable") return {};
        if (method === "Runtime.enable") return {};

        throw new Error(`unexpected method: ${method}`);
      },
    };

    await expect(
      reattachAfterRedirect(cdp, {
        currentSessionId: "seed-session",
        currentTargetId: "seed",
        expectedHosts: ["jstor", "proxy.lib.umich.edu"],
        expectedUrlSubstrings: ["/action/doAdvancedSearch"],
        timeoutMs: 1_000,
        intervalMs: 1,
      }),
    ).resolves.toEqual({
      sessionId: "real-session",
      targetInfo: {
        targetId: "real-target",
        type: "page",
        url: "https://www-jstor-org.proxy.lib.umich.edu/action/doAdvancedSearch",
        openerId: "seed",
      },
    });

    expect(calls.map((call) => call.method)).toEqual([
      "Target.getTargets",
      "Target.detachFromTarget",
      "Target.attachToTarget",
      "Page.enable",
      "Runtime.enable",
    ]);
  });

  it("keeps the current session when its location already matches the expected redirect", async () => {
    const calls: Array<{ method: string; params: unknown; sessionId: string | undefined }> = [];
    const cdp = {
      async send(method: string, params?: unknown, sessionId?: string) {
        calls.push({ method, params, sessionId });

        if (method === "Runtime.evaluate") {
          return {
            result: {
              type: "string",
              value: "https://www-proquest-com.proxy.lib.umich.edu/pqdtglobal/advanced?accountid=14667",
            },
          };
        }

        throw new Error(`unexpected method: ${method}`);
      },
    };

    await expect(
      resolveSessionAfterNavigation(cdp, {
        currentSessionId: "seed-session",
        currentTargetId: "seed-target",
        expectedHosts: ["proquest.com", "proxy.lib.umich.edu"],
        expectedUrlSubstrings: ["/pqdtglobal/advanced"],
        currentUrlTimeoutMs: 5_000,
        currentUrlIntervalMs: 1,
      }),
    ).resolves.toEqual({
      sessionId: "seed-session",
      targetInfo: {
        targetId: "seed-target",
        url: "https://www-proquest-com.proxy.lib.umich.edu/pqdtglobal/advanced?accountid=14667",
      },
      matchedCurrentSession: true,
    });

    expect(calls.map((call) => call.method)).toEqual(["Runtime.evaluate"]);
  });

  it("falls back to reattach when the current session never reaches the expected url", async () => {
    const calls: Array<{ method: string; params: unknown; sessionId: string | undefined }> = [];
    const cdp = {
      async send(method: string, params?: unknown, sessionId?: string) {
        calls.push({ method, params, sessionId });

        if (method === "Runtime.evaluate") {
          return { result: { type: "string", value: "about:blank" } };
        }

        if (method === "Target.getTargets") {
          return {
            targetInfos: [
              { targetId: "seed-target", type: "page", url: "about:blank" },
              {
                targetId: "real-target",
                type: "page",
                url: "https://www.proquest.com/pqdtglobal/results/abc/1",
                openerId: "seed-target",
              },
            ],
          };
        }

        if (method === "Target.detachFromTarget") return {};
        if (method === "Target.attachToTarget") return { sessionId: "real-session" };
        if (method === "Page.enable") return {};
        if (method === "Runtime.enable") return {};

        throw new Error(`unexpected method: ${method}`);
      },
    };

    await expect(
      resolveSessionAfterNavigation(cdp, {
        currentSessionId: "seed-session",
        currentTargetId: "seed-target",
        expectedHosts: ["proquest.com"],
        expectedUrlSubstrings: ["/pqdtglobal/results/"],
        currentUrlTimeoutMs: 5,
        currentUrlIntervalMs: 1,
        timeoutMs: 1_000,
        intervalMs: 1,
      }),
    ).resolves.toEqual({
      sessionId: "real-session",
      targetInfo: {
        targetId: "real-target",
        type: "page",
        url: "https://www.proquest.com/pqdtglobal/results/abc/1",
        openerId: "seed-target",
      },
      matchedCurrentSession: false,
    });
  });
});
