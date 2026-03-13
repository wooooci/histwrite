import { normalizeRelayBaseUrl } from "../capture.js";
import { connectCdp, navigate, openAndAttach, sleep, trimOptionalString, type CdpClientLike } from "../scanners/cdp.js";
import { getTargets } from "../scanners/cdp-target-rebind.js";
import type { UmichHitLike } from "./matrix.js";

export type VendorLandingResolverDeps = {
  fetchImpl?: typeof fetch;
  concurrency?: number;
  relayBaseUrl?: string;
  cdpWsUrl?: string;
  resolveViaRelay?: (ddmUrl: string, deps?: VendorLandingResolverDeps) => Promise<string | null>;
  connectCdpImpl?: typeof connectCdp;
  sleepImpl?: typeof sleep;
};

type TargetLike = {
  targetId?: string;
  openerId?: string;
  type?: string;
  url?: string;
};

function readNullableString(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function parseUrl(value: string | null): URL | null {
  if (!value) return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function isBlankLikeUrl(url: string | null): boolean {
  const value = trimOptionalString(url);
  return (
    value === "" ||
    value === "about:blank" ||
    value === "about:srcdoc" ||
    value.startsWith("chrome://newtab")
  );
}

function isDdmPermalink(url: string | null): boolean {
  const parsed = parseUrl(url);
  return parsed?.hostname === "ddm.dnd.lib.umich.edu" && parsed.pathname.startsWith("/database/link/") === true;
}

function extractMetaRefreshLocation(html: string): string | null {
  const match = html.match(/http-equiv=["']refresh["'][^>]*content=["'][^"']*url='?([^"'>]+)'?["']/i);
  return match?.[1] ? String(match[1]).trim() : null;
}

function normalizeEncodingArtifacts(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&amp%3B/gi, "&")
    .replace(/%26amp%3B/gi, "&")
    .replace(/amp%3B/gi, "");
}

function canReturnAsLanding(url: string | null): boolean {
  const normalized = normalizeVendorLandingLocation(url);
  return Boolean(normalized && !isBlankLikeUrl(normalized) && !isDdmPermalink(normalized));
}

export function relayBaseUrlToCdpWsUrl(relayBaseUrl: string): string {
  const parsed = new URL(normalizeRelayBaseUrl(relayBaseUrl));
  parsed.protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
  parsed.pathname = "/cdp";
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

async function readLocationHref(cdp: CdpClientLike, sessionId: string): Promise<string | null> {
  if (!trimOptionalString(sessionId)) return null;
  const result = await cdp.send(
    "Runtime.evaluate",
    { expression: "location.href", returnByValue: true },
    sessionId,
    15_000,
  );
  if (result.exceptionDetails) {
    const exception = result.exceptionDetails as {
      exception?: { description?: string };
    };
    throw new Error(exception.exception?.description || "Runtime.evaluate exception");
  }
  return readNullableString((result.result as { value?: string } | undefined)?.value);
}

function isRelatedTarget(target: TargetLike, knownTargetIds: Set<string>): boolean {
  const targetId = trimOptionalString(target.targetId);
  const openerId = trimOptionalString(target.openerId);
  if (!targetId) return false;
  return knownTargetIds.has(targetId) || (openerId ? knownTargetIds.has(openerId) : false);
}

function choosePromisingRelayTarget(targets: TargetLike[], knownTargetIds: Set<string>): TargetLike | null {
  const related = targets.filter((target) => {
    const type = trimOptionalString(target.type || "page");
    if (type !== "page") return false;
    if (!isRelatedTarget(target, knownTargetIds)) return false;
    if (isBlankLikeUrl(target.url ?? null)) return false;
    return true;
  });

  const resolvedLanding = related.find((target) => canReturnAsLanding(target.url ?? null));
  if (resolvedLanding) return resolvedLanding;
  return related[0] ?? null;
}

async function closeTargetSafely(cdp: CdpClientLike, targetId: string): Promise<void> {
  try {
    await cdp.send("Target.closeTarget", { targetId });
  } catch {
    // Best-effort cleanup only.
  }
}

export function decodeVendorUrlFromProxyUrl(url: string): string | null {
  const parsed = parseUrl(url);
  if (!parsed || parsed.hostname !== "proxy.lib.umich.edu") return null;

  const proxied = parsed.searchParams.get("qurl") ?? parsed.searchParams.get("url");
  if (!proxied) return null;
  return readNullableString(normalizeEncodingArtifacts(proxied));
}

export function normalizeVendorLandingLocation(location: string | null): string | null {
  const normalized = readNullableString(location ? normalizeEncodingArtifacts(location) : location);
  if (!normalized) return null;
  return decodeVendorUrlFromProxyUrl(normalized) ?? normalized;
}

export async function resolveVendorLandingViaRelay(
  ddmUrl: string,
  deps: VendorLandingResolverDeps = {},
): Promise<string | null> {
  const connectCdpImpl = deps.connectCdpImpl ?? connectCdp;
  const sleepImpl = deps.sleepImpl ?? sleep;
  const cdpWsUrl = trimOptionalString(deps.cdpWsUrl) || relayBaseUrlToCdpWsUrl(deps.relayBaseUrl ?? "http://127.0.0.1:18992");

  const connected = await connectCdpImpl(cdpWsUrl);
  const cdp = connected.cdp;
  const closeWs = () => {
    try {
      connected.ws.close();
    } catch {
      // Ignore websocket close failures.
    }
  };

  let currentTargetId = "";
  let currentSessionId = "";
  const knownTargetIds = new Set<string>();
  const deadline = Date.now() + 45_000;

  try {
    const opened = await openAndAttach(cdp, "about:blank");
    currentTargetId = trimOptionalString(opened.targetId);
    currentSessionId = trimOptionalString(opened.sessionId);
    if (currentTargetId) knownTargetIds.add(currentTargetId);

    await navigate(cdp, currentSessionId, ddmUrl);

    while (Date.now() < deadline) {
      const currentUrl = await readLocationHref(cdp, currentSessionId).catch(() => null);
      const normalizedCurrent = normalizeVendorLandingLocation(currentUrl);
      if (canReturnAsLanding(normalizedCurrent)) {
        return normalizedCurrent;
      }

      const targets = await getTargets(cdp).catch(() => []);
      const candidate = choosePromisingRelayTarget(targets, knownTargetIds);
      const candidateTargetId = trimOptionalString(candidate?.targetId);
      const candidateOpenerId = trimOptionalString(candidate?.openerId);
      if (candidateTargetId) knownTargetIds.add(candidateTargetId);
      if (candidateOpenerId) knownTargetIds.add(candidateOpenerId);

      const normalizedCandidate = normalizeVendorLandingLocation(candidate?.url ?? null);
      if (canReturnAsLanding(normalizedCandidate)) {
        return normalizedCandidate;
      }

      if (candidateTargetId && candidateTargetId !== currentTargetId) {
        try {
          await cdp.send("Target.detachFromTarget", { sessionId: currentSessionId });
        } catch {
          // Ignore stale-session detach errors.
        }
        const attached = await cdp.send("Target.attachToTarget", { targetId: candidateTargetId });
        currentTargetId = candidateTargetId;
        currentSessionId = trimOptionalString(attached.sessionId);
        await cdp.send("Page.enable", {}, currentSessionId);
        await cdp.send("Runtime.enable", {}, currentSessionId);
      }

      await sleepImpl(250);
    }
  } finally {
    for (const targetId of knownTargetIds) {
      if (targetId) await closeTargetSafely(cdp, targetId);
    }
    closeWs();
  }

  return null;
}

export async function resolveVendorLandingForHit(
  hit: UmichHitLike,
  deps: VendorLandingResolverDeps = {},
): Promise<UmichHitLike> {
  const explicit = readNullableString(hit.landingUrl) ?? readNullableString(hit.resolvedUrl);
  if (explicit) return hit;

  const url = readNullableString(hit.url);
  if (!url) return hit;

  const proxyResolved = decodeVendorUrlFromProxyUrl(url);
  if (proxyResolved) {
    return {
      ...hit,
      resolvedUrl: proxyResolved,
    };
  }

  if (!isDdmPermalink(url)) return hit;

  let resolvedUrl: string | null = null;
  try {
    resolvedUrl = await (deps.resolveViaRelay ?? resolveVendorLandingViaRelay)(url, deps);
  } catch {
    return hit;
  }
  const normalizedResolvedUrl = normalizeVendorLandingLocation(resolvedUrl);
  if (!normalizedResolvedUrl) return hit;

  return {
    ...hit,
    resolvedUrl: normalizedResolvedUrl,
  };
}

export async function hydrateUmichHitsWithVendorLanding(
  hits: UmichHitLike[],
  deps: VendorLandingResolverDeps = {},
): Promise<UmichHitLike[]> {
  const input = Array.isArray(hits) ? hits : [];
  const concurrency = Math.max(1, Math.min(4, deps.concurrency ?? 1));
  const output = new Array<UmichHitLike>(input.length);
  let cursor = 0;

  async function worker() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= input.length) return;
      output[index] = await resolveVendorLandingForHit(input[index]!, deps);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, input.length || 1) }, () => worker()));
  return output;
}
