# Histwrite 公开版上游演化时间线

> 说明：本文件用于保留 Histwrite 的**设计与改动脉络**，但不公开原私有仓库的作者邮箱、私有路径或完整 Git 对象历史。

## 2026-02-10：工作流雏形与基础能力

- `e02397264`：加入写作工作流扩展
- `a25718150`：加入本地材料库（OCR 索引 / 检索 / 导入）
- `ff8bcc179`：加入项目初始化 / 同步 / 导出
- `264abff63`：加入按大纲分配材料能力
- `a2471c54e`：加入 `sources / outline / write` 主流程
- `e892ce815`：接入 Zotero Connector 抓取
- `baedab692`：加入下载 + OCR 管线

## 2026-02-10：评测、调优与服务编排

- `8f733e4c4`：加入 services orchestration
- `7fd10243f`：加入 promptfoo eval runner
- `ab80f57a5`：加入 DSPy + Promptflow 调优 MVP
- `85323e2f8`：加入 Argilla 标注闭环

## 2026-02-13：runner 与 relay 基础设施

- `8d39e03e5`：加入 Codex browser relay skeleton
- `417cab2c8`：fork 浏览器扩展 relay
- `d036a1c26`：runner 加入 init / index / cache
- `32b8d5d4e`：runner 加入 JSONL 运行日志

## 2026-02-17 至 2026-02-18：runner 增强

- `94e7cfd7a`：runner 加入 `.env` 加载与 rewrite
- `0125b7270`：runner 支持通过环境变量配置 timeout
- `1fdfd4be6`：runner 支持从目录加载 memory pack
- `7fd27375f`：runner 强化重试与网络兼容性

## 2026-03-06 至 2026-03-07：自然路由与复核流程

- `5cd2d1f15`：browser relay 加入 history audit endpoints
- `a0f02b6bd`：加入下载复核来源工作流
- `8fe9b7df1`：加入自然复核路由
- `d294ec184`：加入 evidence packs 自动分配
- `ea9e59dc9`：加入自然写作与 gaps 路由
- `11feea2c8`：加入链式自然路由
- `6913a37f6`：强化 packs 与 final check

## 公开版策略

公开仓库会在保留以上演化脉络的前提下：

- 重建一条**干净的公开 Git 历史**
- 统一目录结构为 `content / runner / relay / plugin-openclaw`
- 把 OpenClaw 插件入口变成薄壳
- 把 runner 提升为主命令接口

