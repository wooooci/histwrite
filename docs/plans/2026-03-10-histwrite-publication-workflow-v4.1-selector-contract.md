# Histwrite 出版级工作流加固 v4.1（Selector/Mapping Tier‑0 + Compute‑First）Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal（目标）**：把 Histwrite 固化为“工业级/出版级”的历史写作工作流：可追责（Claim→Evidence→Citation）、可回放（Artifacts + hash + reports）、可阻断（FactCheck/Chronology/Finalcheck）、可长期演进（检索 agent 能力进化 + 回归评测 + 调优闭环）。  
**Core Philosophy（核心哲学）**：默认不省 token / 不省算力，用最大化计算换“拟真度 + 事实严谨度 + 可交稿稳定性”；但必须通过调度器/缓存/批处理避免并发墙与不可收敛。  
**Tier‑0 Hard Gate（本计划的硬前置）**：Selector/Mapping 的 Off‑by‑one/OCR 漂移是致命风险；因此从 Day‑1 起引入 **Text Mapping & Selector Contract** 子系统，并把其单元/契约测试升格为**阻断式门禁**（tests fail = 不允许合并/发布，不允许启用后续写作门禁链路）。

> **Repo Reality（本公开仓库的落地现实）**：本仓库的主战场是 `runner/`（确定性命令层），天然模块化、测试完备。v4.1 的“真值层（selector/artifacts/gates/weave/qa）”应全部落在 `runner/src/*`，`plugin-openclaw/` 仅做薄转发与展示。路径映射与复用清单见：`docs/plans/2026-03-11-histwrite-v4.1-public-repo-mapping.md`。
>
> **Upstream Note（仅当你要反哺回插件态时）**：如果你未来要把 v4.1 反向移植回“上游插件态（extensions 语境）”，可参考：
> - `docs/plans/2026-03-10-histwrite-monolith-decomposition.md`
> - `docs/plans/2026-03-10-histwrite-schema-migration-v1-to-v2.md`

---

## 0) Chosen Defaults（默认锁死的决策）

1) **Compute‑First / Token‑Unlimited**：发布（publish）模式默认“多候选 + 仲裁 + 复核 + 门禁迭代”；交互（interactive）模式允许先跑快速预览，但最终交付必须跑 publish。
2) **事实边界三分法**：已知史实 / 学术争议 / 推断推演必须显式区分；推断不得写成史实；材料不足必须走【缺口】机制。
3) **跨组件 selector 的唯一真值 = `TextQuoteSelector`**：跨语言边界（Python→TS/前端、TS→Python）**一律不信任数值偏移**；position 只能是“同一运行时内部”的缓存 hint，并且接收端必须二次校验，不通过就自动 re-anchor。
4) **偏移语义**：半开区间 `[start, end)`；偏移单位为 `utf16_code_unit`（与 JS 字符串 `slice` 一致）。Python 端禁止生成 offset 真值。
5) **QA（史料主题问答）**：QA 是“材料内涵外置化理解层”，不是引用来源；正文引用仍必须落到 EvidenceCards 的证据链与可重提取引文。

---

## 1) Why（为何这样设计：把风险变成可控工程）

### 1.1 状态机爆炸（State Machine Explosion）

不构建“16 个角色=16 个状态节点”的显式状态机。改为：

- **6 个宏状态**（稳定不扩）：`PLAN / EVIDENCE / DRAFT / VERIFY / WEAVE / FINAL`
- **Artifact Build Graph（类构建系统）**：工件不可变（immutable），运行态只保留 heads 指针；回滚=改指针+标记下游 stale+重新 build，下游尽可能复用缓存。

这样即使“第 14 步发现第 2 步断档”，也不需要跨 12 节点手写逆操作，只需要产出 Blueprint patch 并重建依赖。

### 1.2 严格子串匹配脆弱（Brittleness of Exact Substring）

从“quote 必须 exact substring”升级为 **Selector+Resolver**：

- 跨组件只传 `TextQuoteSelector(exact+prefix/suffix, layer=normText)`
- 系统必须能通过 resolver 从 `rawText` **重提取**引文（更强：允许换行/空白等轻度差异，不允许无根引用）
- position 仅为本地 hint；错了就丢弃并 re-anchor。

### 1.3 Frankenstein 文本（碎片化导致连贯性丧失）

引入 **Narrative Weaver（叙事纺织工）**：

- 允许：平滑章节/段落过渡、指代回指、术语统一、重复解释合并
- 禁止：新增可核查事实；改写已通过 FactCheck 的 claim 语义
- Weaver 后强制再跑 VERIFY（FactCheck + Chronology），并进行 ClaimSetDiff（禁止新增 claim）。

### 1.4 并发墙/时延（Latency & Concurrency Wall）

仍是 Compute‑First，但引入：

- provider‑aware 调度器（maxConcurrency、backoff、优先级）
- 内容寻址缓存（taskName + promptVersion + inputsHash）
- 批处理（减少 API 请求次数）
- 渐进加深（interactive 快反馈，publish 拉满质量）

---

## 2) Macro Workflow（6 宏状态 + 依赖图重建）

### 2.1 6 宏状态（唯一允许的“状态机层级”）

1) `PLAN`：Clarifier + Research Planner  
   输出：`Blueprint@v2`、`QueryPlan`、`EvidenceRequirements`
2) `EVIDENCE`：Retrieval/Ingest → Materials（raw/norm/index）→ Interpreter → EvidenceCards → MaterialQADataset  
3) `DRAFT`：Outline → SectionPack（cards+qa+textWindow+timeWindow）→ Writer（含 claim anchors）  
4) `VERIFY`：ClaimExtractor → FactCheck Gate → Chronology Guard → WorkOrders  
5) `WEAVE`：Narrative Weaver（全局缝合）→ 再 VERIFY  
6) `FINAL`：Polisher（表达层）→ 再 VERIFY → Finalcheck → 输出 Final + Reports

### 2.2 Artifact Build Graph（回滚/重建规则）

- **工件不可变**：每次产出写入 `artifactId = hash(content)`，记录到 `run-log.jsonl`。
- **heads 指针**：运行态只保存当前 head（blueprint/materials/cards/qa/draft/verify/weave/final）。
- **stale 传播**：上游 head 变更会使下游标 stale；build 目标会自动重建 stale 工件。

> 这不是“缩小范围”，而是把复杂度压到工程上可控的位置：依赖图重建比手写回滚状态机稳定得多。

---

## 3) Roles & Protocols（角色分工与协作协议）

> 角色可以多，但必须严格边界；协作只通过 Artifacts，禁止口头转述事实。

### 3.1 角色清单（功能边界）

- Orchestrator：编排、调度、缓存、并发、门禁、回滚、日志落盘
- Clarifier：锁定范围/体例/分期/概念/时间窗
- Research Planner：QueryPlan + EvidenceRequirements（论点→证据需求）
- Retrieval/Ingest：下载/快照/OCR/索引；只产 Materials+provenance
- Interpreter：Materials → EvidenceCards（direct/inference、gaps、citeTemplate）
- Material QA Builder：cards/materials + blueprint → QA JSONL（带 selectors）
- Outline Agent：论证链大纲（每节判断句→证据需求→竞争解释→缺口）
- Section Packer：每节证据包（cards+qa+textWindows+timeWindow）
- Writer：只用 SectionPack 写草稿；必须插入 claim anchors；禁止新增可核查事实
- Claim Extractor：基于 anchors 抽取 ClaimMap
- Fact‑Checker Gate：Claim→Evidence 对齐；unsupported/contested 产出最小修复工单
- Chronology Guard：timeWindow 一致性 + 时代错置/术语年代风险
- Revision Controller：只允许定点修复/降格推断/补证据回流；修后重跑门禁
- Narrative Weaver：只做“缝合”，不改事实；weave 后再 VERIFY
- Polisher：只改表达不改事实；polish 后再 VERIFY
- Finalcheck：体例/脚注/参考文献/占位符/本地路径清零

### 3.2 协作协议（防信息失真）

- **唯一真相载体 = Artifacts**：下游只读工件字段，不读“上游口头解释”
- **ID 驱动引用**：跨阶段引用必须携带 `materialId/cardId/qaId/claimId`
- **禁止隐式事实注入**：Writer/Polisher 不得新增实体/日期/数字/因果；若需要新事实，必须回到 EVIDENCE 补证再写

---

## 4) Artifacts（工件）规范：可追责的关键

> 只要工件结构正确，工作流就可回放、可审计、可扩展。

### 4.1 Blueprint@v2（全局记忆/边界）

必须包含（可渐进填充，但字段语义固定）：

- 研究：`coreQuestion/thesis/scope/periodization/concepts[]`
- 体例：`citationStyle`（《历史研究》或 Chicago NB；全篇一致）
- 时间：`timeRange`（全篇）+ `sectionTimeWindows`（每节）
- 一致性：`entityCards[]`（规范名/别名/译名/官职变迁）、`glossary[]`（术语口径）、`timeline[]`（事件卡）
- 证据：`evidenceRequirements[]`（论点→证据类型需求）
- 约束：`constraintsConfig`（Final 阶段缺口阻断/年代高风险阻断等）

### 4.2 Materials（原文材料 + provenance + 三层文本）

- `rawText`：权威原文（最终引文必须能从此重提取）
- `normText`：轻度规范化定位层（见 Selector Contract）
- `indexText`：检索层（只能用于定位候选，不得直接引用）
- `provenance`：来源链（url/页码/馆藏字段/快照 id/ocr meta 等）

### 4.3 EvidenceCards（证据卡：direct/inference + selectors）

每条 extracted evidence 必须具备：

- `fact`（可核查描述）
- `selectorBundle`（至少 TextQuoteSelector；可附 position hint 但不得跨组件当真）
- `resolvedSpan`（由 resolver 产出：rawStart/rawEnd/extractedExactRaw/method）
- `location`（页码/行号/快照字段；允许缺口）
- `level=direct|inference`、`confidence`
- `gaps/ambiguities/nextQueries/citeTemplate`

> 旧版只存 `quote` 的卡允许存在，但在 Final 模式必须能升级到 selector+resolvedSpan，否则 blocker。

### 4.4 MaterialQADataset（史料主题问答数据集，JSONL）

每条 QA（默认每卡 6 问）：

- `question/answer`
- `answerType=direct|inference|gap`
- `evidence[]`：必须指向 cards/materials 的 selector（并可重提取 raw 引文）
- `useInWriting`：建议用于哪节、支持哪个论点/反论点、如何使用、局限
- `riskFlags`：年代风险词、偏差风险、争议信号

### 4.5 DraftSections（带 claim anchors）

Writer 必须在正文写入：

- `〔claim:<id>|kind=...〕...〔/claim〕`

ClaimExtractor 只按 anchor 抽取 claim span，避免纯字符串匹配。

### 4.6 Reports（门禁报告）

必须落盘：

- `ClaimMap`
- `FactCheckReport`（supported/inference_ok/contested/unsupported + 最小修复工单）
- `ChronologyReport`（时间窗/时代错置/高风险待确认）
- `FinalcheckReport`
- `run-log.jsonl`（候选、选择理由、hash 链、门禁结果）

---

## 5) Tier‑0：Text Mapping & Selector Contract（v4.1 核心）

### 5.1 Contract（Must / Must Not）

- Must：任何可追溯引用必须包含 `TextQuoteSelector(exact+prefix/suffix, layer=normText)`
- Must Not：跨组件传递/使用 `start/end` 作为真值（Python→TS/前端、TS→Python 都不行）
- Must：接收端必须 `verifyOrReanchor()`：
  1) 若带 position hint：先验证切片与 quote 等价（仅允许极小容错，如换行等价）
  2) 不等：丢弃 position，改用 quote+prefix/suffix 重定位
  3) 仍失败：标记 `unresolvable` → 进入【缺口/需重入库】（Final 阶段 blocker）
- Must：偏移语义 `[start,end)`；偏移单位 `utf16_code_unit`

### 5.2 normText 允许的规范化（固定 v1，不随意扩）

允许：

- `\r\n`、`\r` → `\n`
- 去 BOM：`\uFEFF`
- NBSP：`\u00A0` → `" "`（可配置开关；默认开）

禁止：

- NFC/NFKC 等 Unicode 归一化（避免组合字符结构变化导致 mapping 不可控）

### 5.3 Selector 类型（跨语言稳定序列化）

- `TextQuoteSelector`（跨组件唯一可信）
  - `layer: "normText"`（默认）
  - `exact: string`
  - `prefix?: string`（建议 12–48 code units）
  - `suffix?: string`
- `TextPositionHint`（仅本地 hint）
  - `layer: "rawText"|"normText"|"indexText"`
  - `start/end`（utf16 code unit）
  - `unit: "utf16_code_unit"`

### 5.4 Resolver 输出（所有门禁/高亮/抽证据点都必须走它）

`resolveSelector(material, selectorBundle) -> ResolvedSpan`

- `rawStart/rawEnd`（utf16）
- `extractedExactRaw`（从 rawText 切片得到的真实引文）
- `method: "position_verified" | "quote_anchored" | "quote_anchored_ambiguous" | "unresolvable"`
- ambiguous：必须返回候选列表 + 原因（Final blocker）

> 语义相似/embedding/LLM 只能用于“定位候选窗口”，不能直接当证据放行；最终必须回到 rawText 切片重提取。

---

## 6) Day‑1 Gate：极度严苛 Text Mapping 单元/契约测试体系

> 这是 v4.1 的核心交付：没有它，Selector 系统必然在真实 OCR 材料上崩溃。

### 6.1 测试分层（必须同时具备）

1) **Normalization Mapping Tests**
   - 映射单调性（offset 不倒退）
   - 边界一致性（0 与 len）
   - quote 级 round‑trip（能从 raw 重提取）
2) **Resolver Tests（verifyOrReanchor）**
   - position 正确 → `position_verified`
   - position off‑by‑one/错段 → 丢弃 position → `quote_anchored`
   - quote 多处出现 → `quote_anchored_ambiguous`（要求 prefix/suffix 或人工确认）
   - OCR 漂移找不到 → `unresolvable`（触发【缺口/需重入库】）
3) **Unicode Torture Suite（罕见 unicode + 换行符）**
   - surrogate / non‑BMP（😀、CJK 扩展）
   - ZWJ 序列（👩‍💻）
   - 组合附加符（e\u0301）及边界切片用例
   - VS16（✌️）
   - 双向控制字符（RLM/LRM/嵌入符）
   - 换行：`\n`、`\r\n`、`\r`、`\u2028`、`\u2029`、`\u0085`
   - 空白：NBSP、零宽、细空格
4) **确定性 Fuzz（固定 seed，无外部依赖）**
   - 生成包含上述字符分布的随机文本
   - 随机抽取 span→生成 quote selector→normalize+resolve→必须回到同一 raw 片段

### 6.2 跨组件契约测试（Python→TS/前端）

- 交付测试向量文件（JSON；raw/norm 用 base64 存储以避免编码差异）：
  - `rawText_b64`
  - `normText_expected_b64`
  - `selectors[]`（quote+prefix/suffix）
  - `expected_extractedExactRaw_b64`（或期望 ambiguous/unresolvable）
- TS/Vitest：必须跑通向量
- Python：提供 `verify_vectors.py`（可不进 CI，但必须一键跑），证明 Python 输出 quote selector 在 TS 端可稳定 re-anchor
- 若有前端高亮：必须用同一向量跑契约测试（避免 UI 层 off‑by‑one）

### 6.3 变更规则（测试即门禁）

任何涉及：

- normText 规则变更
- resolver 匹配策略变更
- selector schema 变更

都必须：

1) bump `selectorContractVersion`
2) 更新测试向量
3) 全套测试通过

否则禁止启用后续写作门禁链路。

---

## 7) 出版级门禁（Gates）与闭环

### 7.1 FactCheck Gate（Claim→Evidence→Citation）

- 每条 claim 必须绑定 EvidenceRefs（指向 resolver 可重提取的 raw 引文）
- Final 模式默认规则：
  - `unsupported` = blocker
  - `contested` 若未呈现至少两条解释路径并各有出处 = blocker
  - 残留【缺口】= blocker（必须补证或改写为不可确证表述并说明缺什么）

### 7.2 Chronology Guard（时间线 + 时代错置）

- 每节/段必须有 `timeWindow`
- 越界叙述必须显式标注“回溯/前史/后果/史学回顾”视角切换
- 规则库硬命中直接 blocker；软风险项 `high_risk_needs_human_confirmation` 在 Final 未确认即 blocker

### 7.3 Finalcheck（体例门面）

- 占位符/本地路径/脚注定义-使用不一致/体例混用 等清零才放行

### 7.4 Revision Controller（回滚/修复）

只允许两类修复：

1) 定点修复：删/改/降格推断（不得扩写引入新事实）
2) 补证据回流：新增材料→新卡→（可选）新 QA→再写

修复后必须重跑 FactCheck + Chronology，直到 blocker=0 或达到最大迭代轮次（默认 3）。

---

## 8) Narrative Weaver（解决 Frankenstein）

### 8.1 允许/禁止

允许：

- 平滑章节/段落过渡、指代回指
- 统一术语与译名（以 entityCards/glossary 为准）
- 合并重复解释、减少突兀断裂

禁止：

- 新增可核查事实（新实体/日期/数字/因果）
- 改写已通过 FactCheck 的 claim 语义（除非删除或降格，并记录理由）

### 8.2 Weaver 后强制复核

- `ClaimSetDiff`：禁止新增 claim；允许删除/降格（需记录理由）
- 再跑 FactCheck + Chronology，通过后才进入 FINAL

---

## 9) Compute‑First 调度策略（不省 token 但必须可跑完）

### 9.1 调度器（provider‑aware）

- `maxConcurrencyPerProvider`
- backoff + jitter + maxRetries
- 队列优先级（建议：VERIFY > EVIDENCE > DRAFT > WEAVE > FINAL）

### 9.2 缓存（内容寻址）

缓存键建议：

`taskName + promptVersion + modelKey + inputsHash`

上游不变不重烧算力；回滚/重建尽量复用缓存。

### 9.3 批处理（减少请求次数）

- Interpret：批量处理 materials（JSONL 输出）
- QA Builder：批量处理 cards（JSONL 输出）
- VERIFY：按 section 批量核查（数组输出）

### 9.4 渐进加深（交互友好但最终拉满）

- interactive：N=1 快速产出草稿 + 初版门禁报告（用于调试）
- publish：自动 deepening（多候选/仲裁/weave/全量复核）直到门禁通过或达到轮次上限

---

## 10) Acceptance Criteria（验收标准：出版级）

在“publish 模式定稿”前必须同时满足：

- `FactCheck.blockers == 0`
- `Chronology.blockers == 0`（高风险项已确认或改写规避）
- `Finalcheck.placeholderCount == 0` 且 `localPathRisks == 0`
- 所有引用均能通过 resolver 从 rawText **重提取**引文（无 `unresolvable`）
- Weaver 后 `ClaimSetDiff.added == 0`

---

## 11) Implementation Roadmap（执行顺序：为收敛而分阶段，但最终范围不缩）

> 下面的“阶段”是**施工顺序**，不是“最小范围”。最终交付必须包含本计划所有模块。

### Upstream‑only（仅插件态语境）：Phase 0/1

本公开仓库（runner‑first）**不需要**“拆巨石/State 迁移”作为前置条件；若你要反哺回插件态，可参考：
- `docs/plans/2026-03-10-histwrite-monolith-decomposition.md`
- `docs/plans/2026-03-10-histwrite-schema-migration-v1-to-v2.md`

### Phase A — Tier‑0 地基：Selector Contract + Mapping + Torture/Fuzz + 契约向量（阻断门禁）

- 新增 selector contract 模块（TS）：normText 构造、mapping、resolver、verifyOrReanchor
- 新增 Vitest 测试套件：normalization/resolver/unicode torture/deterministic fuzz
- 新增契约向量 JSON（base64）+ TS 测试加载器
- 新增 Python `verify_vectors.py`（可单独运行），验证“跨组件只传 quote selector”能在 TS 侧稳定 re-anchor

### Phase B — MaterialsV2 + Artifacts（raw/norm/index + heads/runlog）

- Materials 三层文本落盘（raw/norm/index + provenance + selectorContractVersion）
- heads 指针 + runlog：回滚/重建不靠逆操作状态机

### Phase C — EvidenceCardsV2：selectors + resolvedSpan（quote 可重提取）

- interpret 输出升级：EvidenceCards 产出 selectorBundle（至少 quote selector）+ 由系统 resolver 生成 resolvedSpan
- 旧卡迁移：读入旧卡时尝试生成 selectors；失败则标记 gap 并在 Final 阶段 blocker
- SectionPack 携带 selectors 与 extractedExactRaw（或可重提取配置）供 Writer/FactCheck 使用

### Phase E — Material QA Dataset（史料主题问答）全量接入

- QA Builder 以 cards/materials/blueprint 为输入，产出 QA JSONL
- QA 引用也必须绑定 selectors/resolvedSpan（可重提取 raw 引文）

### Phase D — SectionPack（Writer 的唯一事实输入面）

- pack 携带 cards + qa + timeWindow + textWindow + constraints
- pack 的选取策略允许 compute‑first（judge rank），但必须可收敛（cache/batch）

### Phase F — Claim Anchors + ClaimExtractor（ClaimMap 真值来源）

- Writer 强制输出 claim anchors（携带 evidence refs）
- ClaimExtractor 只按 anchors 抽取 ClaimMap（杜绝 substring brittle）
- ClaimSetDiff 用于 Weaver/Polish 的 no‑new‑claims gate

### Phase G — VERIFY 全量：FactCheck + Chronology + Revision Loop

- Claim anchors 机制：Writer 强制输出 anchors；ClaimExtractor 基于 anchors 抽取 ClaimMap
- FactCheck：逐条对齐 Evidence selectors；unsupported/contested 生成最小修复工单
- Chronology：timeWindow 与时代错置规则；高风险确认位；Final 阶段 blocker

### Phase H — WEAVE：Narrative Weaver + 再 VERIFY

- Weaver 只做缝合与一致性（术语统一、过渡平滑）
- Weaver 后强制 ClaimSetDiff + VERIFY

### Phase I — FINALIZE：WEAVE→VERIFY→POLISH→VERIFY→FINALCHECK→EXPORT

- polish 不改事实；polish 后 VERIFY
- finalcheck 清零并输出报告
- 归档：Final.md + reports + run-log + heads

### Phase J/K — Infra + Regression（让“拉满算力”可持续）

- 调度器/缓存/批处理/多候选仲裁：避免并发墙与不可收敛
- fixture + golden + e2e：把“可靠”变成可回归的门槛

### Phase G — 回归评测与调优（长期演进）

- promptfoo 回归：把门禁指标（unsupported、anachronism、gap 残留等）纳入回归样本与断言
- DSPy/Promptflow：对 interpret/write/polish/qa/gates 的 prompts 做自动调优（保持 contract 不变）

---

## 12) Notes（工程约束与兼容性约定）

- TypeScript ESM、严格类型、避免 `any`；遵循现有 Histwrite 插件的 JSON‑only + schema 校验模式。
- 不改依赖、不 patch 依赖（除非明确授权）。
- 任何 selector contract 相关变更必须先更新测试向量并通过全套测试。

---

## 13) External Best Practices Alignment（把“业界方法论”显式对齐到本架构）

> 目的：不是“贴引用”，而是把外部成熟经验映射到 Histwrite 的具体工程点，避免自嗨设计。

### 13.1 Anthropic（技术博客/工程文章）→ 对齐点

- **从简单可测的 workflow 起步，再逐步引入 agent 化**：我们以 6 宏状态 + 工件依赖图为“workflow 骨架”，把复杂性放进可回放/可门禁的工件，而不是把“角色数=状态机节点数”。参考：[Building effective agents](https://www.anthropic.com/research/building-effective-agents)。
- **多 agent 的价值来自并行与角色隔离，但必须由中心编排器做合成与质量控制**：对应本计划的 Orchestrator + Workstreams + single-owner hot files + publish 深化模式。参考：[How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system)。
- **工具/协议是契约（contract），必须可测试、可回归、可演进**：对应 Tier‑0 的 Selector Contract（向量、torture、fuzz、版本化），以及后续 gates 的 JSON schema 与阻断式验收。参考：[Writing tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents)。

### 13.2 GitHub（Agentic Workflows / Security Architecture）→ 对齐点

- **Action-first / Safe outputs / Auditable logs**：把“有副作用的输出”（最终稿、脚注、引用绑定、实体表等）视为 *safe outputs*，先落盘成工件，再经过门禁与确定性校验后“提交”。这与我们把 Final 输出放在 FINAL 阶段、并强制 VERIFY/Finalcheck 的设计一致。参考：
  - [GitHub Next: Agentic Workflows](https://githubnext.com/projects/agentic-workflows/)
  - [Security Architecture – GitHub Agentic Workflows](https://github.github.com/gh-aw/introduction/architecture/)
- **权限最小化 + 可审计**：外部检索只能进入 QueryPlan，必须转 Materials/EvidenceCards 才能进入正文引用；这是把“网络线索”限制为“无副作用输入”的最小权限策略。

### 13.3 bub / tape.systems → 对齐点（可借鉴，但不建议直接引入作为 runtime）

- **tape/anchors/views 的思路与本计划的 Artifacts Build Graph 高度同构**：
  - tape（append-only 记录）≈ `run-log.jsonl` + 工件哈希链
  - anchors（指针）≈ heads（blueprint/materials/cards/qa/draft/... 的当前 head）
  - views（派生视图）≈ SectionPack / Draft / Reports（由上游工件构建，而不是“口头继承”）
  参考：[tape.systems](https://tape.systems/)。
- **对 bub 仓库的适配性判断（截至 2026-03-10）**：
  - repo（当前实际入口）：[bubbuild/bub](https://github.com/bubbuild/bub)（历史上 `psiace/bub` 会重定向到该仓库）
  - 优点：hook-first、可见执行、上下文从 tape 构建、技能/插件化；理念上非常适配“可回放 + 可追责 + 门禁化”的 Histwrite。
  - 主要不适配点：语言/运行时为 Python，而 Histwrite 在 Clawdbot 体系内是 TypeScript 扩展；直接引入 bub 作为 runtime 会带来跨语言编排、部署与工具链割裂，反而扩大工程面。
  - 推荐用法：**借鉴其 tape/anchor/handoff 的工程范式**，但在 TS 端实现（与本计划一致），避免引入新的 runtime 依赖与双栈复杂度。

### 13.4 “外部最佳实践”对我们的硬化清单（落地动作）

- 任何新增工具/门禁必须有：schema + 失败可定位的报告 + 回归测试样本（对齐 Anthropic 的 tool-as-contract）。
- 任何副作用输出必须走：工件落盘 → VERIFY → Finalcheck → safe output commit（对齐 GitHub safe outputs）。
- 任何长篇一致性必须走：tape（日志）→ anchors（heads）→ views（派生上下文）（对齐 tape.systems 思路，避免“隐式上下文漂移”）。
