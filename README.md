# Histwrite

[English](README.en.md) · 简体中文

Histwrite 用来组织一篇历史论文的工作。

它关心的事情很具体：

- 题目怎么收敛
- 学术史怎么先跑出来
- 一手材料怎么继续找
- 摘录怎么入库
- 提纲怎么落稳
- 正文怎么分段写
- 成稿怎么精修、导出、检查

这个仓库是 Histwrite 的公开版底座。现在公开出来的内容有四层：

- `content/`
- `runner/`
- `relay/`
- `plugin-openclaw/`

看这个仓库，先看工作流。再看命令。顺序不要反。

---

## 面向历史系学生

### Histwrite 的工作流是什么

Histwrite 处理的是一整条写作流程。

第一步，先把题目说清楚。

你要先收敛这些东西：

- 核心问题
- 主要论点
- 时空范围
- 分期
- 关键概念

这一步很重要。题目没定稳，后面材料越多越乱。

第二步，先跑学术史。

这一步要先知道：

- 前人在讨论什么
- 争论点在哪里
- 哪些解释已经很成熟
- 哪些地方还有空位

Histwrite 里这一层主要对应：

- `/histwrite research <主题/关键词>`
- `/histwrite sources plan`
- `/histwrite sources open 3`

第三步，再继续找一手材料和原始证据。

这一层不只是搜链接。重点是把材料变成后面能用的东西。

常见动作包括：

- `/histwrite material <摘录>`
- `/histwrite interpret ...`
- `/histwrite library ...`
- `/histwrite zotero ...`
- `/histwrite ingest ...`

你可以把这一层理解成“材料沉淀”。

要做的事情包括：

- 摘录
- 解读
- 补元数据
- OCR
- 索引
- 引用信息整理

第四步，做蓝图和大纲。

到了这里，重点变成两个问题：

- 现有材料分别支持哪一节
- 整篇文章到底按什么顺序推进

这一层主要对应：

- `/histwrite outline generate`
- `/histwrite outline map`
- `/histwrite project sync`

第五步，按大纲分段写。

Histwrite 的思路一直都不是整篇一口气吐出来。

它更接近这种做法：

- 先写下一节
- 再看这一节和总论证的关系
- 再决定继续写、补材料，还是回头改结构

这一层主要对应：

- `/histwrite write next`
- `/histwrite write section <id>`
- `/histwrite draft <要求>`

第六步，精修、导出、检查。

这一层主要对应：

- `/histwrite polish`
- `/histwrite export`
- `/histwrite finalcheck <path>`

这里收尾的事情有几类：

- 文风统一
- 去 AI 痕迹
- 全文连贯
- 体例和门面检查

第七步，如果你把它当长期系统来养，再做评测和调优。

这一层主要对应：

- `/histwrite dataset export`
- `/histwrite eval run`
- `/histwrite tune run`
- `/histwrite label push|pull`

这一步不是每篇论文都要天天跑。

它的作用是让这条工作流慢慢变得更稳。

### 这条流程和你平时写论文的方式怎么对应

Histwrite 最贴近的一种写法就是：

1. 先从题目和问题意识起步
2. 先把学术史跑出来
3. 再去找一手材料
4. 再把材料和提纲对上
5. 再按章节一点点写
6. 最后反复修订，统一风格，检查体例

你可以把它压缩成一句话：

- 先学术史
- 再史料
- 再按大纲分段写
- 再反复修订

这就是 Histwrite 最核心的工作流感觉。

### 当前这个公开仓库已经公开了什么

这里要分清两件事。

第一件事是 Histwrite 的完整工作流。  
第二件事是当前公开仓库里已经公开下沉的能力。

完整工作流更大。公开仓库当前公开出来的层有：

- `content/` 里的模板、memory、rubrics、风格文件
- `runner/` 里的部分确定性命令
- `relay/` 里的浏览器能力
- `plugin-openclaw/` 这个 OpenClaw 入口

当前公开版 `runner` 里已经有的命令主要是：

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

所以现在最现实的理解方式是：

- 工作流本身已经很完整
- 公开仓库里的命令层还在继续补

### 现在拿它来做什么最合适

如果你是历史系学生，当前公开版最适合做这些事：

- 建一个论文项目目录
- 把材料、蓝图、大纲、正文分开整理
- 给材料建立索引
- 让 agent 读取规则文件一起工作
- 导出草稿
- 在定稿前做一次 `finalcheck`

一个很实在的起步方式是：

```bash
node runner/bin/histwrite.mjs project init --project ./paper
node runner/bin/histwrite.mjs library index --project ./paper --materials ./paper/材料
node runner/bin/histwrite.mjs project export --project ./paper
```

### 这个公开仓库里没有什么

这个仓库里没有你的私人研究资料。

它不会包含：

- 你自己收集的文章全文
- 私人下载归档
- 私人研究目录
- 私人账号信息
- cookie、token、API key

这里公开的是工作流、规则和工具层。

这里公开的不是你的私人材料库。

---

## 面向 LLM / Agent

### 先理解工作流，再理解仓库

如果你要接入 Histwrite，先别盯着 `runner` 里的命令表。

先理解它的完整工作流：

- 澄清意图
- 深度调研
- 材料沉淀
- interpret / library / zotero / ingest
- 蓝图与大纲
- 分段写作
- polish / export / finalcheck
- eval / tune / label

理解完这一层，再回来看这个公开仓库里已经公开了什么。

当前公开仓库主要公开了四层：

- `content/`
- `runner/`
- `relay/`
- `plugin-openclaw/`

所以 Histwrite 对 agent 来说，首先是一个工作流仓库。

然后才是一个工具仓库。

### 你应该先读什么

如果宿主没有 shell 或 tool 调用能力，先读内容层。

优先读取：

- `content/templates/style-guide.zh.md`
- `content/templates/eval-rubric.zh.md`
- `content/templates/context-handoff.zh.md`
- `content/templates/learn/memory/`
- `content/templates/learn/rubrics/`

这些文件分别负责：

- 风格约束
- 质量判断
- 上下文交接
- 默认长期记忆
- 默认评估标准

只读这些文件，也已经能拿到 Histwrite 的一部分核心价值。

### 你应该怎么调用它

如果宿主支持 shell 或 tool 调用，优先走 `runner`。

统一入口：

```bash
node runner/bin/histwrite.mjs help
```

当前公开版里的命令，大致可以分成四组。

**项目结构**

- `project init`
- `project status`
- `project export`

**材料与索引**

- `library index`
- `library status`

**浏览器与 relay**

- `relay status`
- `capture`
- `proxy`

**输出处理与检查**

- `export`
- `finalcheck`
- `rewrite`
- `judge`
- `doctor`
- `episodes append`

一个比较稳的调用顺序是：

1. `project init`
2. `project status`
3. `library index`
4. 需要登录态浏览器时再接 `relay`
5. `project export` 或 `export`
6. `finalcheck`

### 你应该假定什么项目布局

不要自己发明目录名。

Histwrite 当前的默认布局里，至少包括这些位置：

- `材料/`
- `蓝图/`
- `大纲/`
- `正文/`
- `导出/`
- `.histwrite/cache`
- `.histwrite/logs`
- `.histwrite/learn`

这意味着：

- 材料默认在 `材料/`
- 草稿默认在 `正文/`
- 导出结果默认在 `导出/`
- 运行痕迹默认在 `.histwrite/logs`
- 长期记忆和派生规则优先放 `.histwrite/learn`

### OpenClaw 这一层怎么理解

`plugin-openclaw/` 当前就是一个薄入口。

它负责这些事：

- 接收调用
- 解析默认项目目录
- 把命令转成 runner argv
- 执行本地 runner
- 返回文本结果和结构化细节

相关文件：

- `plugin-openclaw/openclaw.plugin.json`
- `plugin-openclaw/index.ts`
- `plugin-openclaw/src/runtime.ts`

以后如果要适配别的宿主，优先复用：

- `content/`
- `runner/`
- `relay/`

不要先去复制 OpenClaw 的壳。

### Relay 这一层怎么理解

`relay/` 是可选增强层。

在这些场景里再用它：

- 需要浏览器登录态
- 需要标签页列表
- 需要页面快照
- 需要从浏览器环境提取上下文

如果宿主根本不需要登录态网页能力，只用 `content/` 加 `runner/` 就够了。

### 你必须守住哪些边界

如果你是接入这个仓库的 agent，默认要守住这些边界：

- 不把它当私人材料库
- 不期待真实账号、cookie、token、API key 存在于仓库中
- 不假设原始私有 Git 历史可见
- 不把还没公开下沉的能力说成当前公开版已经稳定可用
- 不把 `content/` 里的规则文件当成研究材料本身

这个仓库公开出来的是：

- 工作流资产
- 内容层
- 工具层
- 一部分宿主接入层

它公开出来的不是私人研究数据。

### 给 agent 的最短总结

最稳的接入顺序就是：

1. 先理解完整工作流
2. 再读 `content/`
3. 再跑 `runner`
4. 需要浏览器登录态时再接 `relay`
5. 宿主是 OpenClaw 时再接 `plugin-openclaw/`

按这个顺序接，不容易把 Histwrite误读成一个只有若干命令的小仓库，也不容易把未公开完成的能力误当成已经全部上线的公开功能。
