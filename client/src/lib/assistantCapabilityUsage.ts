const KEY = "aios.assistantCapabilityUsage";
/** 記幾個：夠讓常用的浮上來，又不會讓半年前用過一次的東西永遠佔著版面 */
const MAX = 8;

/**
 * 使用者實際用過哪些助手能力（最近的排前面）。
 *
 * 為什麼要記：能力清單如果對每個人、每一天都長一樣，它就只是一張說明書——
 * 剪片的人永遠要滑過「讀取任務」「讀取組員」才看到分鏡相關的那幾行。
 * 用過的浮上來之後，這張清單會慢慢變成「你的」清單。
 *
 * 為什麼記在 localStorage 而不是後端：這是純粹的畫面排序偏好，不影響任何權限與計費，
 * 為它加一張表與一組 API 是把小事做大；換裝置重新學一次的成本遠低於那個複雜度。
 */
export function readCapabilityUsage(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string").slice(0, MAX) : [];
  } catch {
    // 壞掉的值（手改、舊版格式）當成沒用過，不要讓一個排序偏好炸掉整張面板
    return [];
  }
}

/** 用過一次就移到最前面（去重），回傳新順序讓呼叫端不必再讀一次 */
export function recordCapabilityUse(id: string): string[] {
  const next = [id, ...readCapabilityUsage().filter((v) => v !== id)].slice(0, MAX);
  if (typeof window === "undefined") return next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // 隱私模式／空間不足：這一輪的順序仍然正確，只是下次開不記得
  }
  return next;
}
