/**
 * 留言的協作語意（intent）與決策（Decision）的共用契約。
 *
 * 兩個刻意的設計決定：
 *
 * 1. **不強迫使用者先選類型。** UI 預設永遠只是「留言」；intent 由事後的
 *    thread action（轉任務／轉決策）或建議 chip 補上。要求每則留言先分類的系統，
 *    最後每則留言都會是「一般」。
 *
 * 2. **Decision 是獨立的表，不是 message 的一種 kind。** 兩者生命週期不同：
 *    message 是時間軸上的一句話，會被往後的訊息淹沒；decision 是會被反覆引用的定案
 *    （「用暖色版本 B」「Shot 03 改 6 秒」），要能被列表、被 AI 讀、被撤銷而不消失。
 *    硬塞進 message 會讓「已解決」與「已定案」永遠分不開。
 */

export const MESSAGE_INTENTS = [
  "comment",
  "question",
  "suggestion",
  "change_request",
  "decision",
  "blocker",
] as const;

export type MessageIntent = (typeof MESSAGE_INTENTS)[number];

export const INTENT_LABEL: Record<MessageIntent, string> = {
  comment: "留言",
  question: "提問",
  suggestion: "建議",
  change_request: "修改要求",
  decision: "決策",
  blocker: "阻塞",
};

/** Decision 標題上限：定案是一句話（「開場保留雨聲」），不是一篇文章 */
export const DECISION_TITLE_MAX = 200;

/**
 * 「這則留言看起來是不是修改要求」的便宜啟發式——**建議，不裁決**。
 *
 * 用途只有一個：在留言下方顯示「看起來是一個修改要求 [轉成任務]」的提示 chip，
 * 按不按仍然是人的決定。所以判準刻意保守（高精確率、低召回率）：
 * 誤判成修改要求會讓提示變成噪音，漏判只是少一個提示，代價完全不對稱。
 * 不用 LLM：這個提示每一則留言都要算，走模型是每則留言都要錢跟延遲。
 */
const CHANGE_REQUEST_PATTERNS = [
  /要改/, /再改/, /改一下/, /改成/, /換成/, /調整/, /修一下/, /修正/, /重做/, /重生/, /重畫/,
  /太快/, /太慢/, /太亮/, /太暗/, /太大/, /太小/, /不自然/, /不對/, /怪怪的/,
  /慢一點/, /快一點/, /亮一點/, /暗一點/,
];

const BLOCKER_PATTERNS = [/卡住/, /被擋/, /動不了/, /等.{0,6}才能/, /沒辦法繼續/];

export function suggestIntent(body: string): MessageIntent | null {
  const text = body.trim();
  if (!text) return null;
  // 問句是最強的訊號，先判——「這裡要改嗎？」是提問不是修改要求
  if (/[?？]\s*$/.test(text)) return "question";
  if (BLOCKER_PATTERNS.some((re) => re.test(text))) return "blocker";
  if (CHANGE_REQUEST_PATTERNS.some((re) => re.test(text))) return "change_request";
  return null;
}
