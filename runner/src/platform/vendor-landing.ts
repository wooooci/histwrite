import type { UmichHitLike } from "./matrix.js";

export type VendorLandingResolverDeps = {
  fetchImpl?: typeof fetch;
  concurrency?: number;
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

  const fetchImpl = deps.fetchImpl ?? fetch;
  const response = await fetchImpl(url, {
    method: "GET",
    redirect: "manual",
  });

  let location = normalizeVendorLandingLocation(response.headers.get("location"));
  if (!location) {
    const body = await response.text();
    location = normalizeVendorLandingLocation(extractMetaRefreshLocation(body));
  }

  if (!location) return hit;
  return {
    ...hit,
    resolvedUrl: location,
  };
}

export async function hydrateUmichHitsWithVendorLanding(
  hits: UmichHitLike[],
  deps: VendorLandingResolverDeps = {},
): Promise<UmichHitLike[]> {
  const input = Array.isArray(hits) ? hits : [];
  const concurrency = Math.max(1, Math.min(16, deps.concurrency ?? 8));
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
