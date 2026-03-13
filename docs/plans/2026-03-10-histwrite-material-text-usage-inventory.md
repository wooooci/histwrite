# Histwrite V1：`material.text` / `state.phase` 使用点盘点（用于 V1→V2 迁移）

> **用途**：把“迁移会改到哪里”从猜测变成可复现的清单，避免 Schema Migration 盲改。  
> **再生方法**：在仓库根目录执行下述 `rg` 命令即可重新生成/更新本文件。

---

## 0) 再生命令（Regenerate Commands）

```bash
rg -n "\\.text\\b" extensions/histwrite/src/histwrite-tool.ts
rg -n "state\\.phase\\b" extensions/histwrite/src/histwrite-tool.ts
```

> 说明：当前 histwrite 仍是单体巨石（`extensions/histwrite/src/histwrite-tool.ts`），盘点集中在该文件。完成 Phase 0 拆解后，应改为对 `extensions/histwrite/src/{core,commands,tool}/**/*.ts` 全目录盘点。

---

## 1) `.text` 命中（来自 `extensions/histwrite/src/histwrite-tool.ts`）

以下为 `rg -n "\\.text\\b" extensions/histwrite/src/histwrite-tool.ts` 的完整命中列表（截至 2026-03-10）：

```text
216:    .filter((p) => !p.isError && typeof p.text === "string")
217:    .map((p) => p.text ?? "");
404:          text: String((m as any).text ?? ""),
413:          text: String((t as any).text ?? ""),
1839:  return typeof (hit as any)?.text === "string" ? String((hit as any).text) : "";
1901:  const text = String(material?.text ?? "").trim();
2933:      if (typeof (c as any).text === "string") texts.push(String((c as any).text));
3099:    rawText = await res.text();
3250:      md.push(m.text.trim() ? m.text.trim() : "_（空）_");
3928:  const raw = params.text.trim();
4034:    let text = (m.text ?? "").trim();
4356:      const tail = (await res.text()).trim();
4377:    const raw = await res.text();
4494:    return { ok: apiRes.ok, text: apiRes.text, argv: ["mineru-api", apiUrl] };
4689:          ...steps.flatMap((step, index) => [`${index + 1}) ${step.command}`, step.text || "（无文本输出）", ""]),
5569:              text: (m.text ?? "").trim().slice(0, maxCharsEach),
7065:	                material: { id: `doc:${task.relPath}`, text: task.text },
7099:	              docs: tasks.map((t) => ({ id: `doc:${t.relPath}`, text: t.text, source: { relPath: t.relPath } })),
7284:	              const nextLen = t.text.length;
7414:          if (exact) return { materialId: exact.id, materialText: (exact.text ?? "").trim(), created: false };
7680:          return { content: [{ type: "text", text: res.text }], details: res };
8419:            runs.push({ pdfPath: resolved, outDir, ok: r.ok, text: r.text, argv: r.argv });
8496:            runs.push({ pdfPath: resolved, outDir, ok: r.ok, text: r.text, argv: r.argv });
8519:          if (!indexRes.ok) lines.push(indexRes.text.trim());
8605:            text = loaded.text;
8817:            text = loaded.text;
9139:          return { content: [{ type: "text", text: res.text }], details: res };
9200:                text: String((m as any).text ?? ""),
9778:        state.history.push({ at: Date.now(), role: "assistant", text: report.text });
9781:          content: [{ type: "text", text: report.text }],
```

### 1.1 初步分类（迁移优先级）

> 注意：`.text` 命中不等于一定是 `Material.text`；其中包含 HTTP response `.text()`、日志 `report.text`、tool 返回 `res.text` 等。

**高优先级（疑似 Material / materials 序列化相关）**：
- `404`：`coerceState()` 对 V1 materials 的 `text` 字段硬编码
- `1901`：`material?.text`
- `3250`：`m.text`（materials 列表渲染）
- `4034`：`m.text`（materials 处理）
- `5569`：`m.text`（截断摘要）
- `7414`：`exact.text`（materials 精确匹配返回 materialText）
- `9200`：再次出现 V1→结构化对象的 `text` 迁移（需要核实上下文）

**中优先级（可能是“材料型对象”，但不一定是 state.materials）**：
- `7065/7099/7284`：docs/tasks 的 `t.text/task.text`（可能是 interpret/检索的临时结构）
- `8605/8817`：`loaded.text`（需要核实 loaded 的来源/类型）

**低优先级（非 Materials：网络/日志/工具输出）**：
- `3099/4356/4377`：`res.text()`（fetch）
- `4494/7680/8419/8496/9139/9781`：工具返回或报告结构的 `text` 字段
- `216/217/2933/4689/9778`：其他结构的 `text`

迁移时的硬标准不是“人工分类正确”，而是：
- `MaterialV2` 移除 `.text` 后，由 TS 编译错误强制清零所有旧访问点（见迁移计划：`docs/plans/2026-03-10-histwrite-schema-migration-v1-to-v2.md`）。

---

## 2) `state.phase` 命中（来自 `extensions/histwrite/src/histwrite-tool.ts`）

以下为 `rg -n "state\\.phase\\b" extensions/histwrite/src/histwrite-tool.ts` 的命中列表（截至 2026-03-10）：

```text
3206:  const phaseLabel = state.phase === "clarify" ? "澄清意图" : state.phase === "draft" ? "起草" : "精修";
5083:            phase: state.phase,
5258:              phase: state.phase,
5466:              phase: state.phase,
5572:              phase: state.phase,
5737:        state.phase = "draft";
6464:          phase: state.phase,
7063:	                phase: state.phase,
7097:	              phase: state.phase,
7521:            phase: state.phase,
8529:        state.phase = "draft";
8538:        state.phase = "polish";
9849:          phase: state.phase,
```

迁移目标：
- `phase` 降格为 `legacyPhase`（兼容提示用途）
- 引入 `macroPhase`（PLAN/EVIDENCE/DRAFT/VERIFY/WEAVE/FINAL）作为 v4.1 真值，并把 gating 从 `state.phase` 迁移到 `state.macroPhase/heads`。

