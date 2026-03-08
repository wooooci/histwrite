# Histwrite 长期记忆（本项目）

本目录用于沉淀 **Histwrite 写作工作流的长期约束**：写作风格、学术规范、史论结合方法、工作流纪律、回归检查清单与调优闭环。

本项目默认取向：**不省 token，优先效率=一次到位的可提交质量**（允许多轮候选与自检，但每轮必须有明确的主攻问题与验收标准）。

## 分层原则（先论证、后形态）

- 起草阶段提示词要**短且正向**：先把“论证链条”写稳。  
- 形态学去 AI（1/2/3/4/6）只在**精修/回归**阶段当“卡口子”执行，避免诱发碎句化与平铺化。

## 文件约定（按编号累加）

- `histwrite-00-memory.zh.md`：写作宪法（生成阶段 / 短提示词优先）
- `histwrite-01-style-profile.zh.md`：你的用语习惯画像（基于红/蓝标注与批注）
- `histwrite-10-workflow.zh.md`：完整工作流（对齐你的写作方法）
- `histwrite-20-materials-and-citations.zh.md`：材料入库/OCR/元数据与引注清洗（门面工程）
- `histwrite-21-outline-and-drafting.zh.md`：大纲→材料分配→连贯写作纪律
- `histwrite-30-eval-and-tuning.zh.md`：评测/标注/调优闭环（持续学习）
- `histwrite-40-deai-polish-playbook.zh.md`：去 AI 精修手册（只在 polish/eval 阶段启用）
- `histwrite-90-constraints-history.zh.md`：约束变更与历史备忘（不进入起草提示词）

> 说明：`histwrite-00-memory.compact.zh.md` 仅用于第三方接口“请求体积/时延”过紧时的降级运行；默认不应进入写作提示词。

## 本项目当前去 AI 回归硬门槛（优先级）

- 仅优先回归 1/2/3/4/6：连接词骨架句、句式模板复用、冒号块、并列名词串、被字句模板（其余为次要项）。

## Rubrics（用于 judge）

- `../rubrics/deai-flow.zh.md`
- `../rubrics/draft-quality.zh.md`

## 定稿门面（必须落地）

- 起草/精修完成，不代表可以交稿；定稿前必须额外过一轮 `finalcheck`。
- 本项目默认门面标准：占位符 = 0、本地路径 = 0、脚注定义与使用一一对应、《历史研究》体例错误清零；能做到时，报告以 `错误 / 警告：0 / 0` 为目标。
- judge 与 `finalcheck` 分工不同：judge 看论证与文风，`finalcheck` 看引注体例与门面硬伤；不要用一个环节替代另一个。
