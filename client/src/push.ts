/**
 * Web Push 前端輔助（純瀏覽器 API，無 React 相依）：
 * SW 註冊、訂閱/退訂、環境偵測（是否支援、iOS 是否需先加入主畫面）、裝置標籤推導。
 * tRPC 呼叫（subscribe/unsubscribe 上報伺服器）由呼叫端（NotificationSettings／App 同步）負責，
 * 這裡只管瀏覽器端的訂閱本體。
 *
 * ★裝置命名一律走 shared/deviceNaming.ts：這裡原本自己寫了一套只認 6 個平台、
 *   5 個瀏覽器的簡版，產出的「Android・Chrome」在有兩支 Android 的人身上完全分不出誰是誰，
 *   而伺服器早就有機型／版本的完整版。合併之後兩邊必然同名。
 */

import { collectDeviceHint } from "./deviceHint";
import type { DeviceDetails, DeviceKind } from "@shared/deviceDetails";
import {
  deviceKindFrom,
  deviceLabelFrom,
  describeDevice,
  kindFromLabel as kindFromLabelShared,
  type DeviceHint,
} from "@shared/deviceNaming";

export type { DeviceKind };

/** 這個瀏覽器能不能做 Web Push（SW＋PushManager＋Notification 三者齊備才行） */
export function isPushSupported(): boolean {
  return typeof navigator !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

/** iOS Safari：未「加入主畫面」前 PushManager 不存在——設定頁據此給「先加入主畫面」的引導 */
export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  // iPadOS 13+ 的 UA 偽裝成 Mac——用觸控點數補判
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

/** 是否以「已安裝 PWA」模式執行（iOS 加入主畫面後 display-mode 為 standalone） */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
}

/** 是否 Android */
export function isAndroid(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android/i.test(navigator.userAgent);
}

/**
 * 本機的「立即可得」特徵：不含 UA-CH（那是非同步的），供第一畫面渲染用。
 * 真正要送出去的完整特徵走 collectDeviceProfile()。
 */
function localHint(): DeviceHint {
  return {
    standalone: isStandalone(),
    touchPoints: typeof navigator === "undefined" ? 0 : navigator.maxTouchPoints,
  };
}

/**
 * 粗分裝置類型（設定頁圖示／引導用）。
 * 僅依 UA／觸控推斷，不請求額外權限；要更準的（Android 手機/平板之分）走 collectDeviceProfile。
 */
export function deviceKind(): DeviceKind {
  if (typeof navigator === "undefined") return "unknown";
  return deviceKindFrom(navigator.userAgent, localHint());
}

/** 從已存 label 字串推斷類型（清單列無法讀對方 UA；有 details.kind 時優先用那個） */
export const kindFromLabel = kindFromLabelShared;

/**
 * 本裝置標籤的「立即版」：只有 UA 讀得到的東西（無機型、無版本號）。
 * 畫面要先出得來，故保留這條同步路徑；送去伺服器存的是 collectDeviceProfile() 的完整版。
 */
export function deviceLabel(): string {
  if (typeof navigator === "undefined") return "裝置";
  return deviceLabelFrom(navigator.userAgent, localHint());
}

/** 本裝置的完整檔案：標籤、細節、類型——上報伺服器與設定頁標題共用 */
export interface DeviceProfile {
  label: string;
  details: DeviceDetails;
  kind: DeviceKind;
}

/**
 * 收齊 UA-CH 後的完整裝置檔案（機型、系統版本、瀏覽器版本、螢幕、處理器、顯示卡）。
 *
 * 「已連結裝置」清單原本只存得下一句「Android・Chrome・主畫面」——同型號的兩支手機、
 * 辦公室裡的每一台 Windows 都長得一模一樣，要移除哪一台只能猜。這支把信任裝置那邊
 * 早就有的細節補到推播裝置上，兩份清單看到的資訊因此對齊。
 *
 * UA-CH 取不到（Safari／Firefox／逾時）時自動退回 UA 能講的部分，永不拋例外。
 */
export async function collectDeviceProfile(): Promise<DeviceProfile> {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  const collected = await collectDeviceHint().catch(() => undefined);
  const hint: DeviceHint = { ...localHint(), ...(collected ?? {}) };
  return {
    label: deviceLabelFrom(ua, hint),
    details: describeDevice(ua, hint),
    kind: deviceKindFrom(ua, hint),
  };
}

/** 通知權限狀態（含不支援） */
export function notificationPermission(): NotificationPermission | "unsupported" {
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.permission;
}

/** 本機是否已具備「可收推播」條件（支援＋已授權） */
export function canReceivePushHere(): boolean {
  return isPushSupported() && notificationPermission() === "granted";
}

/** 相對時間（最近同步）：「剛剛」「5 分鐘前」「昨天」 */
export function relSeen(at: Date | string | number): string {
  const t = new Date(at).getTime();
  if (!Number.isFinite(t)) return "—";
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 1) return "剛剛";
  if (mins < 60) return `${mins} 分鐘前`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} 小時前`;
  const days = Math.round(hours / 24);
  if (days === 1) return "昨天";
  if (days < 30) return `${days} 天前`;
  return new Date(t).toLocaleDateString("zh-TW");
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
    const reg = await navigator.serviceWorker.register("/sw.js");
    // 盡力拉最新 SW（不擋主流程）：避免舊 SW 仍掛著舊 icon／行為
    void reg.update().catch(() => {});
    return reg;
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
    throw new Error(
      permission === "denied"
        ? "通知權限被封鎖——請到瀏覽器網站設定把「通知」改為允許後再試"
        : "未取得通知授權——請在彈出視窗按「允許」",
    );
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

/** 複製「如何在另一台裝置連結」短說明到剪貼簿 */
export async function copyLinkDeviceGuide(origin: string = typeof location !== "undefined" ? location.origin : ""): Promise<void> {
  const text = [
    "把 Aios 通知連到另一台裝置：",
    `1. 在那台裝置用瀏覽器打開 ${origin || "本站"}`,
    "2. 登入同一個帳號",
    "3. 個人設定 →「通知設定與裝置連結」→「在本裝置啟用通知」",
    "4. 允許瀏覽器通知權限",
    "",
    "iPhone/iPad：需先「分享 → 加入主畫面」，再從主畫面圖示開啟（iOS 16.4+）",
  ].join("\n");
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  // 舊瀏覽器 fallback
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  document.body.removeChild(ta);
}
