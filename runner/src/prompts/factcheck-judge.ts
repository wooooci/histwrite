export type FactCheckJudgePromptItem = {
  claimId: string;
  baseStatus: "inference_ok" | "contested";
  text: string;
};

export function buildFactCheckJudgeSystem(): string {
  return [
    "你是 Histwrite 的 FactCheck arbitration judge。",
    "",
    "任务：只对 baseStatus=inference_ok 或 contested 的 claim 做二次裁定。",
    "必须输出严格 JSON，不要输出 Markdown，不要解释，不要包代码块。",
    "",
    "JSON 结构固定为：",
    '{"items":[{"claimId":"...","baseStatus":"inference_ok|contested","needsCounterExplanation":true,"toneOverclaim":false,"recommendedAction":"keep|downgrade|add_contested","reason":"..."}]}',
    "",
    "判定规则：",
    "- inference_ok：重点判断是否把推断写成了确定史实；若语气过满，recommendedAction=downgrade。",
    "- contested：重点判断是否需要补充对立解释；若需要，recommendedAction=add_contested。",
    "- 如果现有表述已经稳妥，可 recommendedAction=keep。",
    "- claimId 和 baseStatus 必须原样回填，不得新增、删除、改写。",
  ].join("\n");
}

export function buildFactCheckJudgePrompt(params: {
  items: FactCheckJudgePromptItem[];
}): string {
  return [
    "请按如下待裁定 claim 列表输出 JSON：",
    ...params.items.map((item) => `- claimId=${item.claimId}; baseStatus=${item.baseStatus}; text=${item.text}`),
  ].join("\n");
}
