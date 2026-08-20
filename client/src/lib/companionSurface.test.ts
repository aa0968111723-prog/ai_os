import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  COMPANION_SURFACE_STORAGE_KEY,
  isNativeAppShell,
  setCompanionSurfaceOverride,
  useCompanionSurface,
} from "./companionSurface";

function setWidth(width: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: width });
}

function setUserAgent(ua: string) {
  Object.defineProperty(navigator, "userAgent", { configurable: true, value: ua });
}

function setSearch(search: string) {
  window.history.replaceState({}, "", `/${search}`);
}

beforeEach(() => {
  setWidth(1440);
  setUserAgent("Mozilla/5.0 (Macintosh)");
  setSearch("");
  localStorage.clear();
  delete (window as unknown as { Capacitor?: unknown }).Capacitor;
});

describe("isNativeAppShell", () => {
  it("認得 Capacitor 注入的 UA 尾巴（第一個 render 就判得出來）", () => {
    setUserAgent("Mozilla/5.0 (Linux; Android 14) AiosApp/1.0");
    expect(isNativeAppShell()).toBe(true);
  });

  it("認得 Capacitor API", () => {
    (window as unknown as { Capacitor: unknown }).Capacitor = { isNativePlatform: () => true };
    expect(isNativeAppShell()).toBe(true);
  });

  it("Capacitor API 丟例外時不讓整個 App 白掉", () => {
    (window as unknown as { Capacitor: unknown }).Capacitor = {
      isNativePlatform: () => { throw new Error("bridge not ready"); },
    };
    expect(isNativeAppShell()).toBe(false);
  });

  it("一般瀏覽器不是原生外殼", () => {
    setUserAgent("Mozilla/5.0 (iPhone)");
    expect(isNativeAppShell()).toBe(false);
  });
});

describe("useCompanionSurface", () => {
  it("桌機是工作站", () => {
    const { result } = renderHook(() => useCompanionSurface());
    expect(result.current.surface).toBe("workspace");
  });

  it("平板是工作站——不因為裝了 App 就降級成單手介面", () => {
    setWidth(1024);
    setUserAgent("Mozilla/5.0 (Linux; Android 14) AiosApp/1.0");
    const { result } = renderHook(() => useCompanionSurface());
    expect(result.current.surface).toBe("workspace");
    expect(result.current.device).toBe("tablet");
  });

  it("手機瀏覽器是 mobile_web，分享連結照樣打得開", () => {
    setWidth(390);
    setUserAgent("Mozilla/5.0 (iPhone)");
    const { result } = renderHook(() => useCompanionSurface());
    expect(result.current.surface).toBe("mobile_web");
  });

  it("手機原生 App 才是 Companion", () => {
    setWidth(390);
    setUserAgent("Mozilla/5.0 (Linux; Android 14) AiosApp/1.0");
    const { result } = renderHook(() => useCompanionSurface());
    expect(result.current.surface).toBe("companion");
  });

  it("使用者選「改用完整工作站」後就一直生效", () => {
    setWidth(390);
    setUserAgent("Mozilla/5.0 (Linux; Android 14) AiosApp/1.0");
    localStorage.setItem(COMPANION_SURFACE_STORAGE_KEY, "workspace");
    const { result } = renderHook(() => useCompanionSurface());
    expect(result.current.surface).toBe("workspace");
  });

  it("切換覆寫會即時重算，不必重開 App", () => {
    setWidth(390);
    setUserAgent("Mozilla/5.0 (Linux; Android 14) AiosApp/1.0");
    const { result } = renderHook(() => useCompanionSurface());
    expect(result.current.surface).toBe("companion");
    act(() => setCompanionSurfaceOverride("workspace"));
    expect(result.current.surface).toBe("workspace");
    act(() => setCompanionSurfaceOverride(null));
    expect(result.current.surface).toBe("companion");
  });

  it("?surface=companion 只在手機寬度生效", () => {
    setWidth(390);
    setSearch("?surface=companion");
    const { result } = renderHook(() => useCompanionSurface());
    expect(result.current.surface).toBe("companion");
  });

  it("桌機加 ?surface=companion 仍是工作站——不讓一個網址把桌機鎖進單手介面", () => {
    setWidth(1440);
    setSearch("?surface=companion");
    const { result } = renderHook(() => useCompanionSurface());
    expect(result.current.surface).toBe("workspace");
  });

  it("轉向後重新判定", () => {
    setWidth(390);
    setUserAgent("Mozilla/5.0 (Linux; Android 14) AiosApp/1.0");
    const { result } = renderHook(() => useCompanionSurface());
    expect(result.current.surface).toBe("companion");
    act(() => {
      setWidth(900);
      window.dispatchEvent(new Event("orientationchange"));
    });
    expect(result.current.surface).toBe("workspace");
  });

  it("localStorage 讀不到（無痕）時不炸，退回偵測結果", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    setWidth(390);
    const { result } = renderHook(() => useCompanionSurface());
    expect(result.current.surface).toBe("mobile_web");
    spy.mockRestore();
  });
});
