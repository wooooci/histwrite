# Histwrite Schema Migration（V1 → V2：State / Phase / Blueprint / Materials）Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
>
> **Upstream Spec（总方案/宪法）**：`docs/plans/2026-03-10-histwrite-publication-workflow-v4.1-selector-contract.md`  
> **Prereq（前置条件）**：先完成 Phase 0 巨石拆解：`docs/plans/2026-03-10-histwrite-monolith-decomposition.md`

**Goal（目标）**：把当前 Histwrite 的 `HistwriteStateV1`（`phase=clarify|draft|polish`、`materials[].text`、简版 Blueprint）升级为 **可承载 v4.1 出版级工作流** 的 `HistwriteStateV2`，并提供 **强向后兼容** 的 `coerceState()` 迁移路径（V1 state 可读、自动迁到 V2、持续可演进）。  

**Architecture（一句话）**：**State 只存“不可变工件（Artifacts）的 heads 指针 + 最小必要兼容字段”**；workflow 的 6 宏状态是“构建图上的阶段”，而不是把 16 个 agent 节点塞进一个不可控状态机。  

**Tech Stack**：TypeScript ESM、Vitest、（可选）离线脚本（仅用于迁移前扫描/校验，不参与 runtime）。

---

## 0) 背景与断层（必须先补上，不然 v4.1 计划无法落地）

### 0.1 现有 V1 State（代码事实）

当前 `extensions/histwrite/src/histwrite-tool.ts` 的 `HistwriteStateV1`：

- `version: 1`
- `phase: "clarify" | "draft" | "polish"`
- `blueprint: Blueprint`（字段较少，缺少 entity/timeline/constraints 等）
- `materials: Array<{id, addedAt, text}>`（仅纯文本，且全仓库大量 `.text` 直接读取）

### 0.2 v4.1 计划对 State 的隐含要求（不补会断）

- 6 宏状态：`PLAN / EVIDENCE / DRAFT / VERIFY / WEAVE / FINAL`
- Materials 三层文本：`rawText / normText / indexText` + `selectorContractVersion`
- Blueprint v2：`entityCards[] / glossary[] / timeline[] / evidenceRequirements[] / constraintsConfig` 等
- Artifacts Build Graph：需要 `heads`（指针）与可回放日志

结论：这不是“加字段”，而是一次 **Schema Migration**，必须独立成 Phase 执行并被测试覆盖。

---

## 1) 迁移总策略（避免一次性大爆炸）

### 1.1 关键原则：兼容 + 编译期强迫迁移

- **永远读得懂旧 state**：`coerceState()` 必须接受 V1/V2/未知输入并返回 V2。
- **写回只写 V2**：任何保存 state 的路径必须落盘 V2（实现“软升级”）。
- **材料字段迁移用“编译错误驱动”**：让 `MaterialV2` **不再包含 `.text`**，通过 TS 编译错误把所有旧访问点暴露出来（比“列 20+ 处手工改”更可靠）。
- **phase 迁移不硬改现有用户体验**：保留 V1 `phase` 作为 `legacyPhase`（仅用于兼容/提示），新增 `macroPhase` 作为 v4.1 的唯一工作流阶段真值。

### 1.2 Phase（3 → 6）迁移策略（务必清晰）

**新增**：

- `type MacroPhase = "PLAN" | "EVIDENCE" | "DRAFT" | "VERIFY" | "WEAVE" | "FINAL";`

**V1 → V2 映射（迁移时一次性确定）**：

- `clarify → PLAN`
- `draft → DRAFT`
- `polish → FINAL`

**后续转移**由 Orchestrator/命令驱动（不是靠隐式推断）：

- 当完成材料入库/interpret/qa 后，macro 可进入/停留在 `EVIDENCE`
- gate 运行时进入 `VERIFY`
- weave/ finalize 分别进入 `WEAVE / FINAL`

> 重要：我们不把“每个 agent 节点”编码为 phase，只把 **构建图阶段** 写进 macroPhase，避免状态机爆炸。

---

## 2) V2 Schema（要迁的类型清单：必须显式列出）

### 2.1 State

**V1（现状）**：

- `HistwriteStateV1`

**V2（新增）**：`HistwriteStateV2` 至少包含：

- `version: 2`
- `updatedAt / enabled`
- `legacyPhase?: "clarify"|"draft"|"polish"`（仅用于兼容提示）
- `macroPhase: MacroPhase`（v4.1 唯一阶段真值）
- `blueprint: BlueprintV2`（可继续内嵌；未来可改为 artifact head）
- `materials: MaterialV2[]`（或改为 `materialsHeadId`，看 Phase 0 拆解结果）
- `history / lastDraft?`（保留）
- `heads`：Artifacts Build Graph 的 heads 指针（最小集也要有）
  - `blueprintId? / materialsId? / cardsId? / qaId? / draftId? / verifyId? / weaveId? / finalId?`
- `contractVersions`：
  - `selectorContractVersion: 1`（至少要在 state 里可追溯）

### 2.2 Blueprint

**V1（现状）**：`Blueprint`（字段较少）  
**V2（新增）**：`BlueprintV2`（建议在代码里显式类型别名，而不是靠“随便加字段”）

必须新增（可为空默认）：

- `entityCards?: Array<{ canonical: string; aliases?: string[]; notes?: string; timeRange?: string }>`
- `glossary?: Array<{ term: string; definition: string; constraints?: string[] }>`
- `timeline?: Array<{ at?: string; title: string; summary?: string; links?: string[] }>`
- `evidenceRequirements?: Array<{ claim: string; requiredKinds: string[]; notes?: string }>`
- `constraintsConfig?: { finalBlocksOnGaps: boolean; finalBlocksOnHighRiskChronology: boolean; ... }`

迁移策略：V1 blueprint 直接作为 V2 的子集，新增字段全部填默认空值/默认配置。

### 2.3 Materials

**V1**：`Material { id, addedAt, text }`  
**V2**：`MaterialV2`（三层文本 + 合同版本）

建议结构：

- `id / addedAt`
- `rawText`（权威）
- `normText`（normalize v1 的产物）
- `indexText`（检索层；可以先等于 normText，后续再升级）
- `selectorContractVersion: 1`
- `provenance?: {...}`（后续 Retrieval/Ingest 用）

> 兼容：迁移时把 V1 `text` → V2 `rawText`，再生成 `normText/indexText`。

---

## 3) 迁移前“地毯式盘点”（把未知变成已知）

> 你要求“列出所有直接 material.text 的使用位置”，工程上最可靠的方式是 **先在拆解后对目标目录跑 rg**，并把结果固化为可执行/可复现的清单。

### Task M0: 生成 material.text 访问点清单（可复现）

Run（Phase 0 拆解完成后执行一次即可）：

- `rg -n "\\.text\\b" extensions/histwrite/src`
- `rg -n "materials\\b" extensions/histwrite/src`

产出：
- `docs/plans/2026-03-10-histwrite-material-text-usage-inventory.md`（把命中列表粘贴进去，后续每次大迁移可更新）

验收：
- 任何迁移任务开始前，这份 inventory 必须存在（否则就是盲改）。

---

## 4) 任务拆分（Schema Migration Phase：在 v4.1 正式功能前完成）

> 说明：以下任务假设 Phase 0 已完成、`core/state.ts`、`core/materials.ts`、`commands/*` 等已落位；如果还没拆解完成，请先回到 Phase 0。

### Task M1: 引入 V2 types + coerceState V2（保持 V1 可读）

**Files:**
- Modify: `extensions/histwrite/src/core/state.ts`
- Test: `extensions/histwrite/src/core/state.test.ts`

**Step 1: 写 failing tests（V1 → V2 coerce）**
- 输入一个最小 V1 state（带 `phase/materials[].text/blueprint`）
- 断言输出：
  - `version===2`
  - `legacyPhase===输入 phase`
  - `macroPhase` 通过映射表得到
  - V1 materials 被迁成 V2（raw/norm/index + contractVersion）
  - BlueprintV2 新字段存在默认值（空数组/默认 config）

**Step 2: 实现 `coerceState()` 返回 V2**
- 必须兼容：
  - 空/坏 JSON
  - 旧 V1
  - 已经是 V2

**Step 3: 跑测试**
- Run: `pnpm vitest run --config vitest.extensions.config.ts extensions/histwrite/src/core/state.test.ts`

---

### Task M2: BlueprintV2 默认填充（显式而非隐式）

**Files:**
- Modify: `extensions/histwrite/src/core/blueprint.ts`（若 Phase 0 未抽离则在 `core/state.ts` 先落一个 `blueprint.ts`）
- Test: `extensions/histwrite/src/core/blueprint.test.ts`

**Acceptance:**
- 任何旧 blueprint 对象 coerce 后，V2 新字段一定存在（即便为空）
- constraintsConfig 有明确默认值（Draft vs Final 行为靠它控制）

---

### Task M3: MaterialsV2 的唯一访问入口（消灭 `.text` 直读）

**Files:**
- Modify: `extensions/histwrite/src/core/materials.ts`
- Modify: `extensions/histwrite/src/core/state.ts`
- Test: `extensions/histwrite/src/core/materials.test.ts`

**Step 1: 定义 accessor（强制统一层）**
- `getMaterialRawText(m)`
- `getMaterialNormText(m)`
- `getMaterialIndexText(m)`

**Step 2: 在 `MaterialV2` 类型上移除 `.text`**
- 让 TS 编译报错暴露所有旧访问点

**Step 3: 按编译错误逐个修复调用点**
- 先修 `commands/material.ts`（入库）
- 再修 interpret/outline/write/polish/finalcheck 路径

**Acceptance:**
- `extensions/histwrite/src` 内不再出现 `.text` 读取 Material（用 `rg "\\.text\\b"` 验证：允许其他结构的 `.text`，但 Material 相关必须清零或加白名单注释）

---

### Task M4: Phase 迁移：从 `phase` gating 改为 `macroPhase` gating

**Files:**
- Modify: `extensions/histwrite/src/tool/router.ts`（hot file：single-owner）
- Modify: `extensions/histwrite/src/tool/execute.ts`（hot file：single-owner）
- Test: `extensions/histwrite/src/tool/router.test.ts`

**Acceptance:**
- 旧命令在 V2 下仍可运行（兼容）
- 新命令（gate/weave/finalize）必须检查 `macroPhase`/heads，而不是 `legacyPhase`
- `/histwrite status`（或等价命令）必须显示：
  - legacyPhase（兼容提示）
  - macroPhase（真实工作流阶段）

---

### Task M5: 保存策略：读到 V1 → 自动写回 V2（软升级）

**Files:**
- Modify: `extensions/histwrite/src/tool/execute.ts`（hot file：single-owner）
- Test: `extensions/histwrite/src/tool/execute.test.ts`

**Acceptance:**
- 读取 state 文件为 V1 时，本次运行结束前会写回 V2（可通过测试 sandbox FS 或临时目录断言）
- 写回不会丢失 history/lastDraft 等旧字段

---

## 5) Exit Criteria（Schema Migration Phase 完成标准）

完成本计划后必须满足：

1) 任意 V1 state 都能被 `coerceState()` 读入并变成 V2（有测试）  
2) 保存路径只写 V2（软升级完成）  
3) `MaterialV2` 不再允许 `.text` 直读；所有 Material 文本访问都通过 accessor（用 `rg` + TS 编译双重保证）  
4) `macroPhase` 在 runtime 中可用，并作为新命令/gates/weave/finalize 的 gating 真值  
5) BlueprintV2 新字段默认值明确、可追溯（constraintsConfig 可控制 Draft/Final 行为）  

达到以上 Exit Criteria 后，才进入 v4.1 的后续功能期（EvidenceCards selectors、QA、Gates、Weaver、Finalize）。

