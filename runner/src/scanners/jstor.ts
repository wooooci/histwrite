#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { connectCdp, navigate, openAndAttach, readArg, readRepeated, sleep, waitForEval } from "./cdp.js";
import { reattachAfterRedirect } from "./cdp-target-rebind.js";
import { createRelayHistoryReporter } from "./relay-history.js";
import { resolveHistwriteLayout } from "../project.js";

export const DEFAULT_CDP_WS_URL = "ws://127.0.0.1:18992/cdp";
export const DEFAULT_JSTOR_START_URL = "https://www-jstor-org.proxy.lib.umich.edu/";

export type JstorItem = {
  title: string;
  authors: string;
  source: string;
  content_type: string;
  stable_id: string;
  doi: string;
  url: string;
};

export type JstorResultBlock = {
  titleText: string;
  stableHref: string;
  authorsText: string;
  sourceText: string;
  contentTypeText: string;
  containerText: string;
};

export type JstorQueryResult = {
  key: string;
  term_1: string;
  term_2: string;
  date_from: string;
  date_to: string;
  total_results: number | null;
  current_url: string;
  pages_scanned: number;
  items: JstorItem[];
};

export type JstorDigestInput = {
  baseTerm: string;
  dateFrom: string;
  dateTo: string;
  origin: string;
  accessibleOnly: boolean;
  queries: JstorQueryResult[];
};

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function nowDateYYYYMMDD(): string {
  const today = new Date();
  const year = String(today.getFullYear());
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function slugify(value: string): string {
  return (
    String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80) || "query"
  );
}

function normalizeText(value: string): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function extractStableIdFromHref(value: string): string {
  const matched = String(value || "").match(/\/stable\/([0-9]+)\b/);
  return matched ? matched[1] : "";
}

function extractDoiFromText(value: string): string {
  const matched = String(value || "").match(/10\.[0-9]{4,9}\/[-._;()/:A-Z0-9]+/i);
  return matched ? matched[0] : "";
}

export function buildAdvancedSearchUrl(params: {
  origin: string;
  baseTerm: string;
  term2?: string;
  dateFrom?: string;
  dateTo?: string;
  accessibleOnly?: boolean;
  lang?: string;
  sort?: string;
}): string {
  const url = new URL("/action/doAdvancedSearch", params.origin);
  url.searchParams.set("q0", params.baseTerm);
  url.searchParams.set("f0", "all");
  if (params.term2) {
    url.searchParams.set("c1", "AND");
    url.searchParams.set("q1", params.term2);
    url.searchParams.set("f1", "all");
  }
  if (params.accessibleOnly) url.searchParams.set("acc", "on");
  if (params.lang) url.searchParams.set("la", params.lang);
  if (params.dateFrom) url.searchParams.set("sd", String(params.dateFrom));
  if (params.dateTo) url.searchParams.set("ed", String(params.dateTo));
  url.searchParams.set("ar", "");
  if (params.sort) url.searchParams.set("so", params.sort);
  return url.toString();
}

export function buildItemsFromResultBlocks(blocks: JstorResultBlock[]): JstorItem[] {
  const order: string[] = [];
  const byStableId = new Map<string, JstorItem>();

  for (const block of blocks) {
    const stableId = extractStableIdFromHref(block.stableHref);
    const title = normalizeText(block.titleText);
    if (!stableId || !title) continue;

    const next: JstorItem = {
      title,
      authors: normalizeText(block.authorsText),
      source: normalizeText(block.sourceText),
      content_type: normalizeText(block.contentTypeText),
      stable_id: stableId,
      doi: extractDoiFromText(block.containerText),
      url: String(block.stableHref || "").trim(),
    };

    const existing = byStableId.get(stableId);
    if (!existing) {
      byStableId.set(stableId, next);
      order.push(stableId);
      continue;
    }

    byStableId.set(stableId, {
      title: next.title.length > existing.title.length ? next.title : existing.title,
      authors: existing.authors || next.authors,
      source: existing.source || next.source,
      content_type: existing.content_type || next.content_type,
      stable_id: stableId,
      doi: existing.doi || next.doi,
      url: existing.url || next.url,
    });
  }

  return order.map((stableId) => byStableId.get(stableId)).filter(Boolean) as JstorItem[];
}

export function parseJstorTotalText(value: string): number | null {
  const text = normalizeText(value);
  if (!text) return null;

  const directResultsMatch = text.match(/(^|[^0-9])([0-9][0-9,]*)\s+results?\b/i);
  if (directResultsMatch?.[2]) {
    return Number(directResultsMatch[2].replace(/,/g, ""));
  }

  const ofMatch = text.match(/\bof\s*([0-9][0-9,]*)\b/i);
  if (ofMatch?.[1]) {
    return Number(ofMatch[1].replace(/,/g, ""));
  }

  const chineseMatch = text.match(/的\s*([0-9][0-9,]*)/);
  if (chineseMatch?.[1]) {
    return Number(chineseMatch[1].replace(/,/g, ""));
  }

  const allNumbers = text.match(/[0-9][0-9,]*/g) || [];
  if (allNumbers.length === 1) {
    return Number(allNumbers[0]!.replace(/,/g, ""));
  }

  return null;
}

function resolveJstorTotalResults(texts: string[]): number | null {
  for (const text of texts) {
    const parsed = parseJstorTotalText(text);
    if (typeof parsed === "number" && Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
  }
  return null;
}

export function isJstorResultsReadySnapshot(snapshot: {
  itemCount?: number;
  titleHostCount?: number;
  no?: boolean;
}): boolean {
  if (snapshot.no === true) return true;
  if (typeof snapshot.itemCount === "number" && snapshot.itemCount > 0) return true;
  if (typeof snapshot.titleHostCount === "number" && snapshot.titleHostCount > 0) return true;
  return false;
}

async function waitForResultsReady(cdp: Awaited<ReturnType<typeof connectCdp>>["cdp"], sessionId: string): Promise<void> {
  await waitForEval<string>(
    cdp,
    sessionId,
    "document.readyState",
    (value) => value === "complete" || value === "interactive",
    180_000,
  );

  await waitForEval<{ n?: number; no?: boolean }>(
    cdp,
    sessionId,
    `(() => {
      const itemCount = document.querySelectorAll('li.result-list__item').length;
      const titleHostCount = document.querySelectorAll('[data-qa="search-result-title-link"]').length;
      const t = (document.body?.innerText || '').toLowerCase();
      const no =
        t.includes('no results') ||
        t.includes('no matches') ||
        t.includes('0 results') ||
        t.includes('无结果') ||
        t.includes('没有找到');
      return { itemCount, titleHostCount, no };
    })()`,
    (value) => isJstorResultsReadySnapshot(value || {}),
    180_000,
  ).catch(() => {});
}

async function extractPage(
  cdp: Awaited<ReturnType<typeof connectCdp>>["cdp"],
  sessionId: string,
): Promise<{
  href: string;
  title: string;
  countTexts: string[];
  rows: JstorResultBlock[];
  next: string;
}> {
  const result = await cdp.send(
    "Runtime.evaluate",
    {
      expression: `(() => {
        const norm = (s) => String(s || '').replace(/\\s+/g, ' ').trim();
        const href = location.href;
        const title = document.title || '';
        const bodyText = document.body?.innerText || '';

        const countEls = [
          document.querySelector('[data-qa*="results"]'),
          document.querySelector('[class*="results-count"]'),
          document.querySelector('[class*="result-count"]'),
          document.querySelector('[aria-live="polite"]'),
          document.querySelector('div.search-results__count'),
        ].filter(Boolean);
        const countTexts = countEls
          .map((el) => norm(el.innerText || el.textContent || ''))
          .filter(Boolean);
        const resultLines = bodyText
          .split('\\n')
          .map((line) => norm(line))
          .filter((line) => /results?/i.test(line))
          .slice(0, 20);
        countTexts.push(...resultLines);

        const items = Array.from(document.querySelectorAll('li.result-list__item'));
        const rows = items.map((item) => {
          const titleHost = item.querySelector('[data-qa="search-result-title-link"]');
          const titleText = norm(
            titleHost?.textContent ||
            item.querySelector('.title')?.textContent ||
            '',
          );
          const stableLink =
            titleHost?.shadowRoot?.querySelector?.('a[href*="/stable/"]') ||
            null;
          const stableHref = stableLink?.href || '';
          const authorsText = norm(
            item.querySelector('[data-qa="search-result-authors"]')?.textContent || '',
          );
          const sourceText = norm(
            item.querySelector('[data-qa="item-src-info"]')?.textContent || '',
          );
          const contentTypeText = norm(
            item.querySelector('[data-qa="content-type"]')?.textContent || '',
          );
          const containerText = norm(item.textContent || '');
          return {
            titleText,
            stableHref,
            authorsText,
            sourceText,
            contentTypeText,
            containerText,
          };
        }).filter((row) => row.titleText || row.stableHref);

        const nextA =
          document.querySelector('a[rel="next"]') ||
          document.querySelector('a[aria-label*="Next"]') ||
          document.querySelector('a[aria-label*="下一"]') ||
          Array.from(document.querySelectorAll('a')).find(a => {
            const t = norm(a.textContent || '');
            if (!t) return false;
            if (!/(next|下一)/i.test(t)) return false;
            const inPager = a.closest('[class*="pagin"], nav') != null;
            return inPager && a.href;
          });

        const next = nextA?.href || '';
        return { href, title, countTexts, rows, next };
      })()`,
      returnByValue: true,
    },
    sessionId,
    60_000,
  );

  if (result.exceptionDetails) {
    const exception = result.exceptionDetails as {
      exception?: { description?: string };
    };
    throw new Error(exception.exception?.description || "extractPage exception");
  }

  return ((result.result as { value?: unknown } | undefined)?.value ?? {
    href: "",
    title: "",
    countTexts: [],
    rows: [],
    next: "",
  }) as {
    href: string;
    title: string;
    countTexts: string[];
    rows: JstorResultBlock[];
    next: string;
  };
}

export function toMarkdownDigest(input: JstorDigestInput): string {
  const lines: string[] = [];
  lines.push("# JSTOR 高级检索候选");
  lines.push("");
  lines.push(`生成时间：${new Date().toLocaleString("zh-CN")}`);
  lines.push(`访问源：${input.origin}`);
  lines.push(`基础词（q0）：\`${input.baseTerm}\``);
  if (input.dateFrom || input.dateTo) {
    lines.push(`时间范围：${input.dateFrom || "?"}-${input.dateTo || "?"}`);
  }
  lines.push(`仅可访问（acc=on）：${input.accessibleOnly ? "是" : "否"}`);
  lines.push("");

  for (const query of input.queries) {
    lines.push(`## ${query.key}`);
    lines.push(`- 主题词（q1）：${query.term_2 || "(无)"}`);
    if (query.date_from || query.date_to) {
      lines.push(`- 时间：${query.date_from || "?"}-${query.date_to || "?"}`);
    }
    if (typeof query.total_results === "number") {
      lines.push(`- 命中总量：${query.total_results}`);
    }
    if (query.current_url) {
      lines.push(`- 结果页：${query.current_url}`);
    }
    lines.push("");
    let index = 0;
    for (const item of query.items || []) {
      index += 1;
      lines.push(`${index}. ${item.title || "(无标题)"}`);
      if (item.authors) lines.push(`   - 作者：${item.authors}`);
      if (item.source) lines.push(`   - 来源：${item.source}`);
      if (item.content_type) lines.push(`   - 类型：${item.content_type}`);
      if (item.stable_id) {
        lines.push(`   - Stable：${item.stable_id}${item.doi ? `；DOI：${item.doi}` : ""}`);
      }
      if (item.url) lines.push(`   - 链接：${item.url}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export async function main(rawArgs = process.argv.slice(2)): Promise<void> {
  const projectDir = readArg(rawArgs, "--project", process.cwd()) ?? process.cwd();
  const layout = resolveHistwriteLayout(projectDir);
  const baseTerm =
    readArg(rawArgs, "--base-term", readArg(rawArgs, "--term-1", "Walter Lippmann")) ||
    "Walter Lippmann";
  const startUrl = readArg(rawArgs, "--start-url", DEFAULT_JSTOR_START_URL) || DEFAULT_JSTOR_START_URL;
  const dateFrom = readArg(rawArgs, "--date-from", "") || "";
  const dateTo = readArg(rawArgs, "--date-to", "") || "";
  const accessibleOnly = (readArg(rawArgs, "--acc", "on") || "on").toLowerCase() !== "off";
  const lang = readArg(rawArgs, "--lang", "eng OR en") || "eng OR en";
  const sort = readArg(rawArgs, "--sort", "rel") || "rel";
  const outDir =
    readArg(rawArgs, "--out-dir", readArg(rawArgs, "--outDir", layout.materialsIndexDir)) ||
    layout.materialsIndexDir;
  const maxItems = Number(readArg(rawArgs, "--max-items", "15") || "15");
  const maxPages = Number(readArg(rawArgs, "--max-pages", "1") || "1");

  const term2ListRaw = [...readRepeated(rawArgs, "--term-2"), ...readRepeated(rawArgs, "--term2")];
  const termsCsv = readArg(rawArgs, "--terms", "") || "";
  const term2List = [
    ...term2ListRaw,
    ...(termsCsv ? termsCsv.split(",").map((value) => value.trim()).filter(Boolean) : []),
  ];
  const queries = term2List.length
    ? term2List.map((term) => ({ key: slugify(term), term_2: term }))
    : [{ key: "q0", term_2: "" }];

  ensureDir(outDir);
  const stamp = nowDateYYYYMMDD();
  const baseName = `jstor_advanced_search_${slugify(baseTerm)}_${stamp}`;
  const jsonPath = path.join(outDir, `${baseName}.json`);
  const mdPath = path.join(outDir, `${baseName}.md`);

  const relay = createRelayHistoryReporter({
    args: rawArgs,
    defaultCdpWsUrl: DEFAULT_CDP_WS_URL,
    defaultClient: "histwrite-jstor",
  });

  let ws: Awaited<ReturnType<typeof connectCdp>>["ws"] | null = null;
  try {
    await relay.annotate({
      label: "JSTOR advanced search",
      note: "开始检索",
      data: {
        database: "JSTOR (Advanced Search)",
        projectDir: layout.projectDir,
        baseTerm,
        term2List,
        dateFrom,
        dateTo,
        accessibleOnly,
        lang,
        sort,
        maxItems,
        maxPages,
        outDir,
      },
    });

    const connected = await connectCdp(relay.cdpWsUrl);
    ws = connected.ws;
    const cdp = connected.cdp;

    const seedPage = await openAndAttach(cdp, "about:blank");
    await navigate(cdp, seedPage.sessionId, startUrl);
    const rebound = await reattachAfterRedirect(cdp, {
      currentSessionId: seedPage.sessionId,
      currentTargetId: seedPage.targetId,
      expectedHosts: ["jstor", "proxy.lib.umich.edu"],
      timeoutMs: 180_000,
    });
    const sessionId = rebound.sessionId;
    const origin = await waitForEval<string>(
      cdp,
      sessionId,
      "location.href",
      (href) => typeof href === "string" && href.length > 0 && href.includes("jstor"),
      180_000,
    )
      .then((href) => {
        try {
          return new URL(href).origin;
        } catch {
          return DEFAULT_JSTOR_START_URL.replace(/\/$/, "");
        }
      })
      .catch(() => DEFAULT_JSTOR_START_URL.replace(/\/$/, ""));

    const queryResults: JstorQueryResult[] = [];
    for (const query of queries) {
      const url = buildAdvancedSearchUrl({
        origin,
        baseTerm,
        term2: query.term_2,
        dateFrom,
        dateTo,
        accessibleOnly,
        lang,
        sort,
      });

      const seen = new Set<string>();
      const items: JstorItem[] = [];
      let totalResults: number | null = null;
      let currentUrl = url;
      let pages = 0;
      let next = url;

      while (true) {
        pages += 1;
        await navigate(cdp, sessionId, pages === 1 ? url : next);
        await waitForResultsReady(cdp, sessionId);
        const pageData = await extractPage(cdp, sessionId);
        if (pageData.href) currentUrl = pageData.href;
        if (totalResults == null) {
          totalResults = resolveJstorTotalResults(pageData.countTexts ?? []);
        }

        for (const row of buildItemsFromResultBlocks(pageData.rows ?? [])) {
          const stableKey = row.stable_id || row.doi || row.url || JSON.stringify(row);
          if (seen.has(stableKey)) continue;
          seen.add(stableKey);
          items.push(row);
          if (items.length >= maxItems) break;
        }

        next = pageData.next || "";
        if (items.length >= maxItems) break;
        if (!next || next === currentUrl) break;
        if (maxPages > 0 && pages >= maxPages) break;
        await sleep(800);
      }

      queryResults.push({
        key: query.key || slugify(query.term_2 || "q0"),
        term_1: baseTerm,
        term_2: query.term_2,
        date_from: dateFrom,
        date_to: dateTo,
        total_results: totalResults,
        current_url: currentUrl,
        pages_scanned: pages,
        items,
      });
    }

    const payload = {
      generatedAt: new Date().toISOString(),
      database: "JSTOR (Advanced Search)",
      baseUrl: origin,
      origin,
      baseTerm,
      date_from: dateFrom,
      date_to: dateTo,
      accessibleOnly,
      lang,
      sort,
      queries: queryResults,
    };

    fs.writeFileSync(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    fs.writeFileSync(
      mdPath,
      `${toMarkdownDigest({
        baseTerm,
        dateFrom,
        dateTo,
        origin,
        accessibleOnly,
        queries: queryResults,
      })}\n`,
      "utf8",
    );

    await relay.annotate({
      label: "JSTOR advanced search",
      note: "检索完成",
      data: {
        database: payload.database,
        baseTerm,
        queryCount: queryResults.length,
        queries: queryResults.map((query) => ({
          key: query.key,
          term2: query.term_2,
          totalResults: query.total_results,
          pagesScanned: query.pages_scanned,
          rowCount: query.items.length,
          url: query.current_url,
        })),
        output: { jsonPath, mdPath },
      },
    });

    const report = await relay.writeSearchReport({
      outDir,
      baseName,
      title: "JSTOR 检索报告",
      extra: {
        database: payload.database,
        output: { jsonPath, mdPath },
      },
    });

    console.log(`Report:\n- ${report.jsonPath}\n- ${report.mdPath}`);
    console.log(`Wrote:\n- ${jsonPath}\n- ${mdPath}`);
    console.log(`queries=${queryResults.length} maxItems=${maxItems}`);
  } catch (error) {
    await relay.annotate({
      label: "JSTOR advanced search",
      note: `检索失败: ${relay.summarizeError(error)}`,
      data: {
        database: "JSTOR (Advanced Search)",
        projectDir: layout.projectDir,
        baseTerm,
        term2List,
        dateFrom,
        dateTo,
        accessibleOnly,
        outDir,
      },
    });

    await relay.writeSearchReport({
      outDir,
      baseName,
      title: "JSTOR 检索报告（失败）",
      extra: {
        database: "JSTOR (Advanced Search)",
        status: "failed",
      },
    });
    throw error;
  } finally {
    ws?.close();
  }
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
const currentFilePath = fileURLToPath(import.meta.url);
if (entryPath === currentFilePath) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
