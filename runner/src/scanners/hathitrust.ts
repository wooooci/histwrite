#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { connectCdp, navigate, openAndAttach, readArg, sleep, waitForEval } from "./cdp.js";
import { resolveSessionAfterNavigation } from "./cdp-target-rebind.js";
import { createRelayHistoryReporter } from "./relay-history.js";
import { resolveHistwriteLayout } from "../project.js";

export const DEFAULT_CDP_WS_URL = "ws://127.0.0.1:18992/cdp";
export const DEFAULT_HATHITRUST_START_URL = "https://babel.hathitrust.org/cgi/ls?a=page&page=advanced";

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

function parseYearLoose(s: string) {
  const m = String(s ?? "").match(/\b(18|19|20)\d{2}\b/);
  return m ? Number(m[0]) : null;
}

export function buildSearchClausesFromArgs(args: string[]) {
  const field = readArg(args, "--field", "all") || "all";
  const match = readArg(args, "--match", "phrase") || "phrase";

  const clauses = [
    {
      term: readArg(args, "--term", "Walter Lippmann") || "Walter Lippmann",
      field,
      match,
    },
    {
      term: readArg(args, "--term-2", "") || "",
      field: readArg(args, "--field-2", field) || field,
      match: readArg(args, "--match-2", match) || match,
    },
    {
      term: readArg(args, "--term-3", "") || "",
      field: readArg(args, "--field-3", field) || field,
      match: readArg(args, "--match-3", match) || match,
    },
    {
      term: readArg(args, "--term-4", "") || "",
      field: readArg(args, "--field-4", field) || field,
      match: readArg(args, "--match-4", match) || match,
    },
  ].filter((clause) => String(clause.term || "").trim().length > 0);

  return clauses;
}

async function waitOutCloudflareInterstitial(
  cdp: Awaited<ReturnType<typeof connectCdp>>["cdp"],
  sessionId: string,
) {
  await waitForEval(
    cdp,
    sessionId,
    `(() => ({ title: document.title || '', href: location.href || '' }))()`,
    (v) => {
      const title = String((v as { title?: string } | undefined)?.title || "").toLowerCase();
      const href = String((v as { href?: string } | undefined)?.href || "");
      if (!title) return false;
      if (title.includes("just a moment")) return false;
      if (href.includes("__cf_chl_")) return false;
      return true;
    },
    180_000,
  ).catch(() => {});
}

async function runAdvancedSearch(
  cdp: Awaited<ReturnType<typeof connectCdp>>["cdp"],
  page: { sessionId: string; targetId: string },
  params: {
    startUrl: string;
    clauses: Array<{ term: string; field: string; match: string }>;
    fullViewOnly: boolean;
  },
) {
  let activeSessionId = page.sessionId;
  let activeTargetId = page.targetId;

  await navigate(cdp, activeSessionId, params.startUrl);
  const rebound = await resolveSessionAfterNavigation(cdp, {
    currentSessionId: activeSessionId,
    currentTargetId: activeTargetId,
    expectedHosts: ["hathitrust.org"],
    expectedUrlSubstrings: ["/cgi/ls", "/Record/"],
    timeoutMs: 180_000,
    currentUrlTimeoutMs: 8_000,
  });
  activeSessionId = rebound.sessionId;
  activeTargetId = rebound.targetInfo?.targetId || activeTargetId;
  await waitOutCloudflareInterstitial(cdp, activeSessionId);

  await waitForEval(
    cdp,
    activeSessionId,
    `document.querySelectorAll('input[aria-label="Search Term 1"]').length`,
    (n) => typeof n === "number" && n > 0,
    180_000,
  );

  const beforeHref = await waitForEval(
    cdp,
    activeSessionId,
    "location.href",
    (h) => typeof h === "string" && h.length > 0,
  );

  const setRes = await cdp.send(
    "Runtime.evaluate",
    {
      expression: `(() => {
        const norm = (s) => String(s || '').replace(/\\s+/g,' ').trim();
        const cfg = ${JSON.stringify({ clauses: params.clauses, fullViewOnly: params.fullViewOnly })};

        const setSelect = (aria, value) => {
          const el = document.querySelector('select[aria-label="' + aria + '"]');
          if (!el) return false;
          el.value = value;
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        };
        const setInput = (aria, value) => {
          const el = document.querySelector('input[aria-label="' + aria + '"]');
          if (!el) return false;
          el.value = value;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        };

        const viewOpt = document.getElementById('view-options');
        if (viewOpt && typeof cfg.fullViewOnly === 'boolean') {
          viewOpt.checked = cfg.fullViewOnly;
          viewOpt.dispatchEvent(new Event('change', { bubbles: true }));
        }

        for (let i = 0; i < cfg.clauses.length; i += 1) {
          const n = i + 1;
          const c = cfg.clauses[i];
          if (!c) continue;
          const term = norm(c.term);
          if (!term) continue;
          const field = norm(c.field) || 'all';
          const match = norm(c.match) || 'phrase';
          setSelect('Selected field ' + n, field);
          setSelect('Selected match ' + n, match);
          setInput('Search Term ' + n, term);
        }

        const btn = Array.from(document.querySelectorAll('button.btn.btn-primary.btn-lg[type="submit"]'))
          .find(b => /advanced\\s*search/i.test(norm(b.textContent || b.innerText || '')));
        if (btn) btn.click();
        else document.querySelector('form')?.submit?.();
        return { ok: !!btn };
      })()`,
      returnByValue: true,
    },
    activeSessionId,
    60_000,
  );
  if (setRes.exceptionDetails) {
    const desc = (setRes.exceptionDetails as { exception?: { description?: string } }).exception?.description;
    throw new Error(desc || "set search exception");
  }

  await waitForEval(
    cdp,
    activeSessionId,
    `(() => ({
      title: document.title || '',
      href: location.href || '',
      n: document.querySelectorAll('article.record').length,
      no: /no\\s+results|0\\s+results/i.test(String(document.body?.textContent || ''))
    }))()`,
    (v) => {
      const title = String((v as any)?.title || "").toLowerCase();
      if (title.includes("just a moment")) return false;
      if (String((v as any)?.href || "").includes("__cf_chl_")) return false;
      return (typeof (v as any)?.n === "number" && (v as any).n > 0) || (v as any)?.no === true;
    },
    180_000,
  );

  const resultsHref = await waitForEval(
    cdp,
    activeSessionId,
    "location.href",
    (h) => typeof h === "string" && h.length > 0 && h !== beforeHref,
    180_000,
  ).catch(() => beforeHref);

  return {
    resultsUrl: resultsHref,
    page: { sessionId: activeSessionId, targetId: activeTargetId },
  };
}

async function extractResultsPage(cdp: Awaited<ReturnType<typeof connectCdp>>["cdp"], sessionId: string) {
  const res = await cdp.send(
    "Runtime.evaluate",
    {
      expression: `(() => {
        const norm = (s) => String(s || '').replace(/\\s+/g,' ').trim();
        const dedupe = (arr) => Array.from(new Set(arr.filter(Boolean)));

        const getLastParam = (key) => {
          try {
            const u = new URL(location.href);
            const all = u.searchParams.getAll(key);
            return all.length ? all[all.length - 1] : null;
          } catch {
            return null;
          }
        };

        const page = Number(getLastParam('page') || 1);
        const pageSize = Number(getLastParam('pagesize') || 100);

        const bodyText = norm(document.body?.textContent || '');
        const mTotal = bodyText.match(/\\b([0-9][0-9,]*)\\s+results\\b/i);
        const totalResults = mTotal ? Number(mTotal[1].replace(/,/g,'')) : null;

        const pagerNav = Array.from(document.querySelectorAll('nav')).find(n => /go to page/i.test(norm(n.textContent || ''))) || null;
        const pagerText = pagerNav ? norm(pagerNav.textContent || '') : '';
        const mPages = pagerText.match(/\\bof\\s*([0-9][0-9,]*)\\b/i);
        const totalPages = mPages ? Number(mPages[1].replace(/,/g,'')) : null;

        const nextA = pagerNav
          ? Array.from(pagerNav.querySelectorAll('a')).find(a => /^next$/i.test(norm(a.textContent || '')) && a.href)
          : Array.from(document.querySelectorAll('a')).find(a => /^next$/i.test(norm(a.textContent || '')) && a.href && /page=/.test(a.href));
        const next = nextA?.href || '';

        const rows = [];
        for (const art of Array.from(document.querySelectorAll('article.record'))) {
          const title = norm(
            art.querySelector('span.title')?.textContent
              || art.querySelector('.record-title')?.textContent
              || ''
          );

          const meta = {};
          for (const grid of Array.from(art.querySelectorAll('dl.metadata .grid'))) {
            const dt = norm(grid.querySelector('dt')?.textContent || '');
            const dd = norm(grid.querySelector('dd')?.textContent || '');
            if (!dt || !dd) continue;
            meta[dt] = meta[dt] ? (meta[dt] + ' ' + dd) : dd;
          }

          const author = meta['Author'] || meta['作者'] || '';
          const published = meta['Published'] || meta['出版'] || '';
          const year = (() => {
            const y = published.match(/\\b(18|19|20)\\d{2}\\b/);
            if (y) return Number(y[0]);
            const y2 = title.match(/\\b(18|19|20)\\d{2}\\b/);
            return y2 ? Number(y2[0]) : null;
          })();

          const recordA = Array.from(art.querySelectorAll('a[href^="/Record/"]'))
            .find(a => /\\/Record\\//.test(a.getAttribute('href') || '')) || null;
          let recordUrl = recordA ? new URL(recordA.getAttribute('href'), location.origin).toString() : '';
          if (recordUrl) {
            try {
              const u = new URL(recordUrl);
              recordUrl = u.origin + u.pathname;
            } catch {}
          }

          const accessLinks = Array.from(art.querySelectorAll('.resource-access-container a')).map(a => ({
            text: norm(a.textContent || ''),
            href: a.href || '',
          })).filter(x => x.text || x.href).slice(0, 12);

          const fullViewUrls = dedupe(
            Array.from(art.querySelectorAll('a[href*="babel.hathitrust.org/cgi/pt?id="]')).map(a => a.href || '')
          );
          const fullViewUrl = fullViewUrls[0] || '';

          const notesParts = [];
          if (published) notesParts.push(published);
          const accessLabels = dedupe(accessLinks.map(x => x.text)).filter(Boolean);
          if (accessLabels.length) notesParts.push('access=' + accessLabels.slice(0, 6).join(','));

          rows.push({
            title,
            author,
            published,
            year,
            recordUrl,
            fullViewUrl,
            fullViewUrls,
            accessLinks,
            notes: notesParts.join(' | '),
          });
        }

        return {
          href: location.href,
          title: document.title,
          page,
          pageSize,
          totalResults,
          totalPages,
          next,
          rowCount: rows.length,
          rows,
        };
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
  clauses: Array<{ term: string; field: string; match: string }>;
  fullViewOnly: boolean;
  startUrl: string;
  resultsUrl: string;
  hitCount: number | null;
  rows: Array<Record<string, any>>;
}) {
  const lines: string[] = [];
  lines.push("# HathiTrust 高级检索候选");
  lines.push("");
  lines.push(`生成时间：${new Date().toLocaleString("zh-CN", { hour12: false })}`);
  lines.push(`入口：${params.startUrl}`);
  lines.push(`Full View Only：${params.fullViewOnly ? "是" : "否"}`);
  lines.push("检索子句：");
  for (let index = 0; index < params.clauses.length; index += 1) {
    const clause = params.clauses[index];
    if (!clause || !String(clause.term || "").trim()) continue;
    lines.push(`- #${index + 1} term=${clause.term} | field=${clause.field} | match=${clause.match}`);
  }
  lines.push(`命中（估算）：${params.hitCount ?? "?"}`);
  lines.push(`结果页：${params.resultsUrl}`);
  lines.push("");
  lines.push("## 前 50 条（按结果页顺序）");
  lines.push("");
  for (const row of params.rows.slice(0, 50)) {
    const y = row.year ? ` (${row.year})` : "";
    lines.push(`- ${row.title || "(无标题)"}${y}`);
    if (row.author) lines.push(`  - 作者：${row.author}`);
    if (row.recordUrl) lines.push(`  - 记录：${row.recordUrl}`);
    if (row.fullViewUrl) lines.push(`  - Full view：${row.fullViewUrl}`);
    if (row.notes) lines.push(`  - 备注：${row.notes}`);
  }
  lines.push("");
  return lines.join("\n");
}

export async function main(rawArgs = process.argv.slice(2)): Promise<void> {
  const projectDir = readArg(rawArgs, "--project", process.cwd()) ?? process.cwd();
  const layout = resolveHistwriteLayout(projectDir);
  const startUrl = readArg(rawArgs, "--start-url", DEFAULT_HATHITRUST_START_URL) || DEFAULT_HATHITRUST_START_URL;
  const clauses = buildSearchClausesFromArgs(rawArgs);
  const fullViewOnlyRaw = readArg(rawArgs, "--full-view-only", "on");
  const fullViewOnly = String(fullViewOnlyRaw || "on").toLowerCase() !== "off";

  const maxPages = (() => {
    const raw = readArg(rawArgs, "--max-pages", "5") || "5";
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : 5;
  })();

  const maxItems = (() => {
    const raw = readArg(rawArgs, "--max-items", "500") || "500";
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : 500;
  })();

  const outDir =
    readArg(rawArgs, "--out-dir", readArg(rawArgs, "--outDir", layout.materialsIndexDir)) ||
    layout.materialsIndexDir;

  ensureDir(outDir);
  const stamp = nowDateYYYYMMDD();
  const primaryTerm = clauses[0]?.term || "query";
  const baseName = `hathitrust_advanced_${slugify(primaryTerm)}_${stamp}`;
  const jsonPath = path.join(outDir, `${baseName}.json`);
  const mdPath = path.join(outDir, `${baseName}.md`);

  const relay = createRelayHistoryReporter({
    args: rawArgs,
    defaultCdpWsUrl: DEFAULT_CDP_WS_URL,
    defaultClient: "histwrite-hathitrust-advanced",
  });

  let ws: Awaited<ReturnType<typeof connectCdp>>["ws"] | null = null;
  try {
    await relay.annotate({
      label: "HathiTrust advanced search",
      note: "开始检索",
      data: {
        database: "HathiTrust Catalog (Advanced Search)",
        projectDir: layout.projectDir,
        startUrl,
        clauses,
        fullViewOnly,
        maxPages,
        maxItems,
        outDir,
      },
    });

    const connected = await connectCdp(relay.cdpWsUrl);
    ws = connected.ws;
    const cdp = connected.cdp;

    let page = await openAndAttach(cdp, "about:blank");
    const search = await runAdvancedSearch(cdp, page, { startUrl, clauses, fullViewOnly });
    page = search.page;
    const sessionId = page.sessionId;
    const resultsUrl = search.resultsUrl;

    const all: Array<Record<string, any>> = [];
    const seen = new Set<string>();
    let hitCount: number | null = null;
    let pagesScanned = 0;
    let next = resultsUrl;

    while (next) {
      pagesScanned += 1;
      if (maxPages > 0 && pagesScanned > maxPages) break;

      if (pagesScanned !== 1) {
        await navigate(cdp, sessionId, next);
        await waitOutCloudflareInterstitial(cdp, sessionId);
        await waitForEval(
          cdp,
          sessionId,
          "document.querySelectorAll('article.record').length",
          (n) => typeof n === "number" && n >= 0,
          180_000,
        );
      }

      const pageData = await extractResultsPage(cdp, sessionId);
      if (hitCount == null && typeof pageData?.totalResults === "number") hitCount = pageData.totalResults;

      for (const row of pageData?.rows ?? []) {
        const key = row.recordUrl || row.fullViewUrl || `${row.title}::${row.author}::${row.year ?? ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        all.push({ ...row, sourcePage: pageData?.page ?? pagesScanned });
        if (maxItems > 0 && all.length >= maxItems) break;
      }

      if (maxItems > 0 && all.length >= maxItems) break;

      next = pageData?.next || "";
      if (!next || next === pageData?.href) break;
      await sleep(800);
    }

    const payload = {
      generatedAt: new Date().toISOString(),
      database: "HathiTrust Catalog (Advanced Search)",
      projectDir: layout.projectDir,
      startUrl,
      clauses,
      fullViewOnly,
      resultsUrl,
      hitCount,
      pagesScanned,
      rowCount: all.length,
      rows: all,
    };

    fs.writeFileSync(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    fs.writeFileSync(
      mdPath,
      `${toMarkdownDigest({ clauses, fullViewOnly, startUrl, resultsUrl, hitCount, rows: all })}\n`,
      "utf8",
    );

    await relay.annotate({
      label: "HathiTrust advanced search",
      note: "检索完成",
      data: {
        database: payload.database,
        startUrl,
        clauses,
        fullViewOnly,
        resultsUrl,
        hitCount,
        pagesScanned,
        rowCount: all.length,
        output: { jsonPath, mdPath },
      },
    });

    const report = await relay.writeSearchReport({
      outDir,
      baseName,
      title: "HathiTrust 检索报告",
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
      label: "HathiTrust advanced search",
      note: `检索失败: ${relay.summarizeError(error)}`,
      data: {
        database: "HathiTrust Catalog (Advanced Search)",
        projectDir: layout.projectDir,
        startUrl,
        clauses,
        fullViewOnly,
        maxPages,
        maxItems,
        outDir,
      },
    });

    await relay.writeSearchReport({
      outDir,
      baseName,
      title: "HathiTrust 检索报告（失败）",
      extra: {
        database: "HathiTrust Catalog (Advanced Search)",
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
