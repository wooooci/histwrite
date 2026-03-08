# Histwrite Runner（统一命令层）

一组 **纯确定性** 的本地命令：建项目结构、材料索引、浏览器证据快照入库、草稿导出合并。

> 设计目标：可重复运行、可落盘、便于 Codex skill 编排；不在 runner 内部直接调用大模型。

## 运行方式

```bash
node --import tsx runner/src/cli.ts <command> ...
```

## 命令

### `init`

初始化项目目录结构（中文目录）：

```bash
node --import tsx runner/src/cli.ts init --project "<项目目录>"
```

会创建：`材料/`、`蓝图/`、`大纲/`、`正文/`、`导出/`、`.histwrite/{cache,logs}` 等。

### `index`

对材料目录做索引与（部分格式）文本抽取，并输出 `蓝图/library_index.md`：

```bash
node --import tsx runner/src/cli.ts index --project "<项目目录>" --materials "<材料目录>"
```

目前支持抽取：`txt/md/docx`；`pdf` 暂不抽取正文（只入库元信息）。

### `capture`

调用本机 Browser Relay 的 `/snapshot`，把当前 tab 的截图/文本落盘到项目里（默认 `材料/_index/snapshots/`）：

```bash
node --import tsx runner/src/cli.ts capture --project "<项目目录>" --relay "http://127.0.0.1:18792"
```

可选参数：
- `--targetId <id>`：指定抓取的 tab
- `--no-png` / `--no-text`
- `--maxChars <n>`
- `--outDir <dir>`

### `export`

稳定合并 `正文/*.md` 到 `导出/draft.md`（默认标题：`草稿汇总`）：

```bash
node --import tsx runner/src/cli.ts export --project "<项目目录>"
```

可选参数：
- `--draft <dir>`：默认 `正文/`
- `--out <path>`：默认 `导出/draft.md`
- `--title <text>`

### `judge`

对一个候选目录（Best-of-K）做 LLM-as-a-judge 排序打分，并把结果落盘：

- judge 结果：`<项目目录>/.histwrite/learn/judges/<runId>.json`
- episodes：`<项目目录>/.histwrite/learn/episodes/episodes.jsonl`

OpenAI-compatible（含第三方供应商）配置方式：

```bash
export OPENAI_BASE_URL="https://<你的供应商域名>"   # 或已包含 /v1
export OPENAI_API_KEY="<你的key>"
export HISTWRITE_JUDGE_MODEL="<模型id>"
export HISTWRITE_TIMEOUT_MS="180000"               # 可选：第三方慢时调大（默认 60000）
```

也可以把上述环境变量写进 `<项目目录>/.env`（runner 会自动读取；`.env` 已在仓库 `.gitignore` 里，不会被提交）。

也可以直接复用你的 OpenCode 配置（`~/.config/opencode/opencode.json`）：

- `model`：形如 `<provider>/<model>`（例如 `codex-for-me/gpt-5.2-codex`）
- `provider.<name>.options.baseURL`
- `provider.<name>.options.apiKey`

运行（用默认 model/provider）：

```bash
node --import tsx runner/src/cli.ts judge \
  --project "<项目目录>" \
  --candidatesDir "<候选目录>" \
  --opencode \
  --endpoint responses
```

或指定 OpenCode 的 model ref：

```bash
node --import tsx runner/src/cli.ts judge \
  --project "<项目目录>" \
  --candidatesDir "<候选目录>" \
  --opencodeModel "codex-for-me/gpt-5.2-codex" \
  --endpoint responses
```

运行：

```bash
node --import tsx runner/src/cli.ts judge \
  --project "<项目目录>" \
  --candidatesDir "<候选目录>" \
  --model "$HISTWRITE_JUDGE_MODEL"
```

常用可选参数：
- `--rubric <path>`：自定义 rubric（默认尝试读取 `content/templates/eval-rubric.zh.md`）
- `--minPassScore <n>`：默认 `0.6`
- `--endpoint auto|chat|responses`：默认 `auto`（优先 chat.completions）
- `--timeoutMs <n>`、`--maxTokens <n>`
- `--no-cache`：禁用 `.histwrite/cache/judge/*` 命中

### `rewrite`

用 OpenAI-compatible 模型把一份 Markdown 全文按“长期记忆 + 去 AI 感约束”做一次重写（不新增事实/引文，只改写表达与组织方式），并带磁盘缓存：

```bash
node --import tsx runner/src/cli.ts rewrite \
  --project "<项目目录>" \
  --in "<输入.md>" \
  --out "<输出.md>"
```

默认会尝试读取（若存在）：

- `<项目目录>/.histwrite/learn/memory/` 目录下的 `histwrite-*.md`（按文件名排序拼接；默认排除包含 `.compact.` 的文件）

模型配置方式同 `judge`（OpenAI-compatible 或 `--opencode`），并可用：

- `HISTWRITE_WRITE_MODEL`（优先于 `OPENAI_MODEL`）
- `HISTWRITE_TIMEOUT_MS`（可选：超时，毫秒；默认 `60000`）

### `episodes append`

把一次“best-of-k / judge”的决策结果追加到项目的 episodes 里（JSONL）：

```bash
cat <<'EOF' | node --import tsx runner/src/cli.ts episodes append --project "<项目目录>"
{"version":1,"kind":"write_best_of_k","at":1739577600000,"section":{"id":"s1","title":"第一节"},"k":3,"chosenId":"c2","ranked":[{"id":"c2","score":0.83,"pass":true,"reason":"..."}],"candidates":[{"id":"c1","path":"正文/_candidates/.../c1.md"},{"id":"c2","path":"正文/_candidates/.../c2.md"}]}
EOF
```

输出位置：`<项目目录>/.histwrite/learn/episodes/episodes.jsonl`

### `proxy`

给 **Responses-only（SSE）** 的第三方 OpenAI-compatible 供应商做一个本机兼容桥：

- 对外提供：`/v1/chat/completions`（供 promptfoo / DSPy / promptflow 这类默认走 chat.completions 的工具使用）
- 对内转发：`/v1/responses`（并解析 `text/event-stream`）

启动（推荐复用你的 OpenCode 配置）：

```bash
node --import tsx runner/src/cli.ts proxy \
  --opencode \
  --forceModel \
  --listen 127.0.0.1 \
  --port 18795
```

然后让工具指向本机代理（注意要带 `/v1`）：

```bash
export OPENAI_BASE_URL="http://127.0.0.1:18795/v1"
export OPENAI_API_KEY="local"
```

说明：
- 默认会把请求的 `model` 透传到上游；若上游拒绝该 model，会回退到 `--model`/OpenCode 默认模型。
- `--forceModel` 会忽略工具请求里的 model，强制使用 OpenCode/`--model` 指定的模型（最省心）。
- 可选：加 `--cacheDir <dir>` 启用磁盘缓存（按“上游 baseURL + model + messages + temperature + max_tokens”去重），适合 promptfoo/DSPy/Promptflow 重复回归。


### `finalcheck`

按《历史研究》体例对 Markdown 草稿做门面检查，并写出 `report.md` 与 `report.json`：

```bash
node --import tsx runner/src/cli.ts finalcheck --project "<项目目录>" --file "<草稿路径>"
```
