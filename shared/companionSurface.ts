/**
 * 裝置策略：哪一種螢幕、哪一種外殼，該拿到哪一套產品。
 *
 * ## 四套產品，不是四個版面
 *
 * | surface            | 給誰                        | 是什麼           |
 * |--------------------|-----------------------------|------------------|
 * | `workspace`        | 桌機、平板（含直立）        | 完整創作工作站   |
 * | `mobile_web`       | 手機瀏覽器                  | 看進度／素材／輕操作 |
 * | `companion`        | 手機原生 App（Capacitor）   | AI 對話桌寵      |
 *
 * ## 平板的紅線（任務書 §13）
 *
 * **平板不准被降級成手機 Companion。** 768×1024 的 iPad 直向有整整 768px 可用，
 * 把它判成手機等於讓使用者拿著一台夠大的機器、卻只能用單手拇指介面。
 * 這裡與 `client/src/lib/viewport.ts` 的 `PHONE_MAX_WIDTH = 767.98` 同界線，
 * 而且 Companion 還要**再多一個條件**：必須是原生 App 外殼。
 * 於是平板永遠拿 workspace，就算有人在平板上裝了 APK 也一樣。
 *
 * ## 為什麼 Companion 綁「原生 App」而不是「手機」
 *
 * 手機瀏覽器裡的使用者通常是點連結進來的（通知、別人分享的專案），他要的是
 * **看那個東西**，不是跟球講話。把手機 Web 也換成 Companion，等於讓每一條
 * 分享連結都打不開它承諾的內容。原生 App 才是「使用者主動打開 AIOS」的入口。
 */

export const COMPANION_SURFACES = ["workspace", "mobile_web", "companion"] as const;
export type CompanionSurface = typeof COMPANION_SURFACES[number];

export const DEVICE_CLASSES = ["phone", "tablet", "desktop"] as const;
export type DeviceClass = typeof DEVICE_CLASSES[number];

/** 與 client/src/lib/viewport.ts 的 PHONE_MAX_WIDTH 同值；兩處要一起改。 */
export const PHONE_MAX_WIDTH = 767.98;
/** 平板上限；之上視為桌機。只影響診斷輸出，兩者都拿 workspace。 */
export const TABLET_MAX_WIDTH = 1279.98;

export interface SurfaceProbe {
  /** window.innerWidth（CSS px） */
  width: number;
  /** Capacitor 原生外殼（navigator.userAgent 含 AiosApp／Capacitor.isNativePlatform） */
  nativeShell?: boolean;
  /** 使用者在設定裡把 App 切回完整工作站 */
  forceWorkspace?: boolean;
  /** 網址帶 ?surface=companion（QA 與深連結測試用） */
  forceCompanion?: boolean;
}

export interface SurfaceDecision {
  surface: CompanionSurface;
  device: DeviceClass;
  /** 為什麼是這個答案；診斷面板與測試讀它，不是給使用者看的 */
  reason: string;
}

export function deviceClassForWidth(width: number): DeviceClass {
  if (!Number.isFinite(width) || width <= 0) return "desktop";
  if (width <= PHONE_MAX_WIDTH) return "phone";
  if (width <= TABLET_MAX_WIDTH) return "tablet";
  return "desktop";
}

/**
 * 決定這一次要渲染哪一套產品。
 *
 * 順序刻意如此：
 * 1. `forceWorkspace` 最高——使用者明說要完整版時，任何偵測都不該蓋過他。
 * 2. `forceCompanion` 次之，但**仍受寬度限制**：在桌機上加 `?surface=companion`
 *    只是想預覽，不該讓平板／桌機使用者一鍵把自己鎖進單手介面。
 * 3. 其餘由 device × nativeShell 決定。
 */
export function resolveSurface(probe: SurfaceProbe): SurfaceDecision {
  const device = deviceClassForWidth(probe.width);
  if (probe.forceWorkspace) {
    return { surface: "workspace", device, reason: "使用者選擇完整工作站" };
  }
  if (device !== "phone") {
    return {
      surface: "workspace",
      device,
      reason: device === "tablet" ? "平板一律使用完整工作站" : "桌機使用完整工作站",
    };
  }
  if (probe.forceCompanion) {
    return { surface: "companion", device, reason: "網址指定 Companion" };
  }
  if (probe.nativeShell) {
    return { surface: "companion", device, reason: "手機原生 App" };
  }
  return { surface: "mobile_web", device, reason: "手機瀏覽器：看進度與素材" };
}

/** 這個外殼要不要掛 Companion 專屬樣式與分頁列。 */
export function isCompanionSurface(surface: CompanionSurface): boolean {
  return surface === "companion";
}

/**
 * Capacitor 外殼偵測。
 *
 * 兩條線索都要看：
 * - `Capacitor.isNativePlatform()`：官方 API，但 bridge 注入前的第一個 render 拿不到。
 * - UA 尾巴 `AiosApp/`：`capacitor.config.ts` 的 `appendUserAgent` 寫上去的，
 *   第一個 byte 就在，不必等 bridge。
 *
 * 只靠前者會讓 App 第一屏閃一下 mobile_web 再跳 Companion；只靠後者則在
 * 別人偽造 UA 時誤判——但那只是把自己的畫面換成 Companion，沒有權限影響。
 */
export function detectNativeShell(input: {
  userAgent?: string;
  capacitorNative?: boolean;
}): boolean {
  if (input.capacitorNative) return true;
  return /\bAiosApp\//.test(input.userAgent ?? "");
}
