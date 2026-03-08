# Histwrite Public Repo Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 建立一个独立、可公开、内容优先的 Histwrite 仓库，包含 OpenClaw 插件入口、全量 runner、可选 browser relay，并严格去除私人信息。

**Architecture:** 仓库采用分层结构：`content` 承载模板与规范，`runner` 承载统一命令层，`relay` 承载浏览器接管能力，`plugin-openclaw` 只负责宿主接入。原私有仓库历史不直接公开，改为结构化时间线与新的安全提交链。

**Tech Stack:** TypeScript ESM、Node.js、OpenClaw 插件清单、CLI runner、浏览器 relay、Markdown 文档。

---

### Task 1: 搭建公开仓库骨架与隐私护栏

**Files:**
- Create: `.gitignore`
- Create: `package.json`
- Create: `README.md`
- Create: `docs/privacy.md`
- Create: `docs/history/upstream-timeline.md`
- Create: `scripts/privacy-scan.sh`

**Step 1:** 建立顶层目录与基础元信息。

**Step 2:** 写入隐私与公开边界文档。

**Step 3:** 添加隐私扫描脚本，检查邮箱、绝对路径、机构入口、密钥痕迹。

**Step 4:** 运行隐私扫描并确认当前骨架为干净状态。

### Task 2: 迁移 content 层（公开模板与规范）

**Files:**
- Create: `content/templates/...`
- Create: `content/memory/...`
- Create: `content/rubrics/...`
- Create: `content/examples/...`

**Step 1:** 从上游 `extensions/histwrite/templates/` 选择可公开内容。

**Step 2:** 替换所有绝对路径与私人环境引用。

**Step 3:** 添加面向其他 agent 的使用说明。

### Task 3: 把 runner 升级为主命令层

**Files:**
- Create: `runner/package.json`
- Create: `runner/src/...`
- Create: `runner/README.md`

**Step 1:** 迁移上游 runner 的确定性命令。

**Step 2:** 为 Histwrite 主要工作流补全 runner 命令面。

**Step 3:** 统一 `--json` 输出与结构化日志。

### Task 4: 迁移 relay 为可选组件

**Files:**
- Create: `relay/package.json`
- Create: `relay/src/...`
- Create: `relay/extension/...`
- Create: `relay/README.md`

**Step 1:** 迁移 browser relay server 与扩展。

**Step 2:** 添加与 runner 的集成说明。

**Step 3:** 确保文档中不出现私人浏览器或机构登录路径。

### Task 5: 添加 OpenClaw 插件壳

**Files:**
- Create: `plugin-openclaw/package.json`
- Create: `plugin-openclaw/openclaw.plugin.json`
- Create: `plugin-openclaw/index.ts`

**Step 1:** 建立薄插件入口。

**Step 2:** 插件层只做命令分发与配置解析。

**Step 3:** 业务逻辑尽量下沉到 runner / core。

### Task 6: 公开历史与验证

**Files:**
- Modify: `docs/history/upstream-timeline.md`
- Create: `.github/workflows/privacy.yml`

**Step 1:** 整理公开版演化历史。

**Step 2:** 增加 CI 隐私扫描。

**Step 3:** 在完成前运行隐私扫描与基础校验。

