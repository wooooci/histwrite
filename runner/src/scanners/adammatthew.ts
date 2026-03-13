#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { connectCdp, navigate, openAndAttach, readArg, sleep, waitForEval } from "./cdp.js";
import { resolveSessionAfterNavigation } from "./cdp-target-rebind.js";
import { createRelayHistoryReporter } from "./relay-history.js";
import { resolveHistwriteLayout } from "../project.js";

export const DEFAULT_CDP_WS_URL = "ws://127.0.0.1:18992/cdp";
export const DEFAULT_ADAM_MATTHEW_START_URL =
  "https://ddm.dnd.lib.umich.edu/database/link/45977?utm_source=library-search";

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

export function parseTotalFromSummaryText(s: string) {
  const t = String(s || "");
  const m1 = t.match(/(?:\bof\b|的)\s*([0-9][0-9,]*)/i);
  if (m1) return Number(m1[1].replace(/,/g, ""));
  const all = t.match(/[0-9][0-9,]*/g) || [];
  if (all.length) return Number(all[all.length - 1]!.replace(/,/g, ""));
  return null;
}

async function submitSearch(
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
    expectedHosts: ["amdigital", "proxy.lib.umich.edu"],
    expectedUrlSubstrings: ["/Documents", "/Explore"],
    timeoutMs: 180_000,
    currentUrlTimeoutMs: 8_000,
  });
  activeSessionId = rebound.sessionId;
  activeTargetId = rebound.targetInfo?.targetId || activeTargetId;
  await waitForEval(
    cdp,
    activeSessionId,
    "location.href",
    (h) => typeof h === "string" && h.length > 0 && /amdigital/i.test(h),
    180_000,
  );

  const doSearchUrl = `https://www-amexplorer-amdigital-co-uk.proxy.lib.umich.edu/Documents/DoSearch?searchText=${encodeURIComponent(
    params.term,
  )}&externalSearch=true`;
  await navigate(cdp, activeSessionId, doSearchUrl);

  const docsHref = await waitForEval(
    cdp,
    activeSessionId,
    "location.href",
    (h) => typeof h === "string" && h.includes("/Documents") && h.includes("searchId="),
    180_000,
  );

  await waitForEval(cdp, activeSessionId, "!!document.querySelector('.js-resultsTable')", (v) => v === true, 180_000);
  await waitForEval(
    cdp,
    activeSessionId,
    "(document.querySelector('.document-list-total')?.innerText || '').length",
    (n) => typeof n === "number" && n > 0,
    180_000,
  );

  const summaryNow = await waitForEval(
    cdp,
    activeSessionId,
    "document.querySelector('.document-list-total')?.innerText?.trim() || ''",
    (s) => typeof s === "string" && s.length > 0,
    30_000,
  ).catch(() => "");

  if (!/0\\s*(?:的|of)\\s*0/i.test(String(summaryNow || ""))) {
    await waitForEval(
      cdp,
      activeSessionId,
      "document.querySelectorAll('.js-resultsTable tbody tr').length",
      (n) => typeof n === "number" && n > 0,
      90_000,
    ).catch(() => {});
  }

  return {
    resultsUrl: docsHref,
    page: { sessionId: activeSessionId, targetId: activeTargetId },
  };
}

async function extractPage(cdp: Awaited<ReturnType<typeof connectCdp>>["cdp"], sessionId: string) {
  const res = await cdp.send(
    "Runtime.evaluate",
    {
      expression: `(() => {
        const summary = document.querySelector('.document-list-total')?.innerText?.trim() || '';
        const pageSummary = document.querySelector('.js-pageSummary')?.innerText?.trim() || '';
        const table = document.querySelector('.js-resultsTable');
        const rows = [];
        if (table) {
          for (const tr of Array.from(table.querySelectorAll('tbody tr'))) {
            const tds = Array.from(tr.querySelectorAll('td')).map(td => (td.innerText || '').trim());
            const a = tr.querySelector('a[href*="/Documents/Detail"], a[href*="/Documents/Detail/"]') || tr.querySelector('a[href]');
            const href = a?.href || '';
            rows.push({ cols: tds, href });
          }
        }

        const nextBtn = document.querySelector('a.js-pageNext');
        const prevBtn = document.querySelector('a.js-pagePrev');
        const isHidden = (el) => {
          if (!el) return true;
          const cs = window.getComputedStyle(el);
          return cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0';
        };
        const nextDisabled = !nextBtn || nextBtn.classList.contains('disabled') || isHidden(nextBtn);
        const prevDisabled = !prevBtn || prevBtn.classList.contains('disabled') || isHidden(prevBtn);

        return { href: location.href, title: document.title, summary, pageSummary, rows, nextDisabled, prevDisabled };
      })()`,
      returnByValue: true,
    },
    sessionId,
    60_000,
  );
  if (res.exceptionDetails) {
    const desc = (res.exceptionDetails as { exception?: { description?: string } }).exception?.description;
    throw new Error(desc || "extractPage exception");
  }
  return (res?.result as { value?: any } | undefined)?.value ?? null;
}

async function clickNextPage(
  cdp: Awaited<ReturnType<typeof connectCdp>>["cdp"],
  sessionId: string,
  prevPageSummary: string,
) {
  await cdp.send(
    "Runtime.evaluate",
    {
      expression: `(() => { document.querySelector('a.js-pageNext')?.click(); return true; })()`,
      returnByValue: true,
    },
    sessionId,
    30_000,
  );

  await waitForEval(
    cdp,
    sessionId,
    "document.querySelector('.js-pageSummary')?.innerText?.trim() || ''",
    (s) => typeof s === "string" && s.length > 0 && s !== prevPageSummary,
    180_000,
  );
  await sleep(800);
}

function toMarkdownDigest(params: {
  term: string;
  startUrl: string;
  resultsUrl: string;
  total: number | null;
  rows: Array<Record<string, any>>;
}) {
  const lines: string[] = [];
  lines.push(`# Adam Matthew AM:Explorer 检索候选（${params.term}）`);
  lines.push("");
  lines.push(`生成时间：${new Date().toLocaleString("zh-CN", { hour12: false })}`);
  lines.push(`入口：${params.startUrl}`);
  lines.push(`结果页：${params.resultsUrl}`);
  lines.push(`命中：${params.total ?? "?"}`);
  lines.push("");
  lines.push("## 前 50 条（按结果页顺序）");
  lines.push("");
  for (const row of params.rows.slice(0, 50)) {
    lines.push(`- ${row.title || "(无标题)"}${row.year ? ` (${row.year})` : ""}`);
    if (row.product) lines.push(`  - 产品：${row.product}`);
    if (row.date) lines.push(`  - 日期：${row.date}`);
    if (row.href) lines.push(`  - 链接：${row.href}`);
  }
  lines.push("");
  return lines.join("\n");
}

export async function main(rawArgs = process.argv.slice(2)): Promise<void> {
  const projectDir = readArg(rawArgs, "--project", process.cwd()) ?? process.cwd();
  const layout = resolveHistwriteLayout(projectDir);
  const term = readArg(rawArgs, "--term", "Lippmann") || "Lippmann";
  const startUrl =
    readArg(rawArgs, "--start-url", DEFAULT_ADAM_MATTHEW_START_URL) || DEFAULT_ADAM_MATTHEW_START_URL;
  const maxPages = Number(readArg(rawArgs, "--max-pages", "10") || "10");
  const outDir =
    readArg(rawArgs, "--out-dir", readArg(rawArgs, "--outDir", layout.materialsIndexDir)) ||
    layout.materialsIndexDir;

  ensureDir(outDir);
  const stamp = nowDateYYYYMMDD();
  const baseName = `adammatthew_am_explorer_${slugify(term)}_${stamp}`;
  const jsonPath = path.join(outDir, `${baseName}.json`);
  const mdPath = path.join(outDir, `${baseName}.md`);

  const relay = createRelayHistoryReporter({
    args: rawArgs,
    defaultCdpWsUrl: DEFAULT_CDP_WS_URL,
    defaultClient: "histwrite-adammatthew-am-explorer",
  });

  let ws: Awaited<ReturnType<typeof connectCdp>>["ws"] | null = null;
  try {
    await relay.annotate({
      label: "Adam Matthew search",
      note: "开始检索",
      data: {
        database: "Adam Matthew - AM:Explorer",
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
    const search = await submitSearch(cdp, page, { startUrl, term });
    page = search.page;
    const sessionId = page.sessionId;
    const resultsUrl = search.resultsUrl;

    const all: Array<Record<string, any>> = [];
    const seen = new Set<string>();
    let total: number | null = null;
    let pagesScanned = 0;
    let lastPageSummary: string | null = null;

    while (true) {
      const pageData = await extractPage(cdp, sessionId);
      pagesScanned += 1;

      if (total == null) total = parseTotalFromSummaryText(pageData?.summary);
      lastPageSummary = pageData?.pageSummary || lastPageSummary;

      if (
        pagesScanned === 1 &&
        (pageData?.rows?.length ?? 0) === 0 &&
        /0\\s*(?:的|of)\\s*0/i.test(pageData?.summary || "") &&
        !pageData?.nextDisabled
      ) {
        await clickNextPage(cdp, sessionId, pageData?.pageSummary || "");
        continue;
      }

      for (const row of pageData?.rows ?? []) {
        const cols = row.cols || [];
        const title = cols.find((value: string) => value && value.length > 0) || "";
        const year = parseIntLoose(cols.join(" "));

        const titleCol = cols.length >= 2 ? cols[1] : title;
        const dateCol = cols.length >= 3 ? cols[2] : "";
        const productCol = cols.length >= 4 ? cols[3] : "";

        const href = row.href || "";
        const key = href || `${titleCol}::${dateCol}::${productCol}`;
        if (seen.has(key)) continue;
        seen.add(key);

        all.push({
          title: titleCol,
          date: dateCol,
          product: productCol,
          year,
          href,
          cols,
        });
      }

      if (pagesScanned >= maxPages) break;
      if (pageData?.nextDisabled) break;

      await clickNextPage(cdp, sessionId, lastPageSummary || "");
    }

    const payload = {
      generatedAt: new Date().toISOString(),
      database: "Adam Matthew - AM:Explorer (UMich proxy)",
      projectDir: layout.projectDir,
      startUrl,
      term,
      resultsUrl,
      total,
      pagesScanned,
      rowCount: all.length,
      rows: all,
    };

    fs.writeFileSync(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    fs.writeFileSync(mdPath, `${toMarkdownDigest({ term, startUrl, resultsUrl, total, rows: all })}\n`, "utf8");

    await relay.annotate({
      label: "Adam Matthew search",
      note: "检索完成",
      data: {
        database: payload.database,
        term,
        startUrl,
        resultsUrl,
        total,
        rowCount: all.length,
        pagesScanned,
        output: { jsonPath, mdPath },
      },
    });

    const report = await relay.writeSearchReport({
      outDir,
      baseName,
      title: "Adam Matthew 检索报告",
      extra: {
        database: payload.database,
        output: { jsonPath, mdPath },
      },
    });

    console.log(`Report:\n- ${report.jsonPath}\n- ${report.mdPath}`);
    console.log(`Wrote:\n- ${jsonPath}\n- ${mdPath}`);
    console.log(`total=${total ?? "?"} rows=${all.length} pagesScanned=${pagesScanned}`);
  } catch (error) {
    await relay.annotate({
      label: "Adam Matthew search",
      note: `检索失败: ${relay.summarizeError(error)}`,
      data: {
        database: "Adam Matthew - AM:Explorer",
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
      title: "Adam Matthew 检索报告（失败）",
      extra: {
        database: "Adam Matthew - AM:Explorer",
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
