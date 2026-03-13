# Histwrite 平台解析分类（2026-03-13）

## 目标

把当前 `umich_platform_matrix` 里“已经匹配 / 可疑匹配 / 未匹配”的数据库正式分桶，形成仓内可筛选、可扩展、可继续实现的执行面，而不是继续靠人工记忆“哪些库大概能跑”。

本轮新增的正式入口：

- `node --import tsx runner/src/cli.ts platform classify --project /Users/woooci/Downloads/histwrite --umich-csv "<umich_history_databases.csv>"`

本轮正式产物：

- `材料/_index/umich_platform_resolution_classification.json`
- `材料/_index/umich_platform_resolution_classification.tsv`
- `材料/_index/umich_platform_resolution_classification.md`

---

## 输入源

### 1. 已生成的平台矩阵

- `材料/_index/umich_platform_matrix.json`
- 来源：指南清洗结果 + UMich raw JSON + relay/CDP vendor landing resolve

### 2. richer UMich CSV

- `/Users/woooci/Documents/Obsidian Vault/clawdbot/skill-outputs/umich/umich_history_databases.csv`
- 关键字段：
  - `title`
  - `ddm_link`
  - `access_type`
  - `platform`
  - `vendor_hint`
  - `company_guess`

### 3. 当前已验证的现实约束

- `search.lib.umich.edu/databases` 不能指望直接裸 HTTP 抓取。
- 2026-03-13 实测：
  - `curl https://search.lib.umich.edu/databases?search=JSTOR`
  - 返回 `HTTP/2 403`
  - `cf-mitigated: challenge`
- 结论：
  - 不只是 “UMich direct search by database title”，连 `ddm permalink -> vendor landing` 也必须统一走浏览器态 relay。
  - 优先路线：当前 relay `18992` + 当前 Chrome 登录态。

---

## 分类定义

### A 类：`matched_high_confidence`

- 含义：当前矩阵已匹配，且标题相似度未触发风险规则。
- 下一步：维持现状，作为 driver registry / 下载面优先消费的稳定池。

### B 类：`matched_needs_review`

- 含义：当前矩阵虽是 `planned`，但已被识别为疑似假阳性。
- 触发条件：
  - `guideName` 与 `umichHit` token overlap 太低
  - 明显国家冲突，例如 `Cambodia` 被配到 `Colombia`
- 下一步：先修匹配质量，再谈 driver。

### C 类：`csv_vendor_hint`

- 含义：当前矩阵是 `manual_required`，但 richer CSV 已给出高可信标题命中，且带 `ddm_link` / `platform` / `vendor_hint` / `company_guess`。
- 下一步：直接复用 CSV 提供的 `ddm_link`，再走现有 relay/CDP vendor landing resolver，不必先做 UMich search。

### D 类：`public_open_access`

- 含义：richer CSV 明确标注 `Open access for all users`，可单独走公开数据库接口。
- 下一步：补“public resolver”执行轨，不再把公开库混在普通授权平台逻辑里。

### E 类：`umich_direct_search`

- 含义：当前没有可靠匹配，也没有 richer CSV 足够线索，但标题本身可搜索。
- 下一步：实现 “guide title -> UMich database search -> ddm permalink -> vendor landing” 的浏览器态二级 resolver。

### F 类：`manual_backlog`

- 含义：当前标题过短、过泛、过像缩写或 OCR 信号太弱，不适合直接自动搜。
- 典型样本：`Cairn`、`CiNii`、`DBPIA`、`OECD`、`SAGE`
- 下一步：先做 alias / acronym seed map，再进入 direct search。

---

## 本轮真实统计

基于 2026-03-13 当下产物：

- 总行数：`1145`
- `matched_high_confidence`: `124`
- `matched_needs_review`: `12`
- `csv_vendor_hint`: `22`
- `public_open_access`: `6`
- `umich_direct_search`: `969`
- `manual_backlog`: `12`

---

## 各类代表样本

### `matched_needs_review`

- `NATO` -> `Rise and Fall of Senator Joseph R. McCarthy`
- `Cambodia: Records of the U.S. Department of State, 1960-1963` -> `Colombia: ...`
- `The Civil War` -> `World War II, Occupation, and the Civil War in Greece 1940-1949`
- `Sabin Americana 1500-1926` -> `Americana`

这类说明当前 `planned=142` 不能直接当“全可信”。

### `csv_vendor_hint`

- `ProQuest Research Library (PRL)` -> richer CSV 命中 `ProQuest Research Library`
- `Journal Storage (JSTOR)` -> richer CSV 命中 `JSTOR`
- `Romanticism: Life, Literature and Landscape` -> richer CSV 命中同名条目，且 `csvPlatformHint=adammatthew`
- `World History in Context ...` -> richer CSV 命中 `World History in Context`

这 22 条是最值得先做的“低成本增量”。

### `public_open_access`

- `HathiTrust Digital Library`
- `Digital Collections, Library of Congress`
- `Perseus Digital Library`
- `Images from the History of Medicine`
- `County and Regional Histories and Atlases: Michigan`

这类库不该继续套授权 vendor 的默认工作流。

### `manual_backlog`

- `Cairn`
- `CiNii`
- `DBPIA`
- `INSEE`
- `Juris`
- `OECD`
- `SAGE`

这批优先做 alias map，而不是直接跑全文搜索。

---

## 实现顺序建议

### 第一批：先吃 `matched_needs_review` + `csv_vendor_hint`

- 原因：
  - 数量小
  - 回报高
  - 能直接提升矩阵可信度和覆盖率
- 具体动作：
  - 用 richer CSV 的 `ddm_link` 回填可疑/缺失项
  - 对国家名冲突、缩写过短等场景加更硬的 guard

### 第二批：补 `public_open_access` 执行轨

- 目标：
  - 让公开库有单独的 resolver / driver contract
  - 不再默认假设需要代理登录 / vendor 导航

### 第三批：实现 `umich_direct_search`

- 关键现实：
  - 不能走裸 HTTP
  - 必须走浏览器态
- 推荐实现：
  - `runner/src/platform/umich-direct-search.ts`
  - 复用 relay `18992` + 当前 Chrome 登录态
  - 输出结构化 search 命中，再喂给既有 `vendor-landing.ts`

### 第四批：处理 `manual_backlog`

- 先建 alias / acronym map
- 再把其余残留条目送入 direct search

---

## 当前结论

仓里现在已经正式有了两层控制面：

1. `platform matrix`
2. `platform classify`

因此下一步不该再继续“手工知道 Gale / ProQuest / JSTOR / AMD / HathiTrust 哪些能跑”，而应该按分类产物推进：

- 先修 `12` 条可疑命中
- 再吃 `22` 条 richer CSV vendor 线索
- 再把 `6` 条公开库拆到单独接口
- 最后实现 `969` 条的浏览器态 UMich direct search
