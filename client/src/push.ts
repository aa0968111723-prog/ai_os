/**
 * Web Push 前端輔助（純瀏覽器 API，無 React 相依）：
 * SW 註冊、訂閱/退訂、環境偵測（是否支援、iOS 是否需先加入主畫面）、裝置標籤推導。
 * tRPC 呼叫（subscribe/unsubscribe 上報伺服器）由呼叫端（NotificationSettings／App 同步）負責，
 * 這裡只管瀏覽器端的訂閱本體。
 */

/** 這個瀏覽器能不能做 Web Push（SW＋PushManager＋Notification 三者齊備才行） */
export function isPushSupported(): boolean {
  return typeof navigator !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

/** iOS Safari：未「加入主畫面」前 PushManager 不存在——設定頁據此給「先加入主畫面」的引導 */
export function isIOS(): boolean {
  const ua = navigator.userAgent;
  // iPadOS 13+ 的 UA 偽裝成 Mac——用觸控點數補判
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

/** 是否以「已安裝 PWA」模式執行（iOS 加入主畫面後 display-mode 為 standalone） */
export function isStandalone(): boolean {
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
}

/** 裝置標籤（設定頁「已連結裝置」清單用）：平台＋瀏覽器，如「iPhone・Safari」「Windows・Chrome」 */
export function deviceLabel(): string {
  const ua = navigator.userAgent;
  const platform = /iPhone|iPod/.test(ua) ? "iPhone"
    : /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? "iPad"
    : /Android/.test(ua) ? "Android"
    : /Windows/.test(ua) ? "Windows"
    : /Macintosh/.test(ua) ? "Mac"
    : /Linux/.test(ua) ? "Linux"
    : "裝置";
  // 順序有講究：Edg/OPR 的 UA 也含 Chrome、Chrome 的 UA 也含 Safari——先驗特徵字串再驗通用字串
  const browser = /Edg\//.test(ua) ? "Edge"
    : /OPR\//.test(ua) ? "Opera"
    : /Firefox\//.test(ua) ? "Firefox"
    : /Chrome\//.test(ua) ? "Chrome"
    : /Safari\//.test(ua) ? "Safari"
    : "瀏覽器";
  return `${platform}・${browser}`;
}

/** VAPID 公鑰（base64url）→ PushManager.subscribe 要的 Uint8Array */
export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

/** 註冊（或取回已註冊的）通知 SW；不支援時回 null */
export async function ensureServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!isPushSupported()) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js");
  } catch {
    return null;
  }
}

export interface BrowserSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

function toBrowserSubscription(sub: PushSubscription): BrowserSubscription | null {
  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return null;
  return { endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } };
}

/** 目前這個瀏覽器既有的推播訂閱（未訂閱回 null） */
export async function getExistingSubscription(): Promise<BrowserSubscription | null> {
  const reg = await ensureServiceWorker();
  if (!reg) return null;
  const sub = await reg.pushManager.getSubscription();
  return sub ? toBrowserSubscription(sub) : null;
}

/**
 * 啟用本裝置：徵求通知授權 → PushManager 訂閱。
 * 回傳訂閱資料（呼叫端負責上報伺服器）；使用者拒絕授權/環境不支援時擲出帶人話訊息的 Error。
 */
export async function subscribeThisDevice(vapidPublicKey: string): Promise<BrowserSubscription> {
  if (!isPushSupported()) {
    throw new Error(isIOS() && !isStandalone()
      ? "iPhone/iPad 請先用 Safari 開啟本站 →「分享」→「加入主畫面」，再從主畫面開啟後啟用（需 iOS 16.4 以上）"
      : "這個瀏覽器不支援推播通知");
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("未取得通知授權——請在瀏覽器網站設定把「通知」改為允許後再試");
  }
  const reg = await ensureServiceWorker();
  if (!reg) throw new Error("通知服務註冊失敗，請重新整理後再試");
  // 既有訂閱若綁著不同的伺服器金鑰，subscribe 會丟錯——先退掉舊的再訂新的
  const existing = await reg.pushManager.getSubscription();
  if (existing) {
    const currentKey = existing.options.applicationServerKey;
    const wanted = urlBase64ToUint8Array(vapidPublicKey);
    const same = currentKey && currentKey.byteLength === wanted.byteLength
      && new Uint8Array(currentKey).every((b, i) => b === wanted[i]);
    if (!same) await existing.unsubscribe().catch(() => {});
    else {
      const parsed = toBrowserSubscription(existing);
      if (parsed) return parsed;
    }
  }
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
  });
  const parsed = toBrowserSubscription(sub);
  if (!parsed) {
    await sub.unsubscribe().catch(() => {});
    throw new Error("瀏覽器回傳的訂閱資料不完整，請再試一次");
  }
  return parsed;
}

/** 停用本裝置：瀏覽器端退訂。回傳被退訂的 endpoint（供上報伺服器刪列）；本來就沒訂閱回 null */
export async function unsubscribeThisDevice(): Promise<string | null> {
  const reg = await ensureServiceWorker();
  if (!reg) return null;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return null;
  const endpoint = sub.endpoint;
  await sub.unsubscribe().catch(() => {});
  return endpoint;
}
