# Histwrite

[English](README.en.md) · 简体中文

**Histwrite 是一个面向历史写作项目的内容仓库 + runner + OpenClaw 插件入口。**

它并非自动代写论文的黑盒，而是把历史写作中可沉淀、可复用的层次拆开，形成稳定结构：

- `content/`：写作模板、memory、rubrics、风格与工作流内容
- `runner/`：项目初始化、材料索引、导出、检查等可执行命令
- `relay/`：可选浏览器 relay，用于登录态页面、快照和标签页能力
- `plugin-openclaw/`：OpenClaw 插件入口

如果你是历史系学生，下面的第一部分会说明它如何服务论文写作。  
如果你是 LLM / agent 开发者，下面的第二部分说明如何读取仓库、调用命令并把握边界。

---

## 面向历史系学生

### Histwrite 对你来说是什么

如果你的写作流程大致包括：

- 确定题目、问题意识和时空范围
- 建材料夹，逐步积累 PDF、笔记和摘录
- 把材料与提纲对应
- 边写边返工，最终统一检查格式和脚注

Histwrite 的目标不在于替你省掉思考，而是把这条流程整理成更适合持续推进的项目工作台。

它更接近：

- 面向写作项目的目录结构
- 供 agent 复用的写作规范与记忆文件
- 协助整理材料、导出草稿与做终稿检查的工具

目前公开仓库主要支持以下工作：

- 建立论文项目目录
- 管理“材料 / 蓝图 / 大纲 / 正文 / 导出”这些文件夹
- 为材料目录建立索引，便于检索与导入
- 通过浏览器 relay 处理登录态网页与页面快照
- 导出当前草稿
- 定稿前进行格式与质量检查

### 你会实际接触到哪些内容

把它当工具使用时，最常接触的是三类内容。

**1. 项目目录**

运行 `project init` 后，Histwrite 会建立标准项目结构，主要包含：

- `材料/`
- `蓝图/`
- `大纲/`
- `正文/`
- `导出/`
- `.histwrite/`

其中：

- `材料/` 放原始材料、OCR 结果和索引
- `蓝图/` 放核心问题、章节设计与证据地图
- `大纲/` 放提纲与结构拆分
- `正文/` 放写作草稿
- `导出/` 放整合稿

**2. 写作规范和内容模板**

`content/` 是公开可复用的内容层，常用文件包括：

- `content/templates/style-guide.zh.md`：风格要求
- `content/templates/eval-rubric.zh.md`：评价标准
- `content/templates/context-handoff.zh.md`：上下文交接模板
- `content/templates/learn/memory/`：默认长期记忆 scaffold
- `content/templates/learn/rubrics/`：默认 rubric

与 agent 协作时，这些文件就是它应遵循的写作规范与质量判断基础。

**3. 可执行命令**

公开版中稳定可用的命令包括：

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

它们更像写作项目管理工具，而不是论文自动生成按钮。

### 一个比较现实的使用方式

对历史系学生而言，公开版较为现实的用法大致如下。

**第一步：先建项目**

```bash
node runner/bin/histwrite.mjs project init --project ./paper
```

**第二步：把材料放进 `材料/`**

PDF、笔记、整理稿、OCR 结果都可按你的习惯放入。

**第三步：为材料建索引**

```bash
node runner/bin/histwrite.mjs library index --project ./paper --materials ./paper/材料
```

索引建立后，材料检索与调用会更顺畅。

**第四步：写作过程中持续整理**

- 结构性思路放入 `蓝图/` 和 `大纲/`
- 草稿写入 `正文/`
- 需要登录态能力时再启用 `relay/`

**第五步：导出和检查**

```bash
node runner/bin/histwrite.mjs project export --project ./paper
```

随后对输出再运行 `finalcheck`。

### 你不该期待它做什么

为避免误解，需要明确以下边界：

- 它不是一键自动写论文的完整系统
- 它不是私人材料库备份仓库
- 它不会在公开仓库中包含你搜集的文章全文、下载归档或私有研究记录
- 它不会替你完成历史解释、史料判断与学术取舍

更准确地说，当前公开版更接近：

- 适合与 agent 协作的历史写作项目骨架
- 便于持续整理写作流程的工具箱
- 可继续扩展为完整工作流的公开底座

---

## 面向 LLM / Agent

### 先把这个仓库理解成什么

接入 Histwrite 时，不应首先把它理解为插件，而应先把它视为：

- 内容优先的仓库
- 具有明确项目目录约定的写作工作流骨架
- 逐步扩大的命令层
- 可选的浏览器能力组件

因此它最稳定的部分是：

- `content/` 中的内容资产
- `runner/` 中的确定性命令
- `project` 布局约定
- `relay` 的可选集成点

### 你应该优先读取什么

如果把 Histwrite 当作知识与规则源，优先读取：

- `content/templates/style-guide.zh.md`
- `content/templates/eval-rubric.zh.md`
- `content/templates/context-handoff.zh.md`
- `content/templates/learn/memory/`
- `content/templates/learn/rubrics/`

这些内容分别对应：

- 风格约束
- 质量判断标准
- 上下文接力模板
- 默认长期记忆 scaffold
- 默认评估 rubric

即便宿主没有命令执行能力，仅仅读这些内容，也能复用其中一部分价值。

### 你应该怎样调用它

宿主支持 shell / tool 调用时，应优先使用 `runner`，避免自行猜测目录结构。

统一入口：

```bash
node runner/bin/histwrite.mjs help
```

当前命令可归为四类：

**1. 项目结构类**

- `project init`
- `project status`
- `project export`

**2. 材料与索引类**

- `library index`
- `library status`

**3. 浏览器 / relay 类**

- `relay status`
- `capture`
- `proxy`

**4. 输出处理与检查类**

- `export`
- `finalcheck`
- `rewrite`
- `judge`
- `doctor`
- `episodes append`

对 agent 而言，较合理的调用顺序通常是：

1. `project init`
2. `project status`
3. `library index`
4. 视情况接入 `relay`
5. `project export` / `export`
6. `finalcheck`

### 你应该假定怎样的项目布局

不要自行发明目录名，应遵循 Histwrite 的默认布局。runner 内部约定的项目结构包括：

- `材料/`
- `蓝图/`
- `大纲/`
- `正文/`
- `导出/`
- `.histwrite/cache`
- `.histwrite/logs`
- `.histwrite/learn`

这意味着：

- 材料索引默认读取 `材料/`
- 草稿默认读取 `正文/`
- 导出结果默认在 `导出/`
- 运行痕迹在 `.histwrite/logs`
- 长期记忆或派生规则优先放在 `.histwrite/learn`

### OpenClaw 插件层应该怎么理解

`plugin-openclaw/` 应被理解为薄入口，而非完整业务层。

它主要承担：

- 接收调用
- 解析默认项目目录
- 把命令转成 runner argv
- 执行本地 runner
- 返回文本结果与结构化细节

对接文件包括：

- `plugin-openclaw/openclaw.plugin.json`
- `plugin-openclaw/index.ts`
- `plugin-openclaw/src/runtime.ts`

若要适配其他宿主，应优先复用 `content/ + runner/ + relay/`，而不是复制 OpenClaw 插件层逻辑。

### Relay 应该怎么理解

`relay/` 是可选增强组件。

仅在确实需要以下能力时启用：

- 读取本地浏览器登录态页面
- 获取标签页列表
- 捕获页面快照
- 辅助从浏览器环境提取上下文

若宿主不需要登录态能力，可只用 `content/ + runner/`。

### 你必须遵守的边界

接入该仓库的 agent 应默认遵守以下边界：

- 不将其当作私人材料库
- 不期待仓库包含真实账号、cookie、token 或 API key
- 不假设原始私有 Git 历史可见
- 不把不存在的自动化能力说成已公开可用
- 不把 `content/` 中的规范和 rubrics 当作引用材料本身

公开仓库提供的是工作流资产与工具层，而非私人研究数据。

### 对 agent 最实用的一句话总结

最快的接入顺序如下：

1. 先读 `content/`
2. 再跑 `runner`
3. 需要浏览器登录态时再接 `relay`
4. 若宿主是 OpenClaw，再接 `plugin-openclaw/`

这一顺序最稳，也更符合仓库当前形态。
