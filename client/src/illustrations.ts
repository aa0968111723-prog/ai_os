/**
 * 空狀態／裝飾插畫路徑（Vite 以 /illustrations/* 提供）。
 * 與 brand.ts 相同：元件只讀這裡，勿在各頁硬編路徑。
 *
 * 資產放 client/public/illustrations/（見該目錄 README）。
 * UI 小圖示仍用 Icon.tsx（Lucide stroke）；這裡只放插畫級 PNG。
 */

export const ILLUSTRATION = {
  /** 無專案／列表空 */
  emptyProjects: "/illustrations/empty-projects-sq-512.png",
  /** 無訊息／對話空 */
  emptyMessages: "/illustrations/empty-messages-sq-512.png",
  /** 無媒體／素材庫空 */
  emptyMedia: "/illustrations/empty-media-sq-512.png",
  /** 緞帶標記裝飾（可作通用空狀態） */
  ribbonMark: "/illustrations/ribbon-mark-sq-512.png",
} as const;

export type IllustrationKey = keyof typeof ILLUSTRATION;
