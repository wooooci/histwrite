# Histwrite

[English](README.en.md) · 简体中文

**Histwrite 是一个面向历史写作项目的内容仓库 + runner + OpenClaw 插件入口。**

它不是一个“自动替你写完论文”的黑盒，而是把一篇历史写作里最值得沉淀的东西拆成了公开可复用的几层：

- `content/`：写作模板、memory、rubrics、风格与工作流内容
- `runner/`：项目初始化、材料索引、导出、检查等可执行命令
- `relay/`：可选浏览器 relay，用于登录态页面、快照和标签页能力
- `plugin-openclaw/`：OpenClaw 插件入口

如果你是历史系学生，下面的第一部分会告诉你这东西能怎么帮你写论文。  
如果你是 LLM / agent 开发者，下面的第二部分会告诉你应该怎么读取这个仓库、怎么调用命令、怎么理解它的边界。

---

## 面向历史系学生

### Histwrite 对你来说是什么

如果你平时写历史论文的流程大致是这样：

- 确定题目、问题意识和时空范围
- 建一个材料夹，慢慢积累 PDF、笔记、摘录
- 想办法把材料和提纲对应起来
- 一边写一边返工，最后再统一检查格式和脚注

那 Histwrite 想做的，不是替你省掉思考，而是把这条流程整理成一个**更适合持续推进的项目工作台**。

它更像：

- 一个给写作项目用的目录结构
- 一套给 agent 复用的写作规范和记忆文件
- 一组帮你整理材料、导出草稿、做终稿检查的工具

目前这个公开仓库已经比较适合做这些事：

- 建立论文项目目录
- 管理“材料 / 蓝图 / 大纲 / 正文 / 导出”这些文件夹
- 给材料目录建立索引，方便后续检索和导入
- 用浏览器 relay 辅助处理登录态网页和页面快照
- 导出当前草稿
- 在定稿前做一次格式和质量检查

### 你会实际接触到哪些内容

如果你只是“把它当工具用”，最常见会接触到的是三类东西。

**1. 项目目录**

运行 `project init` 后，Histwrite 会帮你建立一个标准项目结构，大致包括：

- `材料/`
- `蓝图/`
- `大纲/`
- `正文/`
- `导出/`
- `.histwrite/`

其中：

- `材料/` 适合放你整理的原始材料、OCR 结果和索引
- `蓝图/` 更适合放核心问题、章节设计、证据地图这类内容
- `大纲/` 放提纲和结构拆分
- `正文/` 放你正在写的草稿
- `导出/` 放最后导出的整合稿

**2. 写作规范和内容模板**

`content/` 下面放的是公开可复用的“内容层”。其中比较值得看的包括：

- `content/templates/style-guide.zh.md`：风格要求
- `content/templates/eval-rubric.zh.md`：评价标准
- `content/templates/context-handoff.zh.md`：上下文交接模板
- `content/templates/learn/memory/`：默认长期记忆 scaffold
- `content/templates/learn/rubrics/`：默认 rubric

如果你在跟 agent 一起写作，这些文件其实就是它“该怎么写、该注意什么、怎么判断质量”的基础说明书。

**3. 可执行命令**

当前公开版里，已经稳定可用的命令主要是：

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

你可以把它们理解成“写作项目管理工具”，而不是“论文自动生成按钮”。

### 一个比较现实的使用方式

如果你是历史系学生，当前公开版最现实的用法大概是：

**第一步：先建项目**

```bash
node runner/bin/histwrite.mjs project init --project ./paper
```

**第二步：把材料放进 `材料/`**

你可以把 PDF、笔记、整理稿、OCR 结果都按自己的习惯放进去。

**第三步：为材料建索引**

```bash
node runner/bin/histwrite.mjs library index --project ./paper --materials ./paper/材料
```

这样后面 agent 或你自己处理材料时，会更容易定位内容。

**第四步：写作过程中持续整理**

- 把结构性思路放到 `蓝图/` 和 `大纲/`
- 把正文写进 `正文/`
- 需要浏览器登录态能力时，再启动 `relay/`

**第五步：导出和检查**

```bash
node runner/bin/histwrite.mjs project export --project ./paper
```

然后对最终输出再跑 `finalcheck`。

### 你不该期待它做什么

为了避免误解，我也想说清楚：

- 它**不是**一个已经完整公开的一键自动写论文系统
- 它**不是**你的私人材料库备份仓库
- 它**不会**在公开仓库里包含你自己搜集的文章全文、下载归档或私人研究记录
- 它**不会**替你完成历史解释、史料判断和学术取舍本身

更准确地说，当前公开版更像一个：

- 适合和 agent 协作的历史写作项目骨架
- 适合持续整理写作流程的工具箱
- 适合未来继续扩展成更完整工作流的公开底座

---

## 面向 LLM / Agent

### 先把这个仓库理解成什么

如果你是一个要接入 Histwrite 的 agent，不要先把它理解成“一个插件”，而要先把它理解成：

- 一个**内容优先**的仓库
- 一个有明确项目目录约定的写作工作流骨架
- 一个逐步扩大的命令层
- 一个可选浏览器能力组件

也就是说，这个仓库当前最稳定的部分不是“自然语言自动化程度”，而是：

- `content/` 里的内容资产
- `runner/` 里的确定性命令
- `project` 布局约定
- `relay` 的可选集成点

### 你应该优先读取什么

如果你要把 Histwrite 当成知识 / 规则源来用，优先读取这些位置：

- `content/templates/style-guide.zh.md`
- `content/templates/eval-rubric.zh.md`
- `content/templates/context-handoff.zh.md`
- `content/templates/learn/memory/`
- `content/templates/learn/rubrics/`

这些文件分别承担：

- 风格约束
- 质量判断标准
- 上下文接力模板
- 默认长期记忆 scaffold
- 默认评估 rubric

如果宿主没有任何命令执行能力，仅仅读这些内容，也已经能复用 Histwrite 的一部分价值。

### 你应该怎样调用它

如果宿主支持 shell / tool 调用，优先走 `runner`，而不是自己猜测目录结构。

统一入口：

```bash
node runner/bin/histwrite.mjs help
```

当前命令可以大致分成四类：

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

对于 agent 来说，比较合理的调用顺序通常是：

1. `project init`
2. `project status`
3. `library index`
4. 视情况接入 `relay`
5. `project export` / `export`
6. `finalcheck`

### 你应该假定怎样的项目布局

不要自己发明目录名，优先遵循 Histwrite 的默认布局。当前 runner 内部约定的项目结构包括：

- `材料/`
- `蓝图/`
- `大纲/`
- `正文/`
- `导出/`
- `.histwrite/cache`
- `.histwrite/logs`
- `.histwrite/learn`

这意味着：

- 如果你要生成材料索引，默认看 `材料/`
- 如果你要读草稿，默认看 `正文/`
- 如果你要找导出结果，默认看 `导出/`
- 如果你要找运行痕迹，默认看 `.histwrite/logs`
- 如果你要放长期记忆或派生规则，优先放 `.histwrite/learn`

### OpenClaw 插件层应该怎么理解

`plugin-openclaw/` 当前应被理解成**薄入口**，不是完整业务层。

它主要负责：

- 接收调用
- 解析默认项目目录
- 把命令转成 runner argv
- 执行本地 runner
- 返回文本结果和结构化细节

对接文件：

- `plugin-openclaw/openclaw.plugin.json`
- `plugin-openclaw/index.ts`
- `plugin-openclaw/src/runtime.ts`

如果你未来要做其他宿主适配，优先复用 `content/ + runner/ + relay/`，而不是复制 OpenClaw 插件层逻辑。

### Relay 应该怎么理解

`relay/` 是一个**可选增强组件**。

只有在你确实需要这些能力时才应该启用它：

- 读取本地浏览器登录态页面
- 获取标签页列表
- 捕获页面快照
- 辅助从浏览器环境提取上下文

如果你的宿主根本不需要浏览器登录态，那么完全可以只用 `content/ + runner/`。

### 你必须遵守的边界

如果你是接入这个仓库的 agent，请默认遵守这些边界：

- 不要把它当成私人材料库
- 不要期待仓库里包含真实账号、cookie、token 或 API key
- 不要假设原始私有 Git 历史可见
- 不要把不存在的自动化能力说成已经公开可用
- 不要把 `content/` 中的规范和 rubrics 当作“引用材料”本身

这个仓库公开出来的，是**工作流资产和工具层**，不是私人研究数据。

### 对 agent 最实用的一句话总结

如果你要最快接入 Histwrite，可以按这个优先级来：

1. 先读 `content/`
2. 再跑 `runner`
3. 需要浏览器登录态时再接 `relay`
4. 如果宿主是 OpenClaw，再接 `plugin-openclaw/`

这样接，最稳，也最符合这个仓库现在的实际形态。
