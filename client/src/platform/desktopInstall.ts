/**
 * 電腦版安裝包下載入口（站內固定連結）。
 * 正式對外可改 VITE_DESKTOP_RELEASES_URL 指向簽章後的 Releases；
 * 預設指向本 repo 的 latest release（有 tag desktop-v* 並產包後可用）。
 */

/** GitHub Releases「最新一版」頁（使用者可選 Windows／Mac 附件） */
export const DESKTOP_RELEASES_URL =
  (typeof import.meta !== "undefined" &&
    (import.meta as { env?: { VITE_DESKTOP_RELEASES_URL?: string } }).env?.VITE_DESKTOP_RELEASES_URL) ||
  "https://github.com/aa0968111723-prog/ai_os/releases/latest";

export const DESKTOP_INSTALL_HINT =
  "安裝 Aios 電腦版後，可用本機剪映／Premiere 等編輯素材，儲存後自動回傳。目前為內部測試包（可能被系統智慧篩選擋下，選「仍要安裝」即可）。";
