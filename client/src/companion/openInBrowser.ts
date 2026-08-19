import { companionAbsoluteUrl, companionDeepLink, type CompanionDeepLinkInput } from "@shared/companionDeepLink";

/**
 * 把使用者送到 Web 工作站。
 *
 * ## 為什麼要在系統瀏覽器開，而不是 App 內的 WebView
 *
 * Capacitor 的殼本身就是 WebView，在裡面再導一次等於把 Companion 換掉——
 * 使用者按返回會回到 Companion 的某個中間狀態，而不是他離開時的那顆球。
 * 開系統瀏覽器則是兩個獨立的東西：分鏡在 Chrome 裡編，球還在 App 裡等他回來。
 *
 * ## 為什麼 origin 只能來自 location
 *
 * 深連結的目標由助手（模型）提出。若允許它指定 host，一句話就能把帶著登入
 * session 的使用者導去任何網站。所以：**target 與 projectId 可以來自模型，
 * origin 永遠來自這一份程式碼。**
 */

interface CapacitorBrowserPlugin {
  open?: (options: { url: string }) => Promise<void>;
}

interface CapacitorGlobalWithPlugins {
  Plugins?: { Browser?: CapacitorBrowserPlugin };
}

/**
 * 開啟深連結。回傳實際開出去的絕對網址（給測試與紀錄用），失敗回 null。
 *
 * 失敗只有兩種可能，兩種都不該靜默：
 * - 連結不完整（缺 projectId）→ 呼叫端本來就不該渲染那顆按鈕
 * - 瀏覽器擋掉 window.open → 呼叫端要顯示可點的連結讓使用者自己按
 */
export function openCompanionDeepLink(input: CompanionDeepLinkInput): string | null {
  const link = companionDeepLink(input);
  if (link.incomplete) return null;
  const url = companionAbsoluteUrl(window.location.origin, link.path);
  if (!url) return null;

  const cap = (window as unknown as { Capacitor?: CapacitorGlobalWithPlugins }).Capacitor;
  const browser = cap?.Plugins?.Browser;
  if (browser?.open) {
    // 外掛不在時 open 會 reject；那時仍要退到 window.open，不能讓按鈕沒反應。
    void browser.open({ url }).catch(() => fallbackOpen(url));
    return url;
  }
  return fallbackOpen(url) ? url : null;
}

function fallbackOpen(url: string): boolean {
  // noopener：新分頁拿不到 window.opener，避免被導回時改掉 App 的網址。
  const opened = window.open(url, "_blank", "noopener,noreferrer");
  return opened !== null;
}
