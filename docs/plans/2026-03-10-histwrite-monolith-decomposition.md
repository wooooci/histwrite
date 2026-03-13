# Histwrite 巨石拆解（Monolith Decomposition）Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
>
> **Why this exists（核心原因）**：`extensions/histwrite/src/histwrite-tool.ts` 与 `extensions/histwrite/src/histwrite-tool.test.ts` 都是单体巨石；任何新增模块（selector/cards/gates/weave/qa）若继续在巨石里改，会导致多 agent 并行时大量 merge conflict，工程停滞。
>
> **Upstream Spec（总方案/宪法）**：
> - `docs/plans/2026-03-10-histwrite-publication-workflow-v4.1-selector-contract.md`
> - `docs/plans/2026-03-10-histwrite-v4.1-selector-contract-task-breakdown.md`

---

## 0) Cold Facts（必须直面现实）

| 指标 | 现状（代码库事实） |
|---|---|
| `extensions/histwrite/src/histwrite-tool.ts` | ~9,878 行（单体巨石） |
| `extensions/histwrite/src/histwrite-tool.test.ts` | ~3,056 行（单体测试巨石） |
| `extensions/histwrite/src/` | 仅 6 个文件（无子目录） |
| 状态机 | 仅 `Phase = clarify/draft/polish`（非计划中的 6 宏状态） |
| 计划中的目录 | `selector/ cards/ gates/ weave/ qa/` 等均不存在 |

> 结论：在不先拆巨石的情况下，后续 v4.1 的“并行施工/文件所有权隔离”是纸面承诺，代码层面不可实现。

---

## 1) Goals / Non‑Goals（本 Phase 的目标与非目标）

### 1.1 Goals（目标：只做“可持续施工”的地基）

1) 把 `histwrite-tool.ts` 拆成若干模块，让后续功能开发主要发生在新模块（目录）里。  
2) 把“必须频繁修改的热点区域”收敛到 **极少数 hot files**（并明确 single‑owner 策略）。  
3) 保持对外接口稳定：`createHistwriteTool(api, ctx)` 仍从 `extensions/histwrite/src/histwrite-tool.ts` 导出；`extensions/histwrite/index.ts` 不需要改。  
4) 拆解过程不改变行为（行为变化只允许在后续 v4.1 feature phase 中发生）。  
5) 为后续 v4.1 引入的目录（`selector/ cards/ gates/ weave/ qa/ core/ tool/ commands/`）提供落点与清晰边界。

### 1.2 Non‑Goals（非目标：避免把拆解当重写）

- 不在本 Phase 引入 v4.1 新功能（selector contract、gates、QA、weaver 都不做）。  
- 不重写所有逻辑，只做“抽离 + 薄封装 + 保持兼容”。  
- 不追求“一步到位 100% 模块化”，但要达到：后续开发不再必须改 9,878 行巨石。

---

## 2) Target Layout（目标目录结构：为后续 workstreams 预留稳定边界）

> 目标：让后续 `selector/cards/gates/weave/qa` workstreams 基本不需要碰 `histwrite-tool.ts`。

建议落地结构（Phase 0 只需要把“现有逻辑”迁过去；新功能后续再加）：

```
extensions/histwrite/src/
  histwrite-tool.ts              # 最终变为薄入口：re-export + minimal glue
  final-check.ts
  final-check.test.ts
  zotero.ts
  promptfoo-deai-style-assert-cjs.ts

  tool/
    create-tool.ts               # createHistwriteTool 的主体（tool definition）
    execute.ts                   # 读取/保存 state、自然语言链式命令、dispatch
    router.ts                    # verb 解析与 handler 映射（hot file）
    runtime.ts                   # RuntimeCtx（api/ctx/pluginCfg/baseDir/sessionKey/statePath/saveState）

  core/
    state.ts                     # HistwriteState + defaultState/coerceState（hot-ish）
    paths.ts                     # learn/* datasets/report paths
    io.ts                        # read/write json/jsonl, helpers
    scaffold.ts                  # ensureDefaultLearnScaffold + DEFAULT_LEARN_SCAFFOLD_FILES
    text.ts                      # normalize helpers（非 selector 的通用文本工具）

  prompts/
    defaults.ts                  # defaultEngineInstruction / defaultInterpretInstruction / defaultPolish...
    pack.ts                      # prompt-pack.json 读取与覆盖逻辑

  commands/
    help.ts
    lifecycle.ts                 # on/off/new/status
    material.ts
    interpret.ts
    outline.ts
    write.ts
    polish.ts
    finalcheck.ts
    ...                          # 其他已有命令逐步迁移（sources/search-report/downloads/library/...）
```

**Hot files（明确“不可并行修改”的文件）**：
- `extensions/histwrite/src/tool/router.ts`
- `extensions/histwrite/src/tool/execute.ts`
- （可能）`extensions/histwrite/src/core/state.ts`

> 规则：多 agent 并行时，任何人不得同时修改 hot files；由“集成 agent”统一落地合并。

---

## 3) Extraction Strategy（拆解策略：小步抽离 + 回归验证）

### 3.1 机械抽离优先（Mechanical Extraction First）

拆解顺序必须遵守“从低耦合到高耦合”：

1) 纯函数/工具（hash/io/paths/scaffold/prompts/help）  
2) state 类型与 coerce（但不改行为）  
3) command handlers（逐个 verb 抽离）  
4) 最后才调整 router/dispatch 结构（避免一次性大手术）

### 3.2 验收方式（每步都必须可证明“没改行为”）

- 每个抽离任务完成后必须跑：
  - `pnpm vitest run --config vitest.extensions.config.ts extensions/histwrite/src/histwrite-tool.test.ts`
  - 或至少跑该任务覆盖的最小子集（但必须最终全文件通过）

> 这不是为了省 token，而是为了保证拆解过程中“不引入隐蔽行为变化”。

---

## 4) Task Breakdown（Phase 0 拆解任务：按可验证的小步）

> 说明：每个 Task 目标是 15–45 分钟可完成（拆解本身不适合 2–5 分钟粒度）。

### Task 0.1: 建目录 + 迁移入口的最小骨架（不动逻辑）

**Files:**
- Create: `extensions/histwrite/src/tool/runtime.ts`
- Create: `extensions/histwrite/src/tool/router.ts`
- Create: `extensions/histwrite/src/tool/execute.ts`
- Create: `extensions/histwrite/src/tool/create-tool.ts`
- Modify: `extensions/histwrite/src/histwrite-tool.ts`

**Steps:**
1) 先在 `tool/` 下创建空壳函数与类型（不实现逻辑）  
2) `histwrite-tool.ts` 改为“薄入口”：`export { createHistwriteTool } from "./tool/create-tool.js"`  
3) `tool/create-tool.ts` 内部先“原样复制” `createHistwriteTool` 的最外壳（tool metadata + parameters），但 execute 暂时仍调用旧实现（短期过渡）  
4) 跑 `extensions/histwrite/src/histwrite-tool.test.ts`，确保完全一致

> 这一 Task 的目标是：先把“入口位置”固定下来，后续抽离只需要在 `tool/` 内演进。

---

### Task 0.2: 抽离 core/hash 与 core/io（低耦合）

**Files:**
- Create: `extensions/histwrite/src/core/hash.ts`
- Create: `extensions/histwrite/src/core/io.ts`
- Modify: `extensions/histwrite/src/tool/create-tool.ts`（或仍在旧文件时对应位置）

**Steps:**
1) 把 `sha256Hex`、json/jsonl 读写、snippet/rg 解析等低耦合工具迁移到 `core/`  
2) 入口处改为从新模块 import（保持行为一致）  
3) 回归跑 `histwrite-tool.test.ts`

---

### Task 0.3: 抽离 datasets/report 路径函数（core/paths.ts）

**Files:**
- Create: `extensions/histwrite/src/core/paths.ts`
- Modify: `extensions/histwrite/src/tool/create-tool.ts`

**Acceptance:**
- 所有路径函数返回值不变（通过现有测试/快照校验）

---

### Task 0.4: 抽离 scaffold（core/scaffold.ts）

**Files:**
- Create: `extensions/histwrite/src/core/scaffold.ts`
- Modify: `extensions/histwrite/src/tool/create-tool.ts`

**Acceptance:**
- `/histwrite on/new` 的 scaffold 行为与原先一致（现有测试应覆盖）

---

### Task 0.5: 抽离 prompts（prompts/defaults.ts + prompts/pack.ts）

**Files:**
- Create: `extensions/histwrite/src/prompts/defaults.ts`
- Create: `extensions/histwrite/src/prompts/pack.ts`
- Modify: `extensions/histwrite/src/tool/create-tool.ts`

**Acceptance:**
- 默认指令文本完全一致（可以用字符串断言或快照）
- prompt-pack 覆盖逻辑行为不变

---

### Task 0.6: 抽离 help 与自然语言链式命令解析（commands/help.ts + tool/router.ts）

**Files:**
- Create: `extensions/histwrite/src/commands/help.ts`
- Modify: `extensions/histwrite/src/tool/router.ts`
- Modify: `extensions/histwrite/src/tool/execute.ts`

**Acceptance:**
- `/histwrite help` 输出不变（或在允许范围内的格式变化需要更新对应断言）
- 复合自然语言链式命令仍可执行（现有测试应覆盖部分）

---

### Task 0.7: 抽离最简单的 lifecycle 命令（on/off/new/status）

**Files:**
- Create: `extensions/histwrite/src/commands/lifecycle.ts`
- Modify: `extensions/histwrite/src/tool/router.ts`（hot file：single owner）
- Modify: `extensions/histwrite/src/tool/execute.ts`（hot file：single owner）

**Acceptance:**
- `on/off/new/status` 行为完全一致

---

### Task 0.8: 逐个迁移“高频改动点”命令（为 v4.1 铺路）

> 优先迁移未来一定会改的点：materials/interpret/packs/write/polish/finalcheck。

**Order（建议顺序）**：
1) `commands/material.ts`
2) `commands/interpret.ts`
3) `core/cards.ts`（interpret 的 interpretation→cards 落盘/读盘）
4) `core/packs.ts`（outline map / section packs）
5) `commands/write.ts`
6) `commands/polish.ts`
7) `commands/finalcheck.ts`

**Rule**：
- 每迁移一个命令，必须立即跑全量 `histwrite-tool.test.ts`（避免累计风险）

---

### Task 0.9: 测试策略调整（避免后续把新测试都塞回巨石）

**Files:**
- Create: `extensions/histwrite/src/selector/*.test.ts`（后续 v4.1 Tier‑0）
- Create: `extensions/histwrite/src/gates/*.test.ts`
- Create: `extensions/histwrite/src/weave/*.test.ts`
- Create: `extensions/histwrite/src/qa/*.test.ts`

**Policy（强制）**：
- 新功能测试一律写到新 test 文件；除非必须修复旧断言，否则不改 `histwrite-tool.test.ts`。

---

## 5) Exit Criteria（Phase 0 完成标准）

Phase 0 结束时必须满足：

1) `extensions/histwrite/src/histwrite-tool.ts` 变为薄入口（可读性显著提升）  
2) 主要业务逻辑已迁移到 `tool/ core/ prompts/ commands/` 的若干文件（至少把“未来必改点”迁走）  
3) `pnpm vitest run --config vitest.extensions.config.ts extensions/histwrite/src/histwrite-tool.test.ts` 全量通过  
4) 明确 hot files 与 single‑owner 策略，后续 v4.1 workstreams 基本不再直接改巨石  

达到以上标准后，才进入 v4.1 的 Tier‑0 Selector Contract 与后续 gates/qa/weave 功能开发与并行施工。

