import { useMatchMedia } from "./useMatchMedia";

/**
 * 產品模式的唯一切換點：Phone UX ↔ Desktop UX。
 *
 * ## 為什麼是 768 而不是原本的 820
 *
 * 站內原本把手機殼層下放到 `≤820px`，理由記在 styles.css 的「手機 App 殼層 v2」：
 * 561–820px（直立平板）當時完全沒有主導覽，於是整組操作模型一起搬到 820。
 * 那個洞現在改用另一種方式補——**平板直接用桌面版**。820 的問題是它把
 * 768×1024 的 iPad 直向、820×1180 的 iPad Air 直向都判成手機，於是平板拿到
 * 為單手拇指設計的三格底欄與貼底 sheet，卻有整整 820px 可用寬度。
 *
 * 產品只維護兩套體驗：
 * - `≤767.98px` → Phone（AI-first 殼層、底部分頁列、簡化首頁與專案頁）
 * - `≥768px`    → Desktop（既有體驗，平板與桌機共用）
 *
 * 不做第三套 Tablet UI。
 *
 * ## 為什麼是 767.98 而不是 767
 *
 * 視窗寬度不保證是整數：瀏覽器縮放與某些裝置的 CSS 像素會回 767.5。
 * `max-width: 767px` 會讓 767.5px 兩邊都不成立（既非手機也非桌面），
 * 出現「兩套導航都不見」的空窗。`767.98` 與 `min-width: 768px` 剛好互補、無縫。
 *
 * ## 這個常數管什麼、不管什麼
 *
 * **管**：Phone UI 與 Desktop UI 的產品切換——底部分頁列、選單是否變 bottom sheet、
 * 手機首頁／專案頁是否取代桌面版、動畫創作室輕量版。
 *
 * **不管**：CSS 內部的細部 responsive 斷點（卡片幾欄、字級、某個表格何時橫捲）。
 * 那些是同一套 UI 的自適應，維持原樣。
 */
export const PHONE_MAX_WIDTH = 767.98;

/** 手機（Phone UX）媒體查詢——與 CSS 的 `@media (max-width: 767.98px)` 同界線 */
export const PHONE_MQ = `(max-width: ${PHONE_MAX_WIDTH}px)`;

/** 桌面（Desktop UX，含平板）媒體查詢——與 PHONE_MQ 互補、無空窗 */
export const DESKTOP_MQ = "(min-width: 768px)";

/**
 * 現在是不是手機產品模式。
 *
 * 只用寬度判定，不看 user-agent、不看 `pointer: coarse`：
 * 平板是粗指標但用桌面版，桌面瀏覽器縮到 400px 寬則該拿手機版——
 * 決定「哪一套 UI」的是可用寬度，不是輸入裝置。
 */
export function useIsPhone(): boolean {
  return useMatchMedia(PHONE_MQ);
}
