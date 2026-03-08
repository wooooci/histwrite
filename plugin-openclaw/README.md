# Histwrite OpenClaw Plugin

这是 Histwrite 的 **OpenClaw 薄适配层**。

目标是：

- 把自然语言请求转换为 `histwrite` runner 命令
- 尽量不在插件层堆业务逻辑
- 让核心能力统一沉到 `runner/` 与 `content/`

当前阶段这个适配层已经完成：

- 公开安全的插件清单
- 基础包结构
- 后续将逐步把命令调度接到 `runner/bin/histwrite.mjs`
