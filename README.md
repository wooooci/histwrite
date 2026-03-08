# Histwrite

[English](README.en.md) · 简体中文

**Histwrite 是一个给 OpenClaw 和其他 AI agent 使用的历史写作工作流仓库。**

它把一篇历史写作任务里最容易复用的部分整理成了一个公开仓库：

- 可直接读取的写作模板、rubrics、memory 与 workflow 内容
- 可直接执行的 `histwrite` runner 命令行
- 可选的 browser relay（用于登录态页面、快照、标签页）
- 一个薄的 OpenClaw 插件入口

Histwrite 想解决的问题很简单：让 agent 不只是“写一段字”，而是能围绕一个历史写作项目持续工作——从选题、材料整理、项目目录、导出，到最后的格式检查。

## 它现在能做什么

当前公开仓库已经能提供这些能力：

- **项目初始化**：创建 Histwrite 项目目录和标准结构
- **材料索引**：扫描材料目录，生成可检索的索引结果
- **Relay 快照**：从本地 relay 获取浏览器状态和页面快照
- **草稿导出**：把项目草稿汇总导出成 Markdown
- **终稿检查**：对输出文件跑 `finalcheck`
- **改写与评测**：提供 `rewrite`、`judge`、`doctor` 等命令能力
- **内容复用**：任何 agent 都可以直接读取 `content/` 下的模板和规则

## 仓库里有什么

- `content/`：模板、memory、rubrics、风格说明、公开工作流内容
- `runner/`：统一命令层，给 agent 或命令行直接调用
- `relay/`：可选 browser relay 与浏览器扩展
- `plugin-openclaw/`：OpenClaw 插件入口
- `docs/`：接入说明、公开迁移历史、隐私规则
- `scripts/`：隐私扫描和发布前检查脚本

## 快速开始

### 1. 安装依赖

```bash
pnpm install
```

### 2. 查看可用命令

```bash
node runner/bin/histwrite.mjs help
```

### 3. 初始化一个项目

```bash
node runner/bin/histwrite.mjs project init --project ./paper
```

### 4. 查看项目状态

```bash
node runner/bin/histwrite.mjs project status --project ./paper
```

### 5. 索引材料目录

```bash
node runner/bin/histwrite.mjs library index --project ./paper --materials ./paper/材料
```

### 6. 查看 relay 状态

```bash
node runner/bin/histwrite.mjs relay status --relay http://127.0.0.1:18792
```

### 7. 导出草稿

```bash
node runner/bin/histwrite.mjs project export --project ./paper
```

## 当前 runner 命令面

现在已经公开可用的命令包括：

- `project init|status|export`
- `library index|status`
- `capture`
- `relay status`
- `export`
- `finalcheck`
- `rewrite`
- `judge`
- `proxy`
- `episodes append`
- `doctor`

后续会继续把更多 Histwrite 命令往 runner 下沉。

## 怎么用在 OpenClaw 里

如果你是 OpenClaw 用户，这个仓库可以作为插件入口来使用。

插件层本身尽量保持很薄，只做这几件事：

- 接收自然语言或工具调用
- 解析默认项目目录与参数
- 把请求转发给 `histwrite` runner
- 返回结构化结果

相关文件：

- `plugin-openclaw/openclaw.plugin.json`
- `plugin-openclaw/index.ts`
- `docs/for-openclaw.md`

## 怎么给别的 Agent 用

如果宿主支持读取仓库内容，那么它至少可以直接使用：

- `content/templates/`
- `content/templates/learn/memory/`
- `content/templates/learn/rubrics/`

如果宿主还支持 shell 或 tool 调用，那么它可以直接执行：

```bash
node runner/bin/histwrite.mjs help
```

说明见：

- `docs/for-agents.md`

## 这个公开仓库**不包含**什么

为了保证公开版本可安全发布，这个仓库不会包含：

- 你的私人材料、文章全文、下载归档、研究目录
- 私人邮箱、用户名、绝对路径
- 学校图书馆代理入口、浏览器会话、cookie、token、API key
- 原始私有仓库的 Git 对象历史

这个仓库保留的是**公开可复用的能力**，不是你个人的研究资料库。

## 隐私与公开历史

如果你关心这个仓库是如何从私有工作区拆出来的，可以看：

- `docs/privacy.md`
- `docs/history/upstream-timeline.md`
- `docs/history/upstream-working-tree.md`

## 当前状态

Histwrite 现在已经是一个可公开发布、可安装、可继续演化的小仓库：

- 可以当作内容仓库来读
- 可以当作 runner 工具来跑
- 可以接 OpenClaw
- 可以按需启用 relay

接下来最重要的工作，是继续把更多原始 Histwrite 命令整理进 runner，并把 OpenClaw 入口做得更顺手。
