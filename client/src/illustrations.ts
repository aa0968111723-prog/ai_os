/**
 * 空狀態／裝飾插畫（Vite 以 /illustrations/* 提供）。
 * 與 brand.ts 相同：元件只讀這裡，勿在各頁硬編路徑。
 *
 * 資產放 client/public/illustrations/（見該目錄 README）。
 * UI 小圖示仍用 Icon.tsx（Lucide stroke）；這裡只放插畫級點陣圖。
 *
 * 命名：`{base}-160.webp` / `{base}-320.webp`（主路徑）
 * 後備：`{base}-160.png` 或 `{base}-sq-512.png`
 */

export const ILLUSTRATION = {
  /** 無專案／列表空 */
  emptyProjects: "empty-projects",
  /** 無訊息／對話空 */
  emptyMessages: "empty-messages",
  /** 無媒體／素材庫空 */
  emptyMedia: "empty-media",
  /** 緞帶標記裝飾（可作通用空狀態） */
  ribbonMark: "ribbon-mark",
} as const;

export type IllustrationKey = keyof typeof ILLUSTRATION;

/** public 路徑前綴 */
export function illustrationBase(name: IllustrationKey): string {
  return `/illustrations/${ILLUSTRATION[name]}`;
}
