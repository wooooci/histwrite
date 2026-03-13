# 给其他 Agent 的接入说明

即使宿主不是 OpenClaw，也可以直接使用本仓库：

## 只读模式

直接读取：

- `content/templates/`
- `content/templates/learn/memory/`
- `content/templates/learn/rubrics/`

## 可执行模式

若宿主支持 shell/tool 调用，可直接运行：

```bash
node runner/bin/histwrite.mjs --help
```

或：

```bash
node --import tsx runner/src/cli.ts --help
```

## 出版级工作流（v4.1）

若你要在本仓库推进“出版级/门禁式”的 v4.1 工作流（Selector Contract / Claim→Evidence→Citation / Gates / Weaver / QA Dataset），从这里开始读：

- `docs/plans/2026-03-11-histwrite-publication-workflow-v4.1-master.md`

## 增强浏览器模式

若宿主需要登录态浏览器检索，可额外启用 `relay/`。
