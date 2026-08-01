/**
 * 電腦版安裝包下載入口（站內固定連結）。
 * 正式對外可改 VITE_DESKTOP_RELEASES_URL 指向簽章後的 Releases；
 * 預設指向本 repo 的 latest release（有 tag desktop-v* 並產包後可用）。
 */

const RELEASE_TAG = "desktop-v0.1.0";
const RELEASE_BASE = `https://github.com/aa0968111723-prog/ai_os/releases/download/${RELEASE_TAG}`;

/** GitHub Releases「最新一版」頁（使用者可選 Windows／Mac 附件） */
export const DESKTOP_RELEASES_URL =
  (typeof import.meta !== "undefined" &&
    (import.meta as { env?: { VITE_DESKTOP_RELEASES_URL?: string } }).env?.VITE_DESKTOP_RELEASES_URL) ||
  "https://github.com/aa0968111723-prog/ai_os/releases/latest";

/** 直接下載連結（避免使用者進 Releases 頁找不到附件） */
export const DESKTOP_WINDOWS_SETUP_URL = `${RELEASE_BASE}/Aios_0.1.0_x64-setup.exe`;
export const DESKTOP_WINDOWS_MSI_URL = `${RELEASE_BASE}/Aios_0.1.0_x64_en-US.msi`;
/** Mac .dmg 建好後會放同 tag；暫無則按鈕仍導向 Releases 頁 */
export const DESKTOP_MAC_DMG_URL =
  (typeof import.meta !== "undefined" &&
    (import.meta as { env?: { VITE_DESKTOP_MAC_DMG_URL?: string } }).env?.VITE_DESKTOP_MAC_DMG_URL) ||
  DESKTOP_RELEASES_URL;

export const DESKTOP_INSTALL_HINT =
  "安裝 Aios 電腦版後，可用本機剪映／Premiere 等編輯素材，儲存後自動回傳。目前為內部測試包（可能被系統智慧篩選擋下，選「仍要安裝」即可）。";
