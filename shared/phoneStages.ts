/**
 * 手機版的製作階段：故事 → 分鏡 → 視覺 → 生成 → 交付。
 *
 * 放在 shared 是因為**兩邊都需要它，而且必須是同一份**：
 * 伺服器（`server/routers/phone.ts`）推導使用者做到哪一階段，前端
 * （`client/src/mobile/stages.ts`）據此決定進度列亮哪一格、「繼續製作」跳到哪裡。
 * 各寫一組字面值的話，伺服器回 "visual" 而前端只認得 "visuals" 這種事不會報錯，
 * 只會讓進度列永遠停在第一格——沒有例外、沒有紅字、沒有人發現。
 */
export const PHONE_STAGES = ["story", "storyboard", "visual", "generate", "deliver"] as const;

export type PhoneStage = (typeof PHONE_STAGES)[number];

/**
 * 目前做到哪一階段（純函式，前後端共用）。
 *
 * 刻意保守：只有「上一階段確實有東西」才往前推進一格。分鏡一格畫面都還沒有時
 * 說「在生成階段」會讓「繼續製作」把人帶到空頁面，比停在前一階段更糟。
 */
export function inferPhoneStage(counts: {
  hasStory: boolean;
  shots: number;
  shotsWithVisual: number;
  generationsDone: number;
  archived: boolean;
}): PhoneStage {
  if (counts.archived) return "deliver";
  if (!counts.hasStory && counts.shots === 0) return "story";
  if (counts.shots === 0) return "storyboard";
  if (counts.shotsWithVisual === 0) return "visual";
  if (counts.shotsWithVisual < counts.shots) return "generate";
  return counts.generationsDone > 0 ? "deliver" : "generate";
}
