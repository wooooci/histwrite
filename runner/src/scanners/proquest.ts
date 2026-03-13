#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { connectCdp, navigate, openAndAttach, readArg, sleep, waitForEval } from "./cdp.js";
import { resolveSessionAfterNavigation } from "./cdp-target-rebind.js";
import { createRelayHistoryReporter } from "./relay-history.js";
import { resolveHistwriteLayout } from "../project.js";

export const DEFAULT_CDP_WS_URL = "ws://127.0.0.1:18992/cdp";

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

function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true });
}

function normalizeWs(s: string) {
  return String(s ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseIntLoose(s: string) {
  const m = String(s ?? "").match(/[0-9][0-9,]*/);
  if (!m) return null;
  return Number(m[0].replace(/,/g, ""));
}

function parseYear(s: string) {
  const m = normalizeWs(s).match(/\b(18|19|20)\d{2}\b/);
  return m ? Number(m[0]) : null;
}

function isMissingSessionError(error: unknown): boolean {
  return String(error).includes("Session with given id not found");
}

export function parseDocIdFromDocview(url: string) {
  const m = String(url ?? "").match(/\/docview\/(\d+)\//);
  return m ? m[1] : null;
}

function normalizePathname(pathname: string): string {
  const trimmed = String(pathname ?? "").trim().toLowerCase().replace(/\/+$/g, "");
  return trimmed || "/";
}

export function buildAdvancedSearchUrl(accountId: string) {
  return `https://www.proquest.com/advanced?accountid=${encodeURIComponent(String(accountId ?? "").trim())}`;
}

export function isProquestAdvancedUrl(url: string) {
  try {
    const pathname = normalizePathname(new URL(String(url ?? "")).pathname);
    return pathname === "/advanced" || pathname === "/pqdtglobal/advanced";
  } catch {
    return false;
  }
}

export function isProquestResultsUrl(url: string) {
  try {
    const pathname = normalizePathname(new URL(String(url ?? "")).pathname);
    return pathname.startsWith("/results/") || pathname.startsWith("/pqdtglobal/results/");
  } catch {
    return false;
  }
}

export function buildResultsPageUrl(resultsUrl: string, pageNum: number) {
  const u = new URL(resultsUrl);
  const parts = u.pathname.split("/").filter(Boolean);
  parts[parts.length - 1] = String(pageNum);
  u.pathname = `/${parts.join("/")}`;
  return u.toString();
}

function classifyLikelyWalter(title: string) {
  const t = String(title || "").toLowerCase();
  if (!t.includes("lippmann")) return "unknown";
  if (t.includes("schwinger") || t.includes("equation")) return "not_walter";
  if (t.includes("walter")) return "walter_high";
  if (t.includes("dewey") || t.includes("good society")) return "walter_high";
  if (
    t.includes("public") ||
    t.includes("journal") ||
    t.includes("foreign") ||
    t.includes("cold war") ||
    t.includes("vietnam") ||
    t.includes("international") ||
    t.includes("politic")
  ) {
    return "walter_med";
  }
  return "walter_possible";
}

async function closeMyResearchModalIfPresent(
  cdp: Awaited<ReturnType<typeof connectCdp>>["cdp"],
  sessionId: string,
) {
  await cdp
    .send(
      "Runtime.evaluate",
      {
        expression: `(() => {
          const btn = document.querySelector('button[aria-label^="Close 登录"]');
          if (btn) { btn.click(); return 'closed'; }
          return 'none';
        })()`,
        returnByValue: true,
      },
      sessionId,
      15_000,
    )
    .catch(() => {});
}

async function proquestAdvancedSearch(
  cdp: Awaited<ReturnType<typeof connectCdp>>["cdp"],
  page: { sessionId: string; targetId: string },
  params: { term: string; accountId: string; field: string },
) {
  let activeSessionId = page.sessionId;
  let activeTargetId = page.targetId;
  const advUrl = buildAdvancedSearchUrl(params.accountId);
  await navigate(cdp, activeSessionId, advUrl);
  const rebound = await resolveSessionAfterNavigation(cdp, {
    currentSessionId: activeSessionId,
    currentTargetId: activeTargetId,
    expectedHosts: ["proquest.com", "proxy.lib.umich.edu"],
    expectedUrlSubstrings: ["/advanced?accountid=", "/pqdtglobal/advanced?accountid="],
    timeoutMs: 180_000,
    currentUrlTimeoutMs: 8_000,
  });
  activeSessionId = rebound.sessionId;
  activeTargetId = rebound.targetInfo?.targetId || activeTargetId;

  await waitForEval(cdp, activeSessionId, "location.href", (h) => typeof h === "string" && isProquestAdvancedUrl(h));
  await waitForEval(cdp, activeSessionId, "!!document.getElementById('fieldsSelect')", (v) => v === true);
  await waitForEval(cdp, activeSessionId, "!!document.getElementById('queryTermField')", (v) => v === true);

  await closeMyResearchModalIfPresent(cdp, activeSessionId);

  const fieldSetRes = await cdp.send(
    "Runtime.evaluate",
    {
      expression: `(() => {
        const sel = document.getElementById('fieldsSelect');
        const q = document.getElementById('queryTermField');
        if (!sel || !q) return { ok: false };
        const requested = ${JSON.stringify(params.field || "title")};
        sel.value = requested;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        q.value = ${JSON.stringify(params.term)};
        q.dispatchEvent(new Event('input', { bubbles: true }));
        q.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true, fieldRequested: requested, fieldSelected: sel.value, q: q.value };
      })()`,
      returnByValue: true,
    },
    activeSessionId,
    30_000,
  );
  const fieldSet = (fieldSetRes?.result as { value?: any } | undefined)?.value ?? null;
  if (!fieldSet?.ok) throw new Error("ProQuest advanced search: failed to set query field/term");
  if (fieldSet.fieldSelected !== fieldSet.fieldRequested) {
    console.warn(
      `warn: ProQuest field mismatch requested=${fieldSet.fieldRequested} selected=${fieldSet.fieldSelected}`,
    );
  }

  const before = await cdp.send(
    "Runtime.evaluate",
    { expression: "location.href", returnByValue: true },
    activeSessionId,
    15_000,
  );
  const beforeHref = (before?.result as { value?: string } | undefined)?.value;

  await cdp.send(
    "Runtime.evaluate",
    { expression: "document.getElementById('searchForm')?.submit(); true;", returnByValue: true },
    activeSessionId,
    15_000,
  );

  const resultsRebound = await resolveSessionAfterNavigation(cdp, {
    currentSessionId: activeSessionId,
    currentTargetId: activeTargetId,
    expectedHosts: ["proquest.com", "proxy.lib.umich.edu"],
    expectedUrlSubstrings: ["/results/", "/pqdtglobal/results/"],
    timeoutMs: 120_000,
    currentUrlTimeoutMs: 8_000,
  }).catch(() => ({
    sessionId: activeSessionId,
    targetInfo: { targetId: activeTargetId },
    matchedCurrentSession: false,
  }));
  activeSessionId = resultsRebound.sessionId;
  activeTargetId = resultsRebound.targetInfo?.targetId || activeTargetId;

  const resultsUrl = await waitForEval(
    cdp,
    activeSessionId,
    "location.href",
    (h) => typeof h === "string" && h !== beforeHref && isProquestResultsUrl(h),
    120_000,
  );

  return {
    page: { sessionId: activeSessionId, targetId: activeTargetId },
    resultsUrl,
    fieldRequested: fieldSet.fieldRequested,
    fieldSelected: fieldSet.fieldSelected,
  };
}

async function extractResultsPage(cdp: Awaited<ReturnType<typeof connectCdp>>["cdp"], sessionId: string) {
  const res = await cdp.send(
    "Runtime.evaluate",
    {
      expression: `(() => {
        const h1 = document.querySelector('h1')?.innerText || '';
        const rows = [];
        for (const li of document.querySelectorAll('li.resultItem')) {
          const titleA = li.querySelector('a.previewTitle[title]');
          if (!titleA) continue;
          rows.push({
            title: titleA.getAttribute('title') || '',
            docview: titleA.href || '',
            author: li.querySelector('.truncatedAuthor')?.textContent || '',
            dissertpub: li.querySelector('.dissertpub')?.textContent || '',
            abstractHref: li.querySelector('a[href*="/abstract/"]')?.href || '',
            pdfHref: li.querySelector('a[href*="/fulltextPDF/"]')?.href || '',
          });
        }
        return { href: location.href, title: document.title, h1, rows };
      })()`,
      returnByValue: true,
    },
    sessionId,
    60_000,
  );
  return (res?.result as { value?: any } | undefined)?.value ?? null;
}

export async function fetchAbstract(
  cdp: Awaited<ReturnType<typeof connectCdp>>["cdp"],
  sessionId: string,
  abstractUrl: string,
) {
  await navigate(cdp, sessionId, abstractUrl);
  try {
    await waitForEval(
      cdp,
      sessionId,
      "document.body ? document.body.innerText.length : 0",
      (n) => typeof n === "number" && n > 500,
      120_000,
    );
  } catch (error) {
    if (isMissingSessionError(error)) return { title: "", abstract: "" };
    throw error;
  }

  let last = { title: "", abstract: "" };
  for (let i = 0; i < 15; i += 1) {
    try {
      const res = await cdp.send(
        "Runtime.evaluate",
        {
          expression: `(() => {
            const title = document.querySelector('h1')?.innerText?.trim() || document.title || '';
            let a = (
              document.querySelector('#abstract')?.innerText
                || document.querySelector('.abstract')?.innerText
                || document.querySelector('[data-testid="abstract"]')?.innerText
                || ''
            ).trim();

            if (!a) {
              const body = document.body?.innerText || '';
              const mark = "\\n摘要\\n";
              const idx = body.indexOf(mark);
              if (idx >= 0) {
                let tail = body.slice(idx + mark.length);
                const cut = tail.indexOf("\\n翻译\\n");
                if (cut >= 0) tail = tail.slice(0, cut);
                a = tail.trim();
              }
            }

            return { title, abstract: a };
          })()`,
          returnByValue: true,
        },
        sessionId,
        60_000,
      );

      last = (res?.result as { value?: typeof last } | undefined)?.value ?? last;
    } catch (error) {
      if (isMissingSessionError(error)) return last;
      throw error;
    }

    if (normalizeWs(last.abstract).length >= 80) return last;
    await sleep(1000);
  }
  return last;
}

function toMarkdownDigest(params: {
  term: string;
  field: string;
  accountId: string;
  resultsUrl: string;
  total: number | null;
  rows: Array<Record<string, any>>;
}) {
  const lines: string[] = [];
  lines.push(`# ProQuest PQDT 检索候选（${params.field || "title"}=${params.term}）`);
  lines.push("");
  lines.push(`生成时间：${new Date().toLocaleString("zh-CN", { hour12: false })}`);
  lines.push(`入口：ProQuest Dissertations & Theses Global（UMich 代理 accountid=${params.accountId}）`);
  lines.push(`检索：高级检索，字段=${params.field || "title"}，词=${params.term}`);
  lines.push(`命中：${params.total ?? "?"}`);
  lines.push(`结果页：${params.resultsUrl}`);
  lines.push("");

  lines.push("## 建议优先下载（按相关度粗排）");
  lines.push("");
  const rec = params.rows.filter((row) => row.recommendation === "download_first");
  if (rec.length === 0) lines.push("- (暂无)");
  for (const row of rec) {
    lines.push(`- ${row.title} (${row.year ?? "未知年份"})`);
    if (row.author) lines.push(`  - 作者：${row.author}`);
    if (row.university) lines.push(`  - 学校：${row.university}`);
    lines.push(`  - 摘要页：${row.abstractHref || row.docview}`);
    if (row.abstractSnippet) lines.push(`  - 摘要摘录：${row.abstractSnippet}`);
  }

  lines.push("");
  lines.push("## 其余候选（含可能误命中）");
  lines.push("");
  for (const row of params.rows.filter((item) => item.recommendation !== "download_first")) {
    lines.push(`- [${row.likelyWalter}] ${row.title} (${row.year ?? "未知年份"})`);
    if (row.abstractHref) lines.push(`  - 摘要页：${row.abstractHref}`);
  }

  lines.push("");
  return lines.join("\n");
}

export async function main(rawArgs = process.argv.slice(2)): Promise<void> {
  const projectDir = readArg(rawArgs, "--project", process.cwd()) ?? process.cwd();
  const layout = resolveHistwriteLayout(projectDir);
  const term = readArg(rawArgs, "--term", "lippmann") || "lippmann";
  const field = readArg(rawArgs, "--field", "title") || "title";
  const accountId = readArg(rawArgs, "--accountid", "14667") || "14667";
  const maxAbstracts = Number(readArg(rawArgs, "--max-abstracts", "10") || "10");
  const outDir =
    readArg(rawArgs, "--out-dir", readArg(rawArgs, "--outDir", layout.materialsIndexDir)) ||
    layout.materialsIndexDir;

  ensureDir(outDir);
  const stamp = nowDateYYYYMMDD();
  const baseName = `proquest_pqdt_${slugify(field)}_${slugify(term)}_${stamp}`;
  const jsonPath = path.join(outDir, `${baseName}.json`);
  const mdPath = path.join(outDir, `${baseName}.md`);

  const relay = createRelayHistoryReporter({
    args: rawArgs,
    defaultCdpWsUrl: DEFAULT_CDP_WS_URL,
    defaultClient: "histwrite-proquest-pqdt",
  });

  let ws: Awaited<ReturnType<typeof connectCdp>>["ws"] | null = null;
  try {
    await relay.annotate({
      label: "ProQuest PQDT search",
      note: "开始检索",
      data: {
        database: "ProQuest PQDT Global",
        projectDir: layout.projectDir,
        term,
        field,
        accountId,
        maxAbstracts,
        outDir,
      },
    });

    const connected = await connectCdp(relay.cdpWsUrl);
    ws = connected.ws;
    const cdp = connected.cdp;

    let page = await openAndAttach(cdp, "about:blank");
    const search = await proquestAdvancedSearch(cdp, page, { term, accountId, field });
    page = search.page;
    const sessionId = page.sessionId;

    await waitForEval(
      cdp,
      sessionId,
      "document.querySelectorAll('li.resultItem').length",
      (n) => typeof n === "number" && n > 0,
      120_000,
    );

    const page1 = await extractResultsPage(cdp, sessionId);
    const total = parseIntLoose(page1?.h1);
    const pages = total ? Math.max(1, Math.ceil(total / 20)) : 1;

    const rawRows: Array<Record<string, any>> = [];
    for (let pageNumber = 1; pageNumber <= pages; pageNumber += 1) {
      const pageUrl = pageNumber === 1 ? search.resultsUrl : buildResultsPageUrl(search.resultsUrl, pageNumber);
      if (pageNumber !== 1) {
        await navigate(cdp, sessionId, pageUrl);
        await waitForEval(
          cdp,
          sessionId,
          "document.querySelectorAll('li.resultItem').length",
          (n) => typeof n === "number" && n > 0,
          120_000,
        );
      }

      const pageData = await extractResultsPage(cdp, sessionId);
      for (const row of pageData?.rows ?? []) rawRows.push({ ...row, sourcePage: pageNumber });
    }

    const byKey = new Map<string, Record<string, any>>();
    for (const row of rawRows) {
      const docId = parseDocIdFromDocview(row.docview);
      const key = docId ? `doc:${docId}` : `url:${row.docview}`;
      if (!byKey.has(key)) byKey.set(key, row);
    }

    const rows = Array.from(byKey.values()).map((row) => {
      const title = normalizeWs(row.title);
      const author = normalizeWs(row.author) || null;
      const dissertpub = normalizeWs(row.dissertpub);
      const year = parseYear(dissertpub);
      const docId = parseDocIdFromDocview(row.docview);
      const university = dissertpub.includes("ProQuest") ? normalizeWs(dissertpub.split("ProQuest")[0] || "") : null;
      const likelyWalter = classifyLikelyWalter(title);

      const abstractHref =
        row.abstractHref && String(row.abstractHref).startsWith("http")
          ? row.abstractHref
          : docId && row.docview
            ? row.docview.replace(`/docview/${docId}/`, `/docview/${docId}/abstract/`)
            : null;

      const pdfHref =
        row.pdfHref && String(row.pdfHref).startsWith("http")
          ? row.pdfHref
          : docId && row.docview
            ? row.docview.replace(`/docview/${docId}/`, `/docview/${docId}/fulltextPDF/`)
            : null;

      return {
        title,
        author,
        dissertpub,
        year,
        university,
        docId,
        docview: row.docview,
        abstractHref,
        pdfHref,
        likelyWalter,
        sourcePage: row.sourcePage,
      };
    });

    const candidates = rows
      .filter((row) => row.abstractHref)
      .filter((row) => row.likelyWalter !== "not_walter")
      .sort((left, right) => {
        const score = (item: { likelyWalter?: string }) =>
          item.likelyWalter === "walter_high" ? 0 : item.likelyWalter === "walter_med" ? 1 : 2;
        return score(left) - score(right) || (left.year ?? 9999) - (right.year ?? 9999);
      })
      .slice(0, Math.max(0, maxAbstracts));

    const absByKey = new Map<string, { title: string; abstract: string }>();
    for (const candidate of candidates) {
      const abs = await fetchAbstract(cdp, sessionId, candidate.abstractHref);
      absByKey.set(candidate.docId || candidate.abstractHref, abs);
      await sleep(800);
    }

    const rowsWithAbstract = rows.map((row) => {
      const abs = absByKey.get(row.docId || row.abstractHref) || null;
      const abstract = abs?.abstract ? normalizeWs(abs.abstract) : null;
      const abstractSnippet = abstract ? abstract.slice(0, 220) + (abstract.length > 220 ? "…" : "") : null;

      const t = (row.title || "").toLowerCase();
      const downloadFirst =
        row.likelyWalter === "walter_high" &&
        !t.includes("schwinger") &&
        !t.includes("equation") &&
        (t.includes("walter") ||
          t.includes("good society") ||
          t.includes("political") ||
          t.includes("foreign") ||
          t.includes("journal") ||
          t.includes("cold war") ||
          t.includes("vietnam") ||
          t.includes("dewey"));

      return {
        ...row,
        abstract,
        abstractSnippet,
        recommendation: downloadFirst ? "download_first" : "maybe",
      };
    });

    const payload = {
      generatedAt: new Date().toISOString(),
      database: "ProQuest PQDT Global",
      projectDir: layout.projectDir,
      term,
      fieldRequested: search.fieldRequested,
      fieldSelected: search.fieldSelected,
      accountId,
      resultsUrl: search.resultsUrl,
      total,
      pages,
      rowCount: rows.length,
      rows: rowsWithAbstract,
    };

    fs.writeFileSync(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    fs.writeFileSync(
      mdPath,
      `${toMarkdownDigest({
        term,
        field: search.fieldSelected || search.fieldRequested || field,
        accountId,
        resultsUrl: search.resultsUrl,
        total,
        rows: rowsWithAbstract,
      })}\n`,
      "utf8",
    );

    await relay.annotate({
      label: "ProQuest PQDT search",
      note: "检索完成",
      data: {
        database: payload.database,
        term,
        fieldRequested: search.fieldRequested,
        fieldSelected: search.fieldSelected,
        accountId,
        total,
        pages,
        rowCount: rowsWithAbstract.length,
        resultsUrl: search.resultsUrl,
        output: { jsonPath, mdPath },
      },
    });

    const report = await relay.writeSearchReport({
      outDir,
      baseName,
      title: "ProQuest PQDT 检索报告",
      extra: {
        database: payload.database,
        output: { jsonPath, mdPath },
      },
    });

    console.log(`Report:\n- ${report.jsonPath}\n- ${report.mdPath}`);

    const top = rowsWithAbstract.filter((row) => row.recommendation === "download_first").slice(0, 8);
    console.log(`Wrote:\n- ${jsonPath}\n- ${mdPath}`);
    console.log("\nTop download-first:");
    for (const row of top) {
      console.log(`- ${row.title} (${row.year ?? "?"}) :: ${row.abstractHref}`);
    }
  } catch (error) {
    await relay.annotate({
      label: "ProQuest PQDT search",
      note: `检索失败: ${relay.summarizeError(error)}`,
      data: {
        database: "ProQuest PQDT Global",
        projectDir: layout.projectDir,
        term,
        field,
        accountId,
        maxAbstracts,
        outDir,
      },
    });

    await relay.writeSearchReport({
      outDir,
      baseName,
      title: "ProQuest PQDT 检索报告（失败）",
      extra: {
        database: "ProQuest PQDT Global",
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
