# Histwrite

Histwrite 是一个**内容优先**的历史写作工作流仓库：

- 可以作为 **OpenClaw 插件**使用
- 可以被其他 agent 直接读取其中的模板、规范与工作流内容
- 可以通过 **runner** 执行确定性命令
- 可以按需启用 **browser relay** 做登录态网页检索与快照

## 仓库定位

这个仓库优先服务两类使用方式：

1. **读内容**：直接读取 `content/` 中的模板、memory、rubrics、示例与工作流说明
2. **跑命令**：通过 `histwrite` runner 执行项目初始化、材料索引、导出、校验、快照等动作

OpenClaw 是第一入口，但不是唯一入口。

## 顶层结构

- `content/`：公开模板、长期记忆、rubrics、风格说明、示例
- `runner/`：统一命令层，面向 agent/CLI 的确定性能力
- `relay/`：可选 browser relay 与浏览器扩展
- `plugin-openclaw/`：OpenClaw 插件壳
- `docs/`：公开文档、迁移历史、隐私规范、实施计划
- `scripts/`：隐私扫描与发布前检查脚本

## 隐私原则

这个仓库以“**绝不公开私人信息**”为最高优先级：

- 不包含个人邮箱、私人用户名、绝对路径、学校图书馆定制入口
- 不包含 cookie、token、API key、浏览器会话、私有日志
- 不保留原始私有仓库 Git 历史对象；公开历史以重建的安全提交链为准
- 不包含你私人收集的材料、文章全文、下载归档或研究项目目录

详见 `docs/privacy.md`。

## 迁移历史

这个公开仓库来自对内部 Histwrite 工作的**脱敏重组**。为保留设计与演化脉络，同时避免泄露私人信息，原始提交历史不会直接公开，而是用公开版时间线说明保留阶段性记录。

详见 `docs/history/upstream-timeline.md`。

