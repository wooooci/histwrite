# Histwrite 平台聚类适配 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把“适配 1118 个世界史数据库”收敛成“先抓 UMich 数据库目录并匹配指南，再按平台聚类实现可复用 driver”的执行闭环，最终让 Histwrite 能先产出可筛选矩阵，再按平台自动/半自动完成下载。

**Architecture:** 采用“控制面 + 执行面 + relay/扫描器”三层结构，**工作区以 `/Users/woooci/Downloads/histwrite` 为准**。控制面落在 `runner/`：把《世界史研究外文数据库指南》的脏数据清洗后，与 UMich Library 目录命中、真实落地 host、平台归类、下载方式、支持状态汇总成矩阵；执行面同样落在 `runner/`：把矩阵行路由到平台 driver（JSTOR / ProQuest / Gale / Adam Matthew / HathiTrust / CNKI / fallback）。OpenClaw 接入只通过 `plugin-openclaw/` 这个薄桥接层；relay 与浏览器接管代码落在本仓的 `relay/`。

**Tech Stack:** TypeScript ESM、Vitest、Clawdbot Browser Relay（Chrome 扩展 + CDP）、Histwrite ingest helpers、轻量 Python/Node 目录抓取脚本。

---

## 0) 施工前硬约束

- 当前工作区已有 Histwrite 相关 WIP；**不要切分支、不要 stash、不要改无关文件**。
- 计划执行默认在当前工作区原地进行；**除非用户明确要求，不创建 worktree**。
- 所有“接管主力 Chrome”的动作都走 Browser Relay；**不要另起 Playwright 新浏览器做登录态主流程**。
- 验证顺序固定为：小测试 → 单文件/单平台 smoke → 再做更大范围的目录抓取。
- 任何无法完全自动化的平台，必须返回结构化 `manual_required`/`needs_review` 状态，而不是静默失败。
- OpenClaw 的真实命令入口是 `plugin-openclaw/src/runtime.ts` → `runner/src/cli.ts`；本计划的实施工作区就是当前这个 `histwrite` 仓库。
- 本仓已经自带 `relay/` 工作区；relay 修复优先在这里做，必要时再把旧的外部脚本原型迁入本仓。
- 本阶段先做“可落地的 runner/relay/plugin 桥接”，不额外开启大规模目录重构。

## 0.1) 当前仓目录落点

- 平台矩阵、OCR 清洗、driver、命令入口：`runner/src/*`
- OpenClaw 插件桥接：`plugin-openclaw/src/*`
- 浏览器接管与 CDP relay：`relay/*`

---

### Task 1: 冻结平台矩阵契约

**Files:**
- Create: `runner/src/platform/contract.ts`
- Create: `runner/src/platform/contract.test.ts`
- Reference: `材料/_index/world_history_db_guide_appendix2.json`

**Step 1: 写失败测试，先把矩阵字段钉死**

```ts
expect(parsePlatformMatrixRow({
  guideName: "ProQuest Dissertations & Theses Global",
  umichHit: "ProQuest Dissertations & Theses Global",
  landingUrl: "https://www.proquest.com/pqdtglobal/",
  landingHost: "www.proquest.com",
  platform: "proquest",
  downloadMode: "record_then_pdf",
  status: "planned",
})).toMatchObject({
  platform: "proquest",
  downloadMode: "record_then_pdf",
});
```

**Step 2: 运行测试确认契约尚不存在**

Run: `pnpm exec vitest run runner/src/platform/contract.test.ts`

Expected: FAIL，提示 `parsePlatformMatrixRow` / `PlatformId` / `DownloadMode` 尚未实现。

**Step 3: 最小实现矩阵契约**

至少定义这些强类型：
- `PlatformId = "jstor" | "proquest" | "gale" | "adammatthew" | "hathitrust" | "cnki" | "fallback"`
- `DownloadMode = "direct_pdf" | "record_then_pdf" | "page_range_dialog" | "cart_batch" | "zotero_only" | "manual_only"`
- `SupportStatus = "planned" | "partial" | "ready" | "manual_required" | "blocked"`
- `PlatformMatrixRow`（包含 `guideName / guideCode / umichHit / landingUrl / landingHost / platform / downloadMode / status / notes`）

这一步只冻结平台矩阵契约，不强行绑定任何既有下载 driver。

**Step 4: 重新跑测试**

Run: `pnpm exec vitest run runner/src/platform/contract.test.ts`

Expected: PASS。

**Step 5: 小步提交**

Run: `git add runner/src/platform/contract.ts runner/src/platform/contract.test.ts && git commit -m "Histwrite: add platform matrix contract"`

---

### Task 2: 做 UMich 目录抓取 + 指南匹配的控制面（含 OCR 深度清洗）

**Files:**
- Create: `runner/src/platform/guide-cleaning.ts`
- Create: `runner/src/platform/guide-cleaning.test.ts`
- Create: `runner/src/platform/matrix.ts`
- Create: `runner/src/platform/matrix.test.ts`
- Modify: `runner/src/cli.ts`
- Create: `runner/src/cli.platform-matrix.test.ts`
- Reference: `材料/_index/world_history_db_guide_appendix2.json`

**Step 1: 先写失败测试，覆盖最重要的匹配路径**

测试至少覆盖：
- 指南名与 UMich 命中名几乎一致（直接命中）
- 指南名与 UMich 命中名不一致，但 landing host 能归到同一平台（平台命中）
- UMich 命中先落在 `apps.lib.umich.edu` / `ddm.dnd.lib.umich.edu` / `search.lib.umich.edu`，随后需要继续展开到真实 vendor host
- OCR 脏字符替换（`ꎬ → ,`、`􀆰 → .`、`􀆳 → '`)
- 单个 `name/raw` 字段中粘连两个数据库时，能按 `代码模式（如 K712/E155）` 正确拆分

```ts
expect(matchGuideEntriesToUmichHits(guideEntries, umichHits)[0]).toMatchObject({
  guideName: "JSTOR",
  platform: "jstor",
  landingHost: "www.jstor.org",
});
```

**Step 2: 跑测试确认控制面还不存在**

Run: `pnpm exec vitest run runner/src/platform/matrix.test.ts`

Expected: FAIL。

**Step 3: 最小实现控制面逻辑**

在 `guide-cleaning.ts` 里实现：
- `normalizeOcrArtifacts()`：替换遗留 OCR 特征字符
- `splitMergedGuideEntries()`：按数据库代码模式拆开黏连条目
- `normalizeGuideName()`：在深度清洗后再做空白、标点、尾缀规整

在 `platform-matrix.ts` 里实现：
- `normalizeGuideName()`：去掉全角/异常空白/版本尾缀
- `classifyUmichEntryKind()`：区分 `umich_database_link` / `umich_proxy_login` / `umich_search` / `direct_vendor`
- `resolvePlatformFromHostOrName()`：优先 host，其次名称关键词
- `matchGuideEntriesToUmichHits()`：输出一行一库的矩阵对象
- `renderPlatformMatrixTsv()`：导出 TSV

在 `runner/src/cli.ts` 里增加 repo-local 子命令（例如 `histwrite platform matrix`）：读指南 JSON、读 UMich 抓取 JSON、调用 `guide-cleaning.ts` 与 `matrix.ts`，输出：
- `材料/_index/umich_platform_matrix.json`
- `材料/_index/umich_platform_matrix.tsv`
- `材料/_index/umich_platform_matrix.md`

`plugin-openclaw/src/runtime.ts` 不需要理解矩阵细节，只负责把命令透传给 `runner/src/cli.ts`。

**Step 4: 跑测试并生成一次本地矩阵**

Run:
- `pnpm exec vitest run runner/src/platform/matrix.test.ts`
- `pnpm exec vitest run runner/src/platform/guide-cleaning.test.ts`
- `pnpm exec vitest run runner/src/cli.platform-matrix.test.ts`
- `node --import tsx runner/src/cli.ts platform matrix --project "/Users/woooci/Downloads/histwrite" --guide-json "材料/_index/world_history_db_guide_appendix2.json" --umich-json "<最新抓取结果>.json"`

Expected:
- 单测 PASS
- 产出 `umich_platform_matrix.{json,tsv,md}`

**Step 5: 小步提交**

Run: `git add runner/src/platform/guide-cleaning.ts runner/src/platform/guide-cleaning.test.ts runner/src/platform/matrix.ts runner/src/platform/matrix.test.ts runner/src/cli.ts runner/src/cli.platform-matrix.test.ts && git commit -m "Histwrite: add UMich platform matrix builder"`

---

### Task 3: 在本仓 relay/扫描器里修好 raw CDP 重附着

**Files:**
- Create: `runner/src/scanners/cdp-target-rebind.ts`
- Create: `runner/src/scanners/cdp-target-rebind.test.ts`
- Create: `runner/src/scanners/jstor.ts`
- Create: `runner/src/scanners/proquest.ts`
- Create: `runner/src/scanners/gale.ts`
- Create: `runner/src/scanners/adammatthew.ts`
- Create: `runner/src/scanners/hathitrust.ts`
- Modify: `relay/src/extension-relay.ts`

**Step 1: 写失败测试，锁定“重定向后 target/session 重新附着”**

```js
assert.deepEqual(
  chooseReattachTarget([
    { targetId: "1", url: "about:blank", openerId: "seed" },
    { targetId: "2", url: "https://www-jstor-org.proxy.lib.umich.edu/action/doAdvancedSearch", openerId: "seed" },
  ], { expectedHosts: ["jstor", "proxy.lib.umich.edu"] }),
  { targetId: "2", url: "https://www-jstor-org.proxy.lib.umich.edu/action/doAdvancedSearch" },
);
```

**Step 2: 跑测试确认 helper 不存在**

Run: `pnpm exec vitest run runner/src/scanners/cdp-target-rebind.test.ts`

Expected: FAIL。

**Step 3: 实现 CDP 重附着 helper，并接入 5 个 scan 脚本**

`runner/src/scanners/cdp-target-rebind.ts` 至少提供：
- `getTargets()`（走 `Target.getTargets`，不是 `/tabs`）
- `chooseReattachTarget()`
- `reattachAfterRedirect()`
- `waitForTargetUrlMatch()`

每个扫描脚本都改成同一套路：
1. 新开页后记录种子 `targetId/sessionId`
2. `Page.navigate` 或跳转链后，如果当前 session 仍停在 `about:blank`/旧 origin，则调用 `Target.getTargets`
3. 按 `openerId + host + 最终 url` 重新附着到真实 vendor target
4. 只有重附着成功后，才继续 `Runtime.evaluate`

**Step 4: 跑测试 + 单平台 smoke**

Run:
- `pnpm exec vitest run runner/src/scanners/cdp-target-rebind.test.ts`
- `curl -s http://127.0.0.1:18992/extension/status`
- `CDP_WS_URL=ws://127.0.0.1:18992/cdp node --import tsx runner/src/scanners/jstor.ts --project "/Users/woooci/Downloads/histwrite" --base-term "Walter Lippmann" --term-2 "public opinion"`

Expected:
- helper 测试 PASS
- relay 状态 `connected=true`
- JSTOR smoke 不再把主执行 session 长时间卡在 `about:blank`

**Step 5: 小步提交**

Run: `git add relay/src/extension-relay.ts runner/src/scanners && git commit -m "Histwrite: harden relay reattach flow"`

---

### Task 4: 建平台注册表与下载 driver 分发层

**Files:**
- Create: `runner/src/platform/driver-contract.ts`
- Create: `runner/src/platform/driver-contract.test.ts`
- Create: `runner/src/platform/registry.ts`
- Create: `runner/src/platform/registry.test.ts`
- Create: `runner/src/platform/dispatch.ts`
- Create: `runner/src/platform/drivers/jstor.ts`
- Create: `runner/src/platform/drivers/proquest.ts`
- Create: `runner/src/platform/drivers/gale.ts`
- Create: `runner/src/platform/drivers/adammatthew.ts`
- Modify: `runner/src/capture.ts`

**Step 1: 先写失败测试，先把 driver 契约钉在 Gale 现状上**

```ts
expect(resolvePlatformDriver({
  platform: "gale",
  downloadMode: "page_range_dialog",
})).toMatchObject({ kind: "gale" });
```

还要覆盖：
- `proquest + record_then_pdf`
- `jstor + record_then_pdf`
- `cnki + zotero_only`
- `fallback + manual_only`
- `gale` driver 通过 relay client / snapshot / CDP 依赖注入可执行

**Step 2: 跑测试确认注册表不存在**

Run: `pnpm exec vitest run runner/src/platform/driver-contract.test.ts runner/src/platform/registry.test.ts`

Expected: FAIL。

**Step 3: 先最小实现“一个强驱动适配器 + 多个结构化 stub”**

实现要求：
- `driver-contract.ts` 先定义统一输入：
  - `deps.relayBaseUrl`
  - `deps.snapshot`
  - `deps.runCdp`
  - `row: PlatformMatrixRow`
  - `request: PlatformDownloadRequest`
- Gale 先作为首个强驱动，优先复用 `runner/src/capture.ts` 与新的 relay/CDP helper
- JSTOR / ProQuest / Adam Matthew 先提供统一入口与结构化返回值
- 对尚未完成的平台，必须返回：

```ts
{ ok: false, status: "manual_required", reason: "unsupported_download_mode" }
```

不要一开始就把所有平台做满；先把“Gale 现有强能力 + 其他平台 stub”放进同一契约。

**Step 4: 跑测试**

Run: `pnpm exec vitest run runner/src/platform/registry.test.ts runner/src/platform/driver-contract.test.ts`

Expected: PASS。

**Step 5: 小步提交**

Run: `git add runner/src/platform runner/src/capture.ts && git commit -m "Histwrite: add platform driver registry"`

---

### Task 5: 把矩阵和 driver 暴露给 Histwrite 真实工具入口

**Files:**
- Modify: `runner/src/cli.ts`
- Create: `runner/src/cli.sources.test.ts`
- Modify: `plugin-openclaw/src/runtime.ts`
- Modify: `plugin-openclaw/src/runtime.test.ts`

**Step 1: 写失败测试，定义用户可调用入口**

至少覆盖这些命令：
- `sources matrix`
- `sources platform-plan`
- `sources download --platform <id> --mode <mode>`

```ts
expect(await runTool("sources matrix")).toContain("umich_platform_matrix.tsv");
```

**Step 2: 跑测试确认路由未接入**

Run: `pnpm exec vitest run runner/src/cli.sources.test.ts plugin-openclaw/src/runtime.test.ts`

Expected: FAIL。

**Step 3: 最小接线**

实现要求：
- `sources matrix`：返回矩阵路径与摘要
- `sources platform-plan`：返回按平台聚类的待办与状态
- `sources download`：读取矩阵行 → 解析平台/下载模式 → 分发给 `platform-dispatch.ts`

本阶段只要求：
- `runner/src/cli.ts` 接入新命令
- `plugin-openclaw/src/runtime.ts` 继续做薄透传
- 不引入第二套命令入口

**Step 4: 跑测试**

Run:
- `pnpm exec vitest run runner/src/cli.sources.test.ts plugin-openclaw/src/runtime.test.ts`
- `pnpm -s tsc -p tsconfig.json --noEmit`

Expected: PASS。

**Step 5: 小步提交**

Run: `git add runner/src/cli.ts runner/src/cli.sources.test.ts plugin-openclaw/src/runtime.ts plugin-openclaw/src/runtime.test.ts && git commit -m "Histwrite: expose platform matrix workflows"`

---

### Task 6: 按平台优先级做 rollout，而不是按数据库逐个手搓

**Files:**
- Modify: `docs/plans/2026-03-12-histwrite-platform-cluster-adaptation.md`
- Update outputs under: `材料/_index/umich_platform_matrix.{json,tsv,md}`

**Step 1: 先跑第一版矩阵并人工复核前 30 行**

Run:
- `node --import tsx runner/src/cli.ts platform matrix --project "/Users/woooci/Downloads/histwrite" --guide-json "材料/_index/world_history_db_guide_appendix2.json" --umich-json "<最新抓取结果>.json"`
- `sed -n '1,40p' 材料/_index/umich_platform_matrix.tsv`

Expected: 能看到 `guideName → umichHit → landingUrl/landingHost → platform → downloadMode → status/notes`。

**Step 2: 只挑前四个平台做 smoke**

优先级固定为：
1. `jstor`
2. `proquest`
3. `gale`
4. `adammatthew`

每个平台至少完成一次：
- 从 UMich 入口进入
- 到达 vendor 落地页
- 识别下载 affordance
- 返回结构化状态

其中：
- repo-local 验证：矩阵行、driver 路由、Histwrite 命令输出
- 外部工具链验证：真实扫描脚本 smoke 与 raw CDP 重附着

**Step 3: 把 rollout 结果写回矩阵**

字段最少包括：
- `status`
- `notes`
- `lastVerifiedAt`
- `lastVerifiedBy`

**Step 4: 跑最终验证**

Run:
- `pnpm exec vitest run runner/src/platform/contract.test.ts runner/src/platform/matrix.test.ts runner/src/platform/registry.test.ts runner/src/cli.sources.test.ts plugin-openclaw/src/runtime.test.ts`
- `pnpm -s tsc -p tsconfig.json --noEmit`

Expected: 全部 PASS。

**Step 5: 小步提交**

Run: `git add docs/plans/2026-03-12-histwrite-platform-cluster-adaptation.md runner/src/platform runner/src/cli.ts plugin-openclaw/src/runtime.ts relay && git commit -m "Histwrite: roll out clustered database adaptation"`

---

## 平台聚类口径（第一版）

### Tier 1：必须优先打通
- `jstor`
- `proquest`（PQDT / Historical Newspapers / Research Library 共用大平台）
- `gale`
- `adammatthew`

### Tier 2：应尽快纳入同一矩阵，但允许先手动/半自动
- `hathitrust`
- `cnki`
- `ebsco`
- `project_muse`
- `readex`

### Tier 3：先收敛到 fallback，不单独立项
- 无稳定下载接口的平台
- 严重依赖验证码/反爬流程的平台
- 仅开放元数据、不开放全文的平台

---

## 里程碑验收

### Milestone A：矩阵先出来
- 能从指南 + UMich 目录生成 `umich_platform_matrix.tsv`
- 不是所有行都要 ready，但每行都必须有 `platform` 和 `status`

### Milestone B：driver 先统一协议
- 平台 driver 可返回 `ready / partial / manual_required / blocked`
- Histwrite 工具层能基于矩阵自动选 driver

### Milestone C：四大平台 smoke 跑通
- `jstor / proquest / gale / adammatthew` 至少各有一个已验证样例

---

## 当前建议的第一刀

如果现在立刻开工，不要从“再写一个数据库脚本”开始，而是按这个顺序：

1. 当前仓先做 `Task 1 + Task 2`，把矩阵契约和 OCR 清洗打稳
2. 紧接着做 `Task 4`，先把 Gale 适配器纳入统一 driver 契约
3. 再做 `Task 5`，通过 `runner/src/cli.ts` + `plugin-openclaw/src/runtime.ts` 暴露命令
4. 最后做 `Task 3`，把 raw CDP 重附着接进本仓的 relay/扫描器

这样做的原因很简单：**当前仓里最先缺的是“可落盘的矩阵契约与脏数据清洗”；先把 `runner/` 和 `plugin-openclaw/` 的控制面做稳，再把 raw CDP 修复并入本仓 `relay/`，后面就不会再被“计划在这、实现却在别的仓”拖住。**
