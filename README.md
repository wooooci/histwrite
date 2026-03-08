# Histwrite

[English](README.en.md) · 简体中文

**Histwrite 是一条面向历史写作项目的工作流。**

它的核心不是“给你几个命令”，也不是“让模型替你一键写完论文”，而是把一篇历史论文从选题、调研、材料沉淀、写作、精修到定稿检查，组织成一条可以持续推进的流程。

这个公开仓库，是 Histwrite 的**公开版底座**。它保留了：

- `content/`：工作流模板、memory、rubrics、风格约束
- `runner/`：已经公开下沉的一部分确定性命令
- `relay/`：可选的浏览器 relay
- `plugin-openclaw/`：OpenClaw 的插件入口

所以阅读这个仓库时，最重要的一点是：

- **Histwrite 本身的完整工作流**，比当前公开版 `runner` 里已经下沉的命令面更完整
- README 必须先讲清楚 Histwrite 的工作流是什么，再讲这个公开仓库当前已经公开了哪些层

---

## 面向历史系学生

### Histwrite 的工作流到底是什么

如果把 Histwrite 说清楚，它并不是“帮你写一段文字”的工具，而是一条历史论文写作流水线。你原本写论文时会经历的几个阶段，它基本都试图覆盖：

1. **澄清意图**  
   先把题目、核心问题、论点、时空范围、分期、关键概念聊清楚，而不是一上来就写正文。

2. **深度调研**  
   不是只搜一轮网页，而是把开放检索、登录态检索、数据库检索这些动作接起来，先把可能的研究路径和材料范围跑出来。

3. **材料沉淀**  
   不是“看过就算”，而是把摘录、材料解释、证据点、缺口、元数据慢慢沉淀下来，形成后续可以真正调用的材料库。

4. **蓝图与大纲**  
   在材料开始累积之后，再去生成蓝图和大纲，把“论证路线”和“章节结构”固定下来，而不是永远停留在材料堆积状态。

5. **分段写作**  
   不追求一次性吐完整篇，而是按大纲一节一节推进，把材料和章节逐步对齐。

6. **精修与定稿检查**  
   草稿不是写完就结束，而是还要经过去 AI 感精修、导出、以及 `finalcheck` 这样的门面检查。

7. **评测、调优与标注闭环**  
   如果你要继续把这套流程打磨成长期可复用的写作系统，还可以继续做评测、prompt 调优和人工标注回流。

一句话说，Histwrite 更像是：

- **先把题目和材料系统化**
- **再按结构推进写作**
- **最后把文风、格式和质量一起收束**

### 这条工作流在 Histwrite 里大概怎么走

按你原来的设计，Histwrite 的真实工作流更接近下面这个顺序。

**1. 先开工作流，澄清题目**

- `/histwrite on`
- `/histwrite <你的题目 / 想法 / 问题>`

这一阶段不是直接写，而是先收敛：

- 核心问题是什么
- 论点大概往哪里走
- 时空范围和分期怎么定
- 关键概念要不要先界定

**2. 做深度调研，而不是只搜一次网页**

- `/histwrite research <主题/关键词>`

这一层的重点是把“研究路径”先打开。按你原来的设计，它不是单一路径搜索，而是两段式检索：

- 先开放检索
- 再进入登录态 / 数据库环境继续查

如果需要，还会先生成检索线索、关键词、gaps 和下一步计划。

**3. 开始找材料，并把材料沉淀下来**

这一层不是简单收藏链接，而是把材料变成后续可调用的工作对象。

常见动作包括：

- `/histwrite sources plan`
- `/histwrite sources open 3`
- `/histwrite material <摘录>`
- `/histwrite interpret ...`
- `/histwrite library ...`
- `/histwrite zotero ...`
- `/histwrite ingest ...`

这里真正重要的是：

- 文献、史料、档案路径怎么找
- 摘录如何沉淀成材料
- 材料怎样被解释、筛选、补元数据
- 下载、OCR、索引、引用模板这些环节怎样接起来

这一步决定了后面写作是不是“有证据的写”，而不是空转。

**4. 用蓝图和大纲把材料组织起来**

- `/histwrite outline generate`
- `/histwrite outline map`
- `/histwrite project sync`

这一层不是随手列几条提纲，而是要回答：

- 你的论证路径到底怎么走
- 现有材料分别落到哪一节
- 哪些地方还有缺口
- 草稿目录要怎么和大纲对应起来

**5. 按大纲逐段写，而不是整篇一口气生成**

- `/histwrite write next`
- `/histwrite write section <id>`
- `/histwrite draft <要求>`

这一阶段更接近“按章节推进的写作流程”：

- 先写下一节
- 再看这一节和整体论证的关系
- 再决定继续补材料、继续写，还是先回头改结构

**6. 最后进入精修、导出和定稿检查**

- `/histwrite polish`
- `/histwrite export`
- `/histwrite finalcheck <path>`

这一步不是单纯“润色一下”，而是要把：

- 文风
- 连贯性
- 去 AI 感
- 引注与格式门面

一起往最后的成稿状态收。

**7. 如果你把它当长期系统来打磨，再继续做评测和调优**

- `/histwrite dataset export`
- `/histwrite eval run`
- `/histwrite tune run`
- `/histwrite label push|pull`
- `/histwrite services up argilla`

这一步不是每个写作者每天都要做，但它解释了 Histwrite 为什么不仅仅是“写作助手”，而是一个会持续进化的工作流。

### 这套流程和你自己的写作法是怎么对应的

你原来的 Histwrite 之所以特别有意思，不是因为命令多，而是因为它本来就在贴着一种很真实的历史写作方法走：

- 先从问题意识和题目萌芽开始
- 先跑学术史和二次研究，知道前人在争什么
- 再去找一次史料和原始材料
- 再把材料和大纲对应起来
- 再按章节一点点写
- 最后不断修订、统一风格、检查体例

所以 Histwrite 更接近的是：

- **先学术史**
- **再史料**
- **再按大纲分段写**
- **再反复修订**

这也是为什么我前面那个 README 写偏了：它把 Histwrite 写成了“仓库里现在有些什么”，而没有先把这条工作流本身说清楚。

### 当前这个公开仓库，已经公开了这条工作流的哪些部分

这里必须说实话。

**完整 Histwrite 工作流** 和 **当前公开仓库已经稳定公开的命令层** 不是一回事。

当前这个公开仓库已经明确公开出来的，是：

- `content/`：模板、memory、rubrics、风格与交接内容
- `runner/`：一部分已经下沉的确定性命令
- `relay/`：浏览器 relay
- `plugin-openclaw/`：OpenClaw 的插件入口

当前公开版 `runner` 已有的命令主要包括：

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

这意味着：

- Histwrite 的**完整工作流设计**已经很清楚
- 但公开仓库里的 **runner 命令面** 还在逐步追上这条完整工作流

如果你是历史系学生，现在最现实的用法是：

- 把它当作一个历史写作项目骨架
- 把它当作一个材料整理、索引、导出、检查工具箱
- 把 `content/` 当作 agent 协作写作时的规则层

而不是把它理解成“已经完整公开的一键全自动论文系统”。

---

## 面向 LLM / Agent

### 先理解完整工作流，再理解公开仓库

如果你是要接入 Histwrite 的 agent，最容易犯的错误就是：

- 先盯着 `runner` 里现在有哪些命令
- 然后把 Histwrite 理解成“一个工具插件”

但真正更准确的理解顺序应该反过来：

1. **先理解 Histwrite 的完整工作流**
2. **再理解当前这个公开仓库公开了工作流中的哪些层**

Histwrite 的完整工作流，至少包含这些阶段：

- 澄清意图
- 深度调研
- 材料沉淀
- interpret / library / zotero / ingest
- 蓝图与大纲
- 分段写作
- polish / export / finalcheck
- eval / tune / label

当前这个仓库公开出来的，则主要是其中四层：

- `content/`
- `runner/`
- `relay/`
- `plugin-openclaw/`

所以对 agent 来说，Histwrite 首先是一个：

- **内容优先的工作流仓库**
- 带固定项目布局的写作项目骨架
- 带部分确定性命令的公开工具层
- 带可选浏览器能力的扩展层

### 你应该优先读取什么

如果宿主没有任何 shell 或 tool 调用能力，仍然可以直接复用 Histwrite 的内容层。

优先读取这些文件：

- `content/templates/style-guide.zh.md`
- `content/templates/eval-rubric.zh.md`
- `content/templates/context-handoff.zh.md`
- `content/templates/learn/memory/`
- `content/templates/learn/rubrics/`

这些内容分别承担：

- 风格约束
- 质量判断标准
- 上下文交接模板
- 默认长期记忆 scaffold
- 默认评估 rubric

如果只读仓库不跑命令，Histwrite 也仍然有一部分价值，因为它已经把“应该怎么写、怎么判断、怎么交接上下文”沉淀成了文件。

### 你应该怎样调用它

如果宿主支持 shell / tool 调用，优先走 `runner`，不要自己猜测 Histwrite 的目录结构和操作顺序。

统一入口：

```bash
node runner/bin/histwrite.mjs help
```

当前公开 runner 中，命令大致可以分成四类。

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

比较合理的调用顺序通常是：

1. `project init`
2. `project status`
3. `library index`
4. 需要登录态浏览器时再接 `relay`
5. `project export` / `export`
6. `finalcheck`

### 你应该怎样理解项目布局

不要自行发明目录名。当前 Histwrite 的项目布局约定至少包括：

- `材料/`
- `蓝图/`
- `大纲/`
- `正文/`
- `导出/`
- `.histwrite/cache`
- `.histwrite/logs`
- `.histwrite/learn`

这意味着：

- 处理材料时默认看 `材料/`
- 处理草稿时默认看 `正文/`
- 查找导出结果时默认看 `导出/`
- 查找运行痕迹时默认看 `.histwrite/logs`
- 放长期记忆与派生规则时优先放 `.histwrite/learn`

### OpenClaw 层应该怎么理解

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

如果以后要做别的宿主适配，优先复用：

- `content/`
- `runner/`
- `relay/`

而不是复制 OpenClaw 插件壳本身。

### Relay 应该怎么理解

`relay/` 是一个**可选增强层**。

只有在这些场景里才需要把它接起来：

- 读取浏览器登录态页面
- 获取标签页列表
- 捕获页面快照
- 从浏览器环境提取上下文

如果宿主根本不需要登录态检索，那么只用：

- `content/`
- `runner/`

就已经够了。

### 你必须遵守的边界

如果你是接入这个仓库的 agent，默认应遵守这些边界：

- 不要把它当成私人材料库
- 不要期待仓库里存在真实账号、cookie、token、API key
- 不要假设原始私有 Git 历史可见
- 不要把还没有公开下沉的能力说成“当前公开版已经稳定可用”
- 不要把 `content/` 里的规范和 rubrics 当成研究材料本身

这个仓库公开出来的是：

- 工作流资产
- 内容层
- 工具层
- 部分宿主接入层

不是私人研究数据，也不是你的私有写作工程原样公开版。

### 对 agent 最实用的一句话总结

如果你要最快接入 Histwrite，最稳的顺序是：

1. 先理解完整工作流
2. 再读 `content/`
3. 再跑 `runner`
4. 需要浏览器登录态时再接 `relay`
5. 宿主是 OpenClaw 时再接 `plugin-openclaw/`

这样理解，才不会把 Histwrite 误读成一个“只有几个命令的仓库”，也不会把还没公开下沉的能力误当成已经全部公开完成的功能。
