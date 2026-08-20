/**
 * Android App Links 的數位資產連結宣告（/.well-known/assetlinks.json）。
 *
 * ## 這個端點在整個鏈路裡的位置
 *
 * Android 12+ 的 App Links 驗證：裝置安裝 App 時，系統到
 * `https://<host>/.well-known/assetlinks.json` 驗證「這個網域承認這個 App」。
 * 驗證通過 → 點通知或分享裡的 https 連結直接開 App；失敗 → 退回瀏覽器
 * （對使用者仍然可用，只是少了直開 App 的體驗）。
 *
 * ## 為什麼指紋走環境變數
 *
 * 簽章指紋跟著 keystore 走，而 keystore 在 CI Secrets（見 .github/workflows/apk.yml）
 * ——repo 裡不該出現任何一把正式指紋。未設定時本端點回 404：
 * 驗證會失敗、連結開瀏覽器，**沒有任何功能壞掉**，這是刻意的 graceful 缺席。
 *
 * 環境變數：
 *   ANDROID_APPLINK_SHA256="AA:BB:...:FF,11:22:...:EE"（逗號分隔，多把＝換簽過渡期）
 */

const PACKAGE_NAME = "app.aios.mobile";
/** SHA-256 指紋格式：32 組兩位十六進位、冒號分隔。大小寫不拘（正規化成大寫）。 */
const FINGERPRINT_RE = /^([0-9A-Fa-f]{2}:){31}[0-9A-Fa-f]{2}$/;

export interface AssetLinksStatement {
  relation: string[];
  target: {
    namespace: "android_app";
    package_name: string;
    sha256_cert_fingerprints: string[];
  };
}

/**
 * 環境變數 → assetlinks 宣告。格式錯的指紋直接丟棄（寧可驗證失敗開瀏覽器，
 * 也不要送出一份格式壞掉、讓 Android 驗證器整份拒收的 JSON）。
 * 一把有效指紋都沒有時回 null＝端點 404。
 */
export function buildAssetLinks(raw: string | undefined): AssetLinksStatement[] | null {
  const fingerprints = (raw ?? "")
    .split(",")
    .map((f) => f.trim().toUpperCase())
    .filter((f) => FINGERPRINT_RE.test(f));
  if (!fingerprints.length) return null;
  return [{
    relation: ["delegate_permission/common.handle_all_urls"],
    target: {
      namespace: "android_app",
      package_name: PACKAGE_NAME,
      sha256_cert_fingerprints: [...new Set(fingerprints)],
    },
  }];
}
