/**
 * 影片時間碼留言的純規則（前後端共用、可測）。
 *
 * messages.tMs 從第一天就在 schema 裡（毫秒；null＝靜態圖），但一直沒有 UI 消費它。
 * 這裡是把它變成完整產品能力的共用底座：顯示格式與「播放頭接近」判定。
 * 規則抽成純函式，是因為「圓點只在播放頭接近它時顯示」這條規則錯了不會有任何症狀——
 * 圓點只是安靜地永遠不出現，或永遠擠在畫面上。
 */

/**
 * 毫秒 → 給人看的時間碼。影片留言的慣例是 `00:18`（分:秒補零）；
 * 超過一小時才帶小時（`1:02:03`）——短影音場景 99% 用不到小時位，常駐只是雜訊。
 */
export function formatTMs(tMs: number): string {
  const total = Math.max(0, Math.floor(tMs / 1000));
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * 「播放頭接近這則留言」的判定窗（單邊，毫秒）。
 * 1.5 秒＝一句短台詞的長度：太窄會讓圓點一閃即逝根本點不到，
 * 太寬會讓相鄰兩則的圓點整段疊在一起。
 */
export const TMS_NEAR_WINDOW_MS = 1500;

/**
 * 這顆圓點現在該不該顯示。
 *  - tMs 為 null＝靜態圖標注：一律顯示（維持既有行為，這條路徑一個位元都不變）。
 *  - 有 tMs 但媒體不是影片（資料異常或素材被換成圖）：照樣顯示——寧可多顯示，
 *    也不要讓一則存在的標注在畫面上完全消失而沒有任何症狀。
 *  - 有 tMs 且是影片：只在播放頭落在 ±window 內顯示。
 */
export function dotVisibleAt(
  tMs: number | null | undefined,
  playheadMs: number | null,
  windowMs: number = TMS_NEAR_WINDOW_MS,
): boolean {
  if (tMs == null) return true;
  if (playheadMs == null) return true; // 不是影片／還量不到播放頭
  return Math.abs(tMs - playheadMs) <= windowMs;
}
