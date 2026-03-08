# 上游未提交改动记录（提取时快照）

> 说明：在提取公开仓库当天，上游工作区存在一批与 Histwrite 相关、**已暂存但未提交**的改动。这里保留其公开安全说明，作为演化记录的一部分。

## 已吸收进公开仓库的无隐私改动

以下内容在提取时已处于上游 Git index 中，并已作为公开内容层的一部分吸收：

- `extensions/histwrite/README.md`
- `extensions/histwrite/templates/eval-rubric.zh.md`
- `extensions/histwrite/templates/style-guide.zh.md`
- `extensions/histwrite/templates/learn/memory/README.md`
- `extensions/histwrite/templates/learn/memory/histwrite-00-memory.compact.zh.md`
- `extensions/histwrite/templates/learn/memory/histwrite-00-memory.zh.md`
- `extensions/histwrite/templates/learn/memory/histwrite-01-style-profile.zh.md`
- `extensions/histwrite/templates/learn/memory/histwrite-10-workflow.zh.md`
- `extensions/histwrite/templates/learn/memory/histwrite-20-materials-and-citations.zh.md`
- `extensions/histwrite/templates/learn/memory/histwrite-21-outline-and-drafting.zh.md`
- `extensions/histwrite/templates/learn/memory/histwrite-30-eval-and-tuning.zh.md`
- `extensions/histwrite/templates/learn/memory/histwrite-40-deai-polish-playbook.zh.md`
- `extensions/histwrite/templates/learn/memory/histwrite-90-constraints-history.zh.md`
- `extensions/histwrite/templates/learn/rubrics/deai-flow.zh.md`
- `extensions/histwrite/templates/learn/rubrics/draft-quality.zh.md`

## 明确排除的内容

以下内容虽然在上游 index 中出现，但由于含有私人本机路径引用，**不直接进入公开仓库**：

- `extensions/histwrite/skills/histwrite/SKILL.md`

其公开仓库中的对应说明会重写为通用路径与通用工作流描述，不保留任何本机 skill 路径。
