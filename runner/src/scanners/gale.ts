#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { connectCdp, navigate, openAndAttach, readArg, sleep, waitForEval } from "./cdp.js";
import { resolveSessionAfterNavigation } from "./cdp-target-rebind.js";
import { createRelayHistoryReporter } from "./relay-history.js";
import { resolveHistwriteLayout } from "../project.js";

export const DEFAULT_CDP_WS_URL = "ws://127.0.0.1:18992/cdp";
export const DEFAULT_GALE_START_URL = "https://ddm.dnd.lib.umich.edu/database/link/9041";

function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true });
}

function nowDateYYYYMMDD() {
  const d = new Date();
  const yyyy = String(d.getFullYear());
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function slugify(s: string) {
  return (
    String(s || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80) || "query"
  );
}

function parseIntLoose(s: string) {
  const m = String(s ?? "").match(/[0-9][0-9,]*/);
  if (!m) return null;
  return Number(m[0].replace(/,/g, ""));
}

function parseYearLoose(s: string) {
  const m = String(s ?? "").match(/(18|19|20)\d{2}/);
  return m ? Number(m[0]) : null;
}

export type GaleSubmitControlSummary = {
  tag?: string;
  id?: string;
  type?: string;
};

export function chooseGaleSubmitSelector(controls: GaleSubmitControlSummary[]): string | null {
  const normalized = Array.isArray(controls) ? controls : [];

  const hasLegacySubmit = normalized.some(
    (control) => String(control?.id ?? "").trim() === "homepage_submit" && String(control?.type ?? "").trim() === "submit",
  );
  if (hasLegacySubmit) return "#homepage_submit";

  const hasSubmitButton = normalized.some(
    (control) => String(control?.tag ?? "").trim().toUpperCase() === "BUTTON" && String(control?.type ?? "").trim() === "submit",
  );
  if (hasSubmitButton) return '#quickSearchForm button[type="submit"]';

  const hasSubmitInput = normalized.some(
    (control) => String(control?.tag ?? "").trim().toUpperCase() === "INPUT" && String(control?.type ?? "").trim() === "submit",
  );
  if (hasSubmitInput) return '#quickSearchForm input[type="submit"]';

  return null;
}

export function shouldFollowGaleNextPage(params: {
  maxPages: number;
  pagesScanned: number;
  nextHref?: string | null;
}): boolean {
  const nextHref = String(params.nextHref ?? "").trim();
  if (!nextHref) return false;
  if (params.maxPages > 0 && params.pagesScanned >= params.maxPages) return false;
  return true;
}

export function parsePubDateFromAboutUrl(aboutUrl: string) {
  try {
    const u = new URL(aboutUrl);
    const raw = u.searchParams.get("pubDate") || "";
    const digits = raw.replace(/\D/g, "");
    const last8 = digits.length >= 8 ? digits.slice(-8) : "";
    if (!/^\d{8}$/.test(last8)) return null;
    const yyyy = last8.slice(0, 4);
    const mm = last8.slice(4, 6);
    const dd = last8.slice(6, 8);
    return `${yyyy}-${mm}-${dd}`;
  } catch {
    return null;
  }
}

async function runBasicSearch(
  cdp: Awaited<ReturnType<typeof connectCdp>>["cdp"],
  page: { sessionId: string; targetId: string },
  params: { startUrl: string; term: string },
) {
  let activeSessionId = page.sessionId;
  let activeTargetId = page.targetId;

  await navigate(cdp, activeSessionId, params.startUrl);
  const rebound = await resolveSessionAfterNavigation(cdp, {
    currentSessionId: activeSessionId,
    currentTargetId: activeTargetId,
    expectedHosts: ["gale", "proxy.lib.umich.edu", "galegroup"],
    expectedUrlSubstrings: ["/ps/"],
    timeoutMs: 180_000,
    currentUrlTimeoutMs: 8_000,
  });
  activeSessionId = rebound.sessionId;
  activeTargetId = rebound.targetInfo?.targetId || activeTargetId;

  const readyState = await waitForEval<{
    hasForm?: boolean;
    hasInput?: boolean;
    submitControls?: GaleSubmitControlSummary[];
  }>(
    cdp,
    activeSessionId,
    `(() => {
      const form = document.querySelector('form#quickSearchForm');
      const input = document.querySelector('input#inputFieldValue_0');
      const submitControls = Array.from(
        form?.querySelectorAll('#homepage_submit, button[type="submit"], input[type="submit"]') || [],
      ).map((el) => ({
        tag: el.tagName || '',
        id: el.id || '',
        type: (el.getAttribute('type') || '').trim().toLowerCase(),
      }));
      return {
        hasForm: !!form,
        hasInput: !!input,
        submitControls,
      };
    })()`,
    (value) => value?.hasForm === true && value?.hasInput === true,
    180_000,
  );
  const submitSelector = chooseGaleSubmitSelector(readyState?.submitControls ?? []);

  const beforeHref = await waitForEval(
    cdp,
    activeSessionId,
    "location.href",
    (h) => typeof h === "string" && h.length > 0,
  );

  const submitResult = await cdp.send(
    "Runtime.evaluate",
    {
      expression: `(() => {
        const form = document.querySelector('form#quickSearchForm');
        const input = form?.querySelector('input#inputFieldValue_0') || document.querySelector('input#inputFieldValue_0');
        if (!form) return { ok: false, why: 'no form' };
        if (!input) return { ok: false, why: 'no input' };
        input.value = ${JSON.stringify(params.term)};
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        const submitSelector = ${JSON.stringify(submitSelector)};
        const submitControl = submitSelector ? document.querySelector(submitSelector) : null;
        if (submitControl instanceof HTMLElement) {
          submitControl.click();
          return { ok: true, strategy: 'click', submitSelector };
        }
        if (typeof form.requestSubmit === 'function') {
          form.requestSubmit();
          return { ok: true, strategy: 'requestSubmit', submitSelector };
        }
        if (typeof form.submit === 'function') {
          form.submit();
          return { ok: true, strategy: 'submit', submitSelector };
        }
        return { ok: false, why: 'no submit path', submitSelector };
      })()`,
      returnByValue: true,
    },
    activeSessionId,
    60_000,
  );
  const submitState = (submitResult?.result as { value?: any } | undefined)?.value ?? null;
  if (!submitState?.ok) {
    throw new Error(`Gale basic search submit failed: ${JSON.stringify(submitState)}`);
  }

  const resultsHref = await waitForEval(
    cdp,
    activeSessionId,
    "location.href",
    (h) => typeof h === "string" && h !== beforeHref && h.includes("/ps/") && h.includes("Search"),
    180_000,
  ).catch(async () => {
    await waitForEval(
      cdp,
      activeSessionId,
      "document.querySelectorAll('[id$=\"-title\"]').length",
      (n) => typeof n === "number" && n > 0,
      180_000,
    );
    return await waitForEval(cdp, activeSessionId, "location.href", (h) => typeof h === "string" && h.length > 0);
  });

  await waitForResultsReady(cdp, activeSessionId);

  return {
    resultsHref,
    page: { sessionId: activeSessionId, targetId: activeTargetId },
  };
}

async function _readResultsMeta(cdp: Awaited<ReturnType<typeof connectCdp>>["cdp"], sessionId: string) {
  const res = await cdp.send(
    "Runtime.evaluate",
    {
      expression: `(() => {
        const reTitle = new RegExp('^[A-Z]+\\\\d+-title$');
        const n = Array.from(document.querySelectorAll('[id$="-title"]')).filter(e => reTitle.test(e.id)).length;
        const bodyText = document.body?.innerText || '';
        const m = bodyText.match(/\\b([0-9][0-9,]*)\\s*RESULTS\\b/i);
        const hitCount = m ? Number(m[1].replace(/,/g, '')) : null;
        const currentPage = document.querySelector('.pagination-current')?.textContent?.trim() || null;
        const hasNext = !!document.querySelector('a.pagination-next');
        return { n, hitCount, currentPage, hasNext };
      })()`,
      returnByValue: true,
    },
    sessionId,
    60_000,
  );
  if (res.exceptionDetails) {
    const desc = (res.exceptionDetails as { exception?: { description?: string } }).exception?.description;
    throw new Error(desc || "_readResultsMeta exception");
  }
  return (res?.result as { value?: any } | undefined)?.value ?? null;
}

async function waitForResultsReady(
  cdp: Awaited<ReturnType<typeof connectCdp>>["cdp"],
  sessionId: string,
  timeoutMs = 180_000,
) {
  let lastN: number | null = null;
  let stable = 0;
  let lastMeta: any = null;

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const meta = await _readResultsMeta(cdp, sessionId);
    lastMeta = meta;
    const n = meta?.n ?? 0;

    if (typeof n === "number" && n > 0 && n === lastN) stable += 1;
    else stable = 0;
    lastN = n;

    if (n >= 20) return meta;
    if (stable >= 4 && n >= 15) return meta;
    if (stable >= 8 && n > 0) return meta;

    await sleep(500);
  }

  let href = "";
  let title = "";
  let preview = "";
  try {
    href = await waitForEval(cdp, sessionId, "location.href", (h) => typeof h === "string" && h.length > 0, 15_000);
    title = await waitForEval(cdp, sessionId, "document.title", (t) => typeof t === "string", 15_000);
    preview = await waitForEval(
      cdp,
      sessionId,
      "(document.body && document.body.innerText || '').slice(0, 240)",
      (s) => typeof s === "string",
      15_000,
    );
  } catch {}

  throw new Error(
    `timeout waiting for Gale results to fully render (href=${href} title=${JSON.stringify(
      title,
    )} n=${lastMeta?.n ?? "?"} hitCount=${lastMeta?.hitCount ?? "?"} page=${JSON.stringify(
      lastMeta?.currentPage ?? null,
    )} preview=${JSON.stringify(preview)})`,
  );
}

async function extractResultsPage(cdp: Awaited<ReturnType<typeof connectCdp>>["cdp"], sessionId: string) {
  const res = await cdp.send(
    "Runtime.evaluate",
    {
      expression: `(() => {
        const reTitle = new RegExp('^[A-Z]+\\\\d+-title$');
        const titleEls = Array.from(document.querySelectorAll('[id$="-title"]')).filter(e => reTitle.test(e.id));

        const rows = [];
        for (const el of titleEls) {
          const id = el.id || '';
          const doc = id.endsWith('-title') ? id.slice(0, -'-title'.length) : id;
          const li = el.closest('li');
          const hrefs = li ? Array.from(li.querySelectorAll('a[href]')).map(a => a.href) : [];

          const link = hrefs.find(h => h.includes('/apps/doc/' + doc + '/')) || '';
          const retrieve = hrefs.find(h => h.includes('/ps/retrieve.do') && h.includes('docId=')) || '';
          const about = hrefs.find(h => h.includes('/ps/aboutJournal.do')) || '';

          let galeDocId = '';
          let docType = '';
          try {
            if (retrieve) {
              const u = new URL(retrieve);
              galeDocId = u.searchParams.get('docId') || '';
              docType = u.searchParams.get('docType') || '';
            }
          } catch {}

          const textLines = (li?.innerText || '').trim().split(/\\n+/).map(s => s.trim()).filter(Boolean);
          const pubLine = textLines.find(l => l.toLowerCase().startsWith('publication:')) || '';
          const reYear = new RegExp('(18|19|20)\\\\d{2}');
          const dateLine = textLines.find(l => reYear.test(l)) || '';

          rows.push({
            doc,
            galeDocId,
            title: (el.textContent || '').trim(),
            docType,
            publication: pubLine.replace(/^Publication:\\s*/i, ''),
            dateLine,
            link,
            retrieve,
            about,
            textLines: textLines.slice(0, 8),
          });
        }

        const bodyText = document.body?.innerText || '';
        const m = bodyText.match(/\\b([0-9][0-9,]*)\\s*RESULTS\\b/i);
        const hitCount = m ? Number(m[1].replace(/,/g, '')) : null;
        const currentPage = document.querySelector('.pagination-current')?.textContent?.trim() || null;
        const next = document.querySelector('a.pagination-next')?.href || null;

        return { href: location.href, title: document.title, hitCount, currentPage, next, rows };
      })()`,
      returnByValue: true,
    },
    sessionId,
    60_000,
  );

  if (res.exceptionDetails) {
    const desc = (res.exceptionDetails as { exception?: { description?: string } }).exception?.description;
    throw new Error(desc || "extractResultsPage exception");
  }

  return (res?.result as { value?: any } | undefined)?.value ?? null;
}

function toMarkdownDigest(params: {
  term: string;
  startUrl: string;
  resultsUrl: string;
  hitCount: number | null;
  rows: Array<Record<string, any>>;
}) {
  const lines: string[] = [];
  lines.push(`# Gale TTDA 检索候选（Keyword=${params.term}）`);
  lines.push("");
  lines.push(`生成时间：${new Date().toLocaleString("zh-CN", { hour12: false })}`);
  lines.push(`入口：${params.startUrl}`);
  lines.push(`结果页：${params.resultsUrl}`);
  lines.push(`命中：${params.hitCount ?? "?"}`);
  lines.push("");

  lines.push("## 前 50 条（按结果页顺序）");
  lines.push("");
  for (const row of params.rows.slice(0, 50)) {
    const date = row.pubDate || row.dateLine || "";
    const y = row.year ? String(row.year) : "";
    lines.push(`- ${row.title || "(无标题)"}${y ? ` (${y})` : ""}`);
    if (date) lines.push(`  - 日期：${date}`);
    if (row.publication) lines.push(`  - 刊物：${row.publication}`);
    if (row.docType) lines.push(`  - 类型：${row.docType}`);
    if (row.link) lines.push(`  - 链接：${row.link}`);
    else if (row.retrieve) lines.push(`  - 链接：${row.retrieve}`);
  }
  lines.push("");
  return lines.join("\n");
}

export async function main(rawArgs = process.argv.slice(2)): Promise<void> {
  const projectDir = readArg(rawArgs, "--project", process.cwd()) ?? process.cwd();
  const layout = resolveHistwriteLayout(projectDir);
  const term = readArg(rawArgs, "--term", "\"Walter Lippmann\"") || "\"Walter Lippmann\"";
  const startUrl = readArg(rawArgs, "--start-url", DEFAULT_GALE_START_URL) || DEFAULT_GALE_START_URL;
  const maxPages = Number(readArg(rawArgs, "--max-pages", "0") || "0");
  const outDir =
    readArg(rawArgs, "--out-dir", readArg(rawArgs, "--outDir", layout.materialsIndexDir)) ||
    layout.materialsIndexDir;

  ensureDir(outDir);
  const stamp = nowDateYYYYMMDD();
  const baseName = `gale_ttda_keyword_${slugify(term)}_${stamp}`;
  const jsonPath = path.join(outDir, `${baseName}.json`);
  const mdPath = path.join(outDir, `${baseName}.md`);

  const relay = createRelayHistoryReporter({
    args: rawArgs,
    defaultCdpWsUrl: DEFAULT_CDP_WS_URL,
    defaultClient: "histwrite-gale-ttda",
  });

  let ws: Awaited<ReturnType<typeof connectCdp>>["ws"] | null = null;
  try {
    await relay.annotate({
      label: "Gale TTDA search",
      note: "开始检索",
      data: {
        database: "Gale Primary Sources - TTDA",
        projectDir: layout.projectDir,
        term,
        startUrl,
        maxPages,
        outDir,
      },
    });

    const connected = await connectCdp(relay.cdpWsUrl);
    ws = connected.ws;
    const cdp = connected.cdp;

    let page = await openAndAttach(cdp, "about:blank");
    const search = await runBasicSearch(cdp, page, { startUrl, term });
    page = search.page;
    const sessionId = page.sessionId;
    const resultsUrl = search.resultsHref;

    const all: Array<Record<string, any>> = [];
    const seen = new Set<string>();
    let hitCount: number | null = null;
    let pagesScanned = 0;

    while (true) {
      pagesScanned += 1;

      await waitForResultsReady(cdp, sessionId);
      const pageData = await extractResultsPage(cdp, sessionId);
      if (hitCount == null) hitCount = pageData?.hitCount ?? null;

      for (const row of pageData?.rows ?? []) {
        const key = row.galeDocId || row.doc || row.link || row.retrieve || JSON.stringify(row);
        if (seen.has(key)) continue;
        seen.add(key);

        const pubDate = parsePubDateFromAboutUrl(row.about);
        const year = parseYearLoose(pubDate || row.dateLine || row.about);

        all.push({
          ...row,
          pubDate,
          year,
          sourcePage: pageData?.currentPage ? Number(pageData.currentPage) : pagesScanned,
        });
      }

      if (!shouldFollowGaleNextPage({ maxPages, pagesScanned, nextHref: pageData?.next })) break;
      await navigate(cdp, sessionId, pageData.next);
      await waitForResultsReady(cdp, sessionId);
      await sleep(800);
    }

    const payload = {
      generatedAt: new Date().toISOString(),
      database: "Gale Primary Sources - The Times Digital Archive (TTDA)",
      projectDir: layout.projectDir,
      startUrl,
      term,
      resultsUrl,
      hitCount,
      rowCount: all.length,
      pagesScanned,
      rows: all,
    };

    fs.writeFileSync(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    fs.writeFileSync(
      mdPath,
      `${toMarkdownDigest({ term, startUrl, resultsUrl, hitCount, rows: all })}\n`,
      "utf8",
    );

    await relay.annotate({
      label: "Gale TTDA search",
      note: "检索完成",
      data: {
        database: payload.database,
        term,
        startUrl,
        resultsUrl,
        hitCount,
        rowCount: all.length,
        pagesScanned,
        output: { jsonPath, mdPath },
      },
    });

    const report = await relay.writeSearchReport({
      outDir,
      baseName,
      title: "Gale TTDA 检索报告",
      extra: {
        database: payload.database,
        output: { jsonPath, mdPath },
      },
    });

    console.log(`Report:\n- ${report.jsonPath}\n- ${report.mdPath}`);
    console.log(`Wrote:\n- ${jsonPath}\n- ${mdPath}`);
    console.log(`hitCount=${hitCount ?? "?"} rows=${all.length} pagesScanned=${pagesScanned}`);
  } catch (error) {
    await relay.annotate({
      label: "Gale TTDA search",
      note: `检索失败: ${relay.summarizeError(error)}`,
      data: {
        database: "Gale Primary Sources - TTDA",
        projectDir: layout.projectDir,
        term,
        startUrl,
        maxPages,
        outDir,
      },
    });

    await relay.writeSearchReport({
      outDir,
      baseName,
      title: "Gale TTDA 检索报告（失败）",
      extra: {
        database: "Gale Primary Sources - TTDA",
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
