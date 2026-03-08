# Histwrite

[English](README.en.md) · 简体中文

Histwrite 是一个**内容优先**的历史写作工作流仓库，默认面向 **OpenClaw**，同时尽量让其他支持读取仓库、调用 shell 或工具接口的 AI agent 也能直接复用其中的内容与命令。

它不是单纯的 prompt 集，也不是只服务某一个宿主的重插件，而是把历史写作需要的内容层、命令层和可选浏览器能力放在同一个可公开发布的仓库里。

## 这是什么

Histwrite 主要由四部分组成：

- `content/`：公开模板、memory、rubrics、风格说明与工作流内容
- `runner/`：统一命令层，提供可被 agent 调用的确定性操作
- `relay/`：可选 browser relay，用于登录态页面接管、快照与标签页读取
- `plugin-openclaw/`：给 OpenClaw 用的薄插件入口

对应两种主要使用方式：

1. **读内容**：直接读取 `content/` 下的模板、规范、长期记忆和评估标准
2. **跑命令**：通过 `histwrite` runner 执行项目初始化、材料索引、快照抓取、导出与校验

## 为什么这样设计

这个仓库刻意保持“**前者为主，后者为辅**”的形态：

- 对大多数 agent 来说，只读仓库内容就已经有价值
- 对支持执行命令的 agent 来说，可以进一步调用 `histwrite` runner
- 对需要登录态网页检索的场景，再额外启用 `relay/`
- 对 OpenClaw 用户来说，则可以直接走插件入口

也就是说，**OpenClaw 是第一入口，但不是唯一入口**。

## 快速开始

### 1. 安装依赖

```bash
pnpm install
```

### 2. 查看 runner 命令

```bash
node runner/bin/histwrite.mjs help
```

### 3. 初始化一个 Histwrite 项目

```bash
node runner/bin/histwrite.mjs project init --project ./demo-project
```

### 4. 查看项目状态

```bash
node runner/bin/histwrite.mjs project status --project ./demo-project
```

### 5. 索引材料目录

```bash
node runner/bin/histwrite.mjs library index --project ./demo-project --materials ./demo-project/材料
```

### 6. 检查 relay 状态

```bash
node runner/bin/histwrite.mjs relay status --relay http://127.0.0.1:18792
```

## 给不同宿主的使用方式

### OpenClaw

OpenClaw 可以把本仓库作为插件入口来用，插件层负责：

- 接收自然语言或工具调用
- 解析默认项目目录与 runner 参数
- 转发到 `histwrite` runner
- 返回结构化结果

相关文件：

- `plugin-openclaw/openclaw.plugin.json`
- `plugin-openclaw/index.ts`
- `docs/for-openclaw.md`

### 其他 Agent

如果宿主支持读取仓库内容，至少可以直接使用：

- `content/templates/`
- `content/templates/learn/memory/`
- `content/templates/learn/rubrics/`

如果宿主还支持 shell / tool 调用，则可以继续执行 `runner/` 中的命令。

相关说明见：

- `docs/for-agents.md`

## 仓库结构

- `content/`：公开内容层
- `runner/`：统一 CLI / tool 命令层
- `relay/`：增强浏览器能力
- `plugin-openclaw/`：OpenClaw 插件入口
- `docs/`：接入说明、迁移历史、隐私规范、计划文档
- `scripts/`：隐私扫描与发布前检查脚本

## 隐私与公开边界

这个仓库把“**不泄露私人信息**”放在最高优先级：

- 不包含个人邮箱、私人用户名、私人绝对路径
- 不包含学校图书馆代理入口、浏览器会话、cookie、token、API key
- 不包含你私人收集的材料、文章全文、下载归档或研究项目目录
- 不直接公开原始私有仓库的 Git 对象；公开仓库使用重建后的安全提交链

详细规则见：

- `docs/privacy.md`
- `docs/history/upstream-timeline.md`
- `docs/history/upstream-working-tree.md`

## 当前状态

目前这个公开仓库已经具备：

- 内容层模板与 rubrics 的公开版本
- 可直接执行的 `histwrite` runner
- 可选 browser relay
- OpenClaw 薄插件入口
- 基础隐私扫描与测试流程

后续会继续把更多 Histwrite 命令下沉到 runner，并逐步把 OpenClaw 插件做成更顺手的自然语言入口。
