/**
 * 代理產出的型別標籤（agentRunner 的 outputRefs.type → 中文）。
 *
 * 放在 shared 而不是各自寫一份：這份對照表若和 agentRunner 實際發出的型別脫節，
 * 畫面就會出現 `database_row` 這種沒翻譯的英文字串直接給使用者看——
 * 實機驗證時就抓到過。server/services/agentOutputs.test.ts 會掃 agentRunner 的
 * addOutputRef 呼叫點，確保每個型別都在這裡有對應。
 */
export const AGENT_OUTPUT_KIND_LABEL: Record<string, string> = {
  scene: "分鏡",
  note: "筆記",
  task: "任務",
  schedule: "行程",
  generation: "生成",
  database_row: "資料列",
  cutos_job: "影片工作",
  cutos_result: "影片剪輯結果",
};

/** 未知型別原樣顯示（不要吞掉，讓人看得出是新型別而不是壞掉） */
export function agentOutputKindLabel(type: string): string {
  return AGENT_OUTPUT_KIND_LABEL[type] ?? type;
}
