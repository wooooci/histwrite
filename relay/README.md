# Codex Browser Relay

把 **已登录态的主力 Chrome 标签页** 挂接到本机的 CDP Relay 上，让 Codex/脚本能通过 CDP 控制该标签页（不新开浏览器）。

## 组成

- `relay/index.ts`：本机 Relay Server（HTTP + WS）
- `relay/extension/`：Chrome 扩展（负责 attach/detach 当前 tab，并转发 CDP）

## 启动 Relay Server

```bash
node --import tsx relay/index.ts --port 18992
```

健康检查：

```bash
curl -fsS -I http://127.0.0.1:18992/
curl -fsS http://127.0.0.1:18992/extension/status
```

## 安装 Chrome 扩展（Load unpacked）

1. 打开 `chrome://extensions`，开启开发者模式
2. `Load unpacked` 选择目录：`relay/extension`
3. 在目标标签页点击扩展图标让 badge 变成 `ON`（Attach）

## 重要端点

- `GET /extension/status`：`{ connected: boolean }`
- `GET /tabs`：已 attach 的 tab 列表（包含 `sessionId/targetId/title/url`）
- `GET /snapshot`：抓取当前（或指定 `targetId`）tab 的截图+文本（JSON）
  - 参数：`targetId`、`png=0|1`、`text=0|1`、`maxChars=<n>`
- `GET /history`：查看 relay 审计历史，支持 `runId/client/kind/limit` 过滤
- `POST /history`：写入结构化注记（例如数据库、关键词、字段、命中数）
- CDP 兼容：
  - `GET /json/version`、`GET /json/list`
  - `ws://127.0.0.1:18992/cdp`
  - 可选查询参数：`?runId=<scan-1>&client=<histwrite-jstor>`，后续 CDP 命令会自动记入历史

示例：抓取快照并落到文件

```bash
curl -fsS "http://127.0.0.1:18992/snapshot?png=1&text=1&maxChars=200000" > /tmp/snapshot.json
```

示例：写入一条检索注记

```bash
curl -fsS http://127.0.0.1:18992/history \
  -H 'content-type: application/json' \
  --data-binary @- <<'EOF'
{
  "runId": "scan-1",
  "client": "histwrite-jstor",
  "label": "JSTOR advanced search",
  "note": "首轮检索",
  "data": {
    "site": "JSTOR",
    "query": "\"Walter Lippmann\" AND \"Cold War\"",
    "field": "fulltext",
    "resultCount": 37
  }
}
EOF
```

示例：读取最近的审计历史

```bash
curl -fsS 'http://127.0.0.1:18992/history?runId=scan-1&limit=20'
```
