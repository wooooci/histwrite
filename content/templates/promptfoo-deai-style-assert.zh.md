# promptfoo 回归断言（去 AI 感：句法形态守护）

用途：把你最在意的“去 AI 感”形态问题做成**可回归**的离线断言，用于：

- `/histwrite eval run`（promptfoo 回归 / A-B）
- 作为 `llm-rubric` 之外的“硬约束补丁”（更稳定、无需额外 judge token）

> 这份守护 **只看句法/标点/模板形态**，不判断史实、论证质量与史料使用是否正确；它应当与 `llm-rubric` 并行使用。

---

## 断言范围（只覆盖 1/2/3/4/6）

这份守护只关注你明确说“重视”的五项：

1) 连接词同构骨架（`, + 单字连词`）  
2) 句式模板重复（当…时/越…越/既…也/不是…而是/并非…而是/…，并…/…，也…/…，却…）  
3) “概括 + 冒号 + 解释块”  
4) 并列名词串（`X、Y与Z`）  
6) 被动句/被字句模板（含“被”的句子占比 + 单句“被”重复）

---

## 默认阈值（用于“段落输出 500–900 字”）

> 默认阈值写在 `extensions/histwrite/src/promptfoo-deai-style-assert-cjs.ts`，并会在 `/histwrite eval run` 生成的 `promptfooconfig.yaml` 里作为 `config` 传入。

| 维度 | 指标 | 默认上限 |
|---|---|---:|
| 1 | 连接词同构骨架句占比（句内出现 `，并/，而/，但/，却/，也/，则`） | `0.25` |
| 2 | `当…时` | `1` |
| 2 | `…，并…` | `3` |
| 2 | `…，也…` | `3` |
| 2 | `…，却…` | `2` |
| 2 | `越…越` | `1` |
| 2 | `既…也` | `1` |
| 2 | `不是…而是` | `1` |
| 2 | `并非…而是` | `1` |
| 3 | 冒号解释块（同一句：`：` 后出现 `；` 或 `？` 的分段符号 >=2） | `0` |
| 4 | `X、Y与Z`（正则：`、[^，。；\\n]{1,15}与`） | `1` |
| 6 | 含“被”的句子占比 | `0.15` |
| 6 | 单句“被”重复（同一句 `被` >=2 的句子数） | `0` |

---

## promptfoo 接入方式（由 /histwrite 自动生成）

`/histwrite eval run` 会在评测目录写入：

- `promptfooconfig.yaml`
- `histwrite_deai_style_assert.cjs`（本断言脚本）

并在 `defaultTest.assert` 中追加：

```yaml
defaultTest:
  assert:
    - type: llm-rubric
      value: |
        ...
      threshold: 0.7
    - type: javascript
      value: file://histwrite_deai_style_assert.cjs
      config:
        maxSkeletonSentenceRatio: 0.25
        ...
```

---

## 输出解释

该断言会返回：

- `pass/score/reason`
- `componentResults`（逐维度可读的失败原因与计数）
- `metadata`（原始计数、句子数、字符数、阈值）

用于在 promptfoo 报告里快速定位“是哪一类模板形态在拉低线性读感”。  

