import { useEffect, useMemo, useState } from "react";
import {
  detectNativeShell,
  resolveSurface,
  type CompanionSurface,
  type SurfaceDecision,
} from "@shared/companionSurface";

/**
 * 「這一次要渲染哪一套產品」的唯一入口。
 *
 * ## 為什麼不是再一個 useIsPhone
 *
 * `lib/viewport.ts` 的 `useIsPhone()` 回答的是**寬度**問題，而且站內既有的
 * Phone/Desktop 分岔已經全部靠它。Companion 多了一個維度：**外殼**
 *（原生 App vs 手機瀏覽器）。把外殼判斷塞進 useIsPhone 會讓既有的三十幾個
 * 呼叫點跟著改變行為——那正是這次不能碰的東西。
 *
 * 所以這裡是**另一個 hook**，而且刻意與 useIsPhone 同界線（PHONE_MAX_WIDTH）：
 * 兩者對「這是不是手機」永遠同意，只有 Companion 多問一句「是不是 App」。
 *
 * ## 覆寫
 *
 * - `?surface=companion` / `?surface=workspace`：QA 與深連結測試用，只影響本次載入。
 * - `localStorage["aios.companion.surface"]`：使用者在 Companion 的「我」分頁裡
 *   選「改用完整工作站」時寫入，之後都生效（直到他改回來）。
 *
 * 覆寫只縮小或放大**自己的畫面**，不影響權限、不進伺服器。
 */
export const COMPANION_SURFACE_STORAGE_KEY = "aios.companion.surface";

function readStoredOverride(): "companion" | "workspace" | null {
  try {
    const value = localStorage.getItem(COMPANION_SURFACE_STORAGE_KEY);
    return value === "companion" || value === "workspace" ? value : null;
  } catch {
    // Safari 無痕模式讀 localStorage 會丟例外——那不該讓整個 App 白掉。
    return null;
  }
}

export function setCompanionSurfaceOverride(value: "companion" | "workspace" | null): void {
  try {
    if (value === null) localStorage.removeItem(COMPANION_SURFACE_STORAGE_KEY);
    else localStorage.setItem(COMPANION_SURFACE_STORAGE_KEY, value);
  } catch {
    /* 寫不進去就只是這次不生效，不值得中斷使用者 */
  }
  window.dispatchEvent(new CustomEvent(COMPANION_SURFACE_CHANGED));
}

export const COMPANION_SURFACE_CHANGED = "aios:companion-surface-changed";

function readQueryOverride(): "companion" | "workspace" | null {
  try {
    const value = new URLSearchParams(window.location.search).get("surface");
    return value === "companion" || value === "workspace" ? value : null;
  } catch {
    return null;
  }
}

/** Capacitor 的全域 bridge；型別只描述我們真的會讀的那一個方法。 */
interface CapacitorGlobal { isNativePlatform?: () => boolean }

export function isNativeAppShell(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
  return detectNativeShell({
    userAgent: navigator.userAgent,
    capacitorNative: (() => {
      try {
        return cap?.isNativePlatform?.() === true;
      } catch {
        return false;
      }
    })(),
  });
}

function currentDecision(): SurfaceDecision {
  if (typeof window === "undefined") {
    return { surface: "workspace", device: "desktop", reason: "非瀏覽器環境" };
  }
  const override = readQueryOverride() ?? readStoredOverride();
  return resolveSurface({
    width: window.innerWidth,
    nativeShell: isNativeAppShell(),
    forceCompanion: override === "companion",
    forceWorkspace: override === "workspace",
  });
}

/**
 * 目前的產品外殼。跟著轉向與視窗縮放即時更新——與 `useIsPhone` 同樣的理由：
 * 產品模式由**可用寬度**決定，不是進站時決定一次就鎖住。
 */
export function useCompanionSurface(): SurfaceDecision {
  const [decision, setDecision] = useState<SurfaceDecision>(currentDecision);
  useEffect(() => {
    const sync = () => setDecision((prev) => {
      const next = currentDecision();
      // 物件每次都是新的，但值多半沒變——比對後才 setState，避免 resize 期間
      // 每一幀都讓整棵 Companion 重繪。
      return prev.surface === next.surface && prev.device === next.device ? prev : next;
    });
    sync();
    window.addEventListener("resize", sync);
    window.addEventListener("orientationchange", sync);
    window.addEventListener(COMPANION_SURFACE_CHANGED, sync);
    return () => {
      window.removeEventListener("resize", sync);
      window.removeEventListener("orientationchange", sync);
      window.removeEventListener(COMPANION_SURFACE_CHANGED, sync);
    };
  }, []);
  return decision;
}

/** 只要布林值的呼叫端用這個，少一次物件解構。 */
export function useIsCompanion(): boolean {
  return useCompanionSurface().surface === "companion";
}

export type { CompanionSurface };

/**
 * `<html data-surface>`：讓 CSS 能只在 Companion 生效，而不必每個選擇器都加前綴。
 *
 * 與既有的 `data-orb-state` 同一個作法（見 lib/orbState.ts）：樣式表用屬性選擇器
 * 收斂作用域，於是 Companion 的樣式在桌面版是**一條規則都不會命中**，
 * 而不是靠「希望沒有人用到那個 class」。
 */
export function useSurfaceAttribute(surface: CompanionSurface): void {
  useEffect(() => {
    const root = document.documentElement;
    const previous = root.getAttribute("data-surface");
    root.setAttribute("data-surface", surface);
    return () => {
      if (previous) root.setAttribute("data-surface", previous);
      else root.removeAttribute("data-surface");
    };
  }, [surface]);
}
