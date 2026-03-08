# 给 OpenClaw 的接入说明

推荐把 Histwrite 当作：

- 一个内容仓库
- 一个统一 runner
- 一个可选 relay
- 一个薄插件入口

其中插件层只负责：

- 接收用户命令
- 解析参数与默认项目目录
- 调用 `histwrite` runner
- 返回结构化结果
