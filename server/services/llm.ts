/**
 * 後端 LLM 模型單一設定點（盲點 #6：原本四處硬編碼 gemini-flash-1.5）。
 * - 預設維持 google/gemini-flash-1.5（已實測穩定）；
 * - 設環境變數 ANY_LLM_MODEL 即可整站切換（例如 google/gemini-2.5-flash——窗口與品質更好，
 *   但請先在真實模式抽測導演建議/拆分鏡/助手問答的 JSON 輸出穩定性再切，見維運手冊）。
 * 僅影響「後端自動呼叫」的 LLM（導演/助手/彙總）；使用者在生成台手選的 LLM 模型不受影響。
 */
export const ANY_LLM_MODEL = process.env.ANY_LLM_MODEL?.trim() || "google/gemini-flash-1.5";
