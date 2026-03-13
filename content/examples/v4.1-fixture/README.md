# v4.1 回归样本工程

这是一套给 Histwrite v4.1 工作流使用的公开回归样本：

- 主题：1902年前后地方财政调整的启动逻辑
- 规模：6 条材料，1 节目标文本
- 目标长度：500–900 字
- 预期门禁：FactCheck.blockers=0，Chronology.blockers=0，Finalcheck.placeholderCount=0

## 目录

- `project/`：可直接复制到临时目录里的样本工程输入
- `bundle/`：golden 输出，包含 `Final.md`、reports、runlog 与关键 artifacts
- `fixture.manifest.json`：后续 e2e / prompt 回归读取的元数据

## 推荐用法

1. 复制 `project/` 到临时工作目录。
2. 用固定 mock LLM 或固定候选输出驱动 pipeline。
3. 将产出的 `Final.md`、reports、runlog 与 `bundle/` 对比。

这套样本故意保持很小，但保留了材料文本、selectors、QA、claims、gate reports 与 artifact heads，便于做可回放回归。
