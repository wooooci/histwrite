import { sleep, trimOptionalString, type CdpClientLike } from "./cdp.js";

export type BrowserTargetInfo = {
  targetId?: string;
  type?: string;
  title?: string;
  url?: string;
  openerId?: string;
  attached?: boolean;
};

export type ReattachOptions = {
  expectedHosts?: string[];
  expectedUrlSubstrings?: string[];
  seedTargetId?: string;
  currentTargetId?: string;
  currentSessionId?: string;
  currentUrl?: string;
  timeoutMs?: number;
  intervalMs?: number;
  currentUrlTimeoutMs?: number;
  currentUrlIntervalMs?: number;
};

function toLowerList(values: string[] | undefined): string[] {
  return Array.isArray(values)
    ? values.map((value) => trimOptionalString(value).toLowerCase()).filter(Boolean)
    : [];
}

function isBlankLikeUrl(url: string): boolean {
  const value = trimOptionalString(url).toLowerCase();
  return (
    value === "" ||
    value === "about:blank" ||
    value === "about:srcdoc" ||
    value.startsWith("chrome://newtab")
  );
}

function extractHost(url: string): string {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return "";
  }
}

function matchesAnyNeedle(value: string, needles: string[]): boolean {
  if (!value || needles.length === 0) return false;
  return needles.some((needle) => value.includes(needle));
}

function isGenericProxyNeedle(needle: string): boolean {
  return needle.includes("proxy.");
}

function urlMatchesExpectations(url: string, options: ReattachOptions = {}): boolean {
  const value = trimOptionalString(url).toLowerCase();
  if (!value) return false;

  const expectedHosts = toLowerList(options.expectedHosts);
  const expectedUrlSubstrings = toLowerList(options.expectedUrlSubstrings);
  if (expectedHosts.length === 0 && expectedUrlSubstrings.length === 0) {
    return !isBlankLikeUrl(value);
  }

  const host = extractHost(value);
  const specificExpectedHosts = expectedHosts.filter((needle) => !isGenericProxyNeedle(needle));
  const genericExpectedHosts = expectedHosts.filter(isGenericProxyNeedle);
  const specificHostMatched =
    matchesAnyNeedle(host, specificExpectedHosts) || matchesAnyNeedle(value, specificExpectedHosts);
  const genericHostMatched =
    matchesAnyNeedle(host, genericExpectedHosts) || matchesAnyNeedle(value, genericExpectedHosts);
  const urlMatched = matchesAnyNeedle(value, expectedUrlSubstrings);
  if (expectedUrlSubstrings.length > 0) {
    return urlMatched || specificHostMatched;
  }
  return urlMatched || specificHostMatched || genericHostMatched;
}

function targetScore(target: BrowserTargetInfo, options: ReattachOptions = {}): number {
  const url = trimOptionalString(target.url);
  const type = trimOptionalString(target.type || "page");
  const host = extractHost(url);
  const openerId = trimOptionalString(target.openerId);
  const targetId = trimOptionalString(target.targetId);

  const expectedHosts = toLowerList(options.expectedHosts);
  const expectedUrlSubstrings = toLowerList(options.expectedUrlSubstrings);
  const seedTargetId = trimOptionalString(options.seedTargetId || options.currentTargetId);
  const currentUrl = trimOptionalString(options.currentUrl).toLowerCase();
  const hasExpectations = expectedHosts.length > 0 || expectedUrlSubstrings.length > 0;
  const specificExpectedHosts = expectedHosts.filter((needle) => !isGenericProxyNeedle(needle));
  const genericExpectedHosts = expectedHosts.filter(isGenericProxyNeedle);
  const specificHostMatched =
    matchesAnyNeedle(host, specificExpectedHosts) ||
    matchesAnyNeedle(url.toLowerCase(), specificExpectedHosts);
  const genericHostMatched =
    matchesAnyNeedle(host, genericExpectedHosts) ||
    matchesAnyNeedle(url.toLowerCase(), genericExpectedHosts);
  const urlMatched = matchesAnyNeedle(url.toLowerCase(), expectedUrlSubstrings);
  const matchesExpectation =
    expectedUrlSubstrings.length > 0
      ? urlMatched || specificHostMatched
      : urlMatched || specificHostMatched || genericHostMatched;

  let score = 0;
  if (type === "page") score += 40;
  else score -= 200;

  if (targetId && seedTargetId && targetId === seedTargetId) score += 8;
  if (openerId && seedTargetId && openerId === seedTargetId) score += 60;

  if (url) score += 8;
  if (isBlankLikeUrl(url)) score -= 140;
  else score += 30;

  if (url.startsWith("devtools://")) score -= 200;
  if (url.startsWith("chrome-extension://")) score -= 100;

  if (specificHostMatched) score += 55;
  if (genericHostMatched) score += 10;
  if (matchesAnyNeedle(url.toLowerCase(), specificExpectedHosts)) score += 20;
  if (urlMatched) score += 80;
  if (currentUrl && url.toLowerCase() === currentUrl) score += 12;

  if (hasExpectations && !matchesExpectation) {
    score -= 500;
  } else if (!matchesExpectation) {
    score -= 15;
  }

  return score;
}

function summarizeTargets(targets: BrowserTargetInfo[]): string {
  return targets
    .map((target) => {
      const targetId = trimOptionalString(target.targetId) || "?";
      const openerId = trimOptionalString(target.openerId) || "-";
      const type = trimOptionalString(target.type || "page") || "page";
      const url = trimOptionalString(target.url) || "(empty)";
      return `${targetId}:${type}:opener=${openerId}:url=${url}`;
    })
    .join(" | ");
}

export async function getTargets(cdp: CdpClientLike): Promise<BrowserTargetInfo[]> {
  const result = await cdp.send("Target.getTargets");
  return Array.isArray(result.targetInfos) ? (result.targetInfos as BrowserTargetInfo[]) : [];
}

export function chooseReattachTarget(
  targets: BrowserTargetInfo[],
  options: ReattachOptions = {},
): BrowserTargetInfo | null {
  const ranked = [];
  for (const target of targets) {
    const score = targetScore(target, options);
    if (score <= 0) continue;
    ranked.push({ target, score });
  }

  ranked.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;

    const leftUrl = trimOptionalString(left.target.url);
    const rightUrl = trimOptionalString(right.target.url);
    if (isBlankLikeUrl(leftUrl) !== isBlankLikeUrl(rightUrl)) {
      return isBlankLikeUrl(leftUrl) ? 1 : -1;
    }

    const leftOpener = trimOptionalString(left.target.openerId);
    const rightOpener = trimOptionalString(right.target.openerId);
    if (leftOpener !== rightOpener) return rightOpener.localeCompare(leftOpener);

    return trimOptionalString(left.target.targetId).localeCompare(
      trimOptionalString(right.target.targetId),
    );
  });

  return ranked[0]?.target ?? null;
}

export async function waitForTargetUrlMatch(
  cdp: CdpClientLike,
  options: ReattachOptions = {},
): Promise<BrowserTargetInfo> {
  const timeoutMs = Number.isFinite(options.timeoutMs) ? Number(options.timeoutMs) : 120_000;
  const intervalMs = Number.isFinite(options.intervalMs) ? Number(options.intervalMs) : 500;
  const deadline = Date.now() + timeoutMs;

  let lastTargets: BrowserTargetInfo[] = [];
  while (Date.now() < deadline) {
    lastTargets = await getTargets(cdp);
    const chosen = chooseReattachTarget(lastTargets, options);
    if (chosen) return chosen;
    await sleep(intervalMs);
  }

  const expectedHosts = toLowerList(options.expectedHosts).join(", ") || "(none)";
  const expectedUrlSubstrings = toLowerList(options.expectedUrlSubstrings).join(", ") || "(none)";
  throw new Error(
    `timeout waiting for redirect target (seed=${trimOptionalString(options.seedTargetId || options.currentTargetId) || "?"} expectedHosts=${expectedHosts} expectedUrlSubstrings=${expectedUrlSubstrings} targets=${summarizeTargets(lastTargets)})`,
  );
}

export async function reattachAfterRedirect(
  cdp: CdpClientLike,
  options: ReattachOptions = {},
): Promise<{ sessionId: string; targetInfo: BrowserTargetInfo }> {
  const currentSessionId = trimOptionalString(options.currentSessionId);
  const currentTargetId = trimOptionalString(options.currentTargetId || options.seedTargetId);

  const targetInfo = await waitForTargetUrlMatch(cdp, {
    ...options,
    seedTargetId: currentTargetId,
  });

  const targetId = trimOptionalString(targetInfo.targetId);
  if (!targetId) {
    throw new Error("reattachAfterRedirect: target match returned no targetId");
  }

  if (targetId === currentTargetId) {
    return { sessionId: currentSessionId, targetInfo };
  }

  if (currentSessionId) {
    await cdp.send("Target.detachFromTarget", { sessionId: currentSessionId });
  }

  const attached = await cdp.send("Target.attachToTarget", { targetId });
  const sessionId = trimOptionalString(attached.sessionId);
  if (!sessionId) {
    throw new Error(`reattachAfterRedirect: attachToTarget returned no sessionId for ${targetId}`);
  }

  await cdp.send("Page.enable", {}, sessionId);
  await cdp.send("Runtime.enable", {}, sessionId);

  return { sessionId, targetInfo };
}

async function waitForCurrentSessionUrlMatch(
  cdp: CdpClientLike,
  options: ReattachOptions = {},
): Promise<string | null> {
  const currentSessionId = trimOptionalString(options.currentSessionId);
  if (!currentSessionId) return null;

  const timeoutMs = Number.isFinite(options.currentUrlTimeoutMs) ? Number(options.currentUrlTimeoutMs) : 4_000;
  const intervalMs = Number.isFinite(options.currentUrlIntervalMs) ? Number(options.currentUrlIntervalMs) : 250;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const result = await cdp.send(
      "Runtime.evaluate",
      { expression: "location.href", returnByValue: true },
      currentSessionId,
      Math.min(15_000, timeoutMs),
    );
    const value = trimOptionalString((result.result as { value?: string } | undefined)?.value);
    if (urlMatchesExpectations(value, options)) return value;
    await sleep(intervalMs);
  }

  return null;
}

export async function resolveSessionAfterNavigation(
  cdp: CdpClientLike,
  options: ReattachOptions = {},
): Promise<{ sessionId: string; targetInfo: BrowserTargetInfo; matchedCurrentSession: boolean }> {
  const currentSessionId = trimOptionalString(options.currentSessionId);
  const currentTargetId = trimOptionalString(options.currentTargetId || options.seedTargetId);

  const currentUrl = await waitForCurrentSessionUrlMatch(cdp, options);
  if (currentSessionId && currentUrl) {
    return {
      sessionId: currentSessionId,
      targetInfo: {
        ...(currentTargetId ? { targetId: currentTargetId } : {}),
        url: currentUrl,
      },
      matchedCurrentSession: true,
    };
  }

  const rebound = await reattachAfterRedirect(cdp, options);
  return { ...rebound, matchedCurrentSession: false };
}
