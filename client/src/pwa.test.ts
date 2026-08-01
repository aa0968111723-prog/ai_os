import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyAppUpdate,
  canOfferInstall,
  canShowInstallBanner,
  dismissInstallBanner,
  isAppUpdateReady,
  isInstallDismissed,
  isStandaloneApp,
  shouldOfferAppUpdate,
} from "./pwa";

describe("pwa helpers", () => {
  const values = new Map<string, string>();

  beforeEach(() => {
    values.clear();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => { values.set(key, value); },
        removeItem: (key: string) => { values.delete(key); },
        clear: () => values.clear(),
        key: (index: number) => [...values.keys()][index] ?? null,
        get length() { return values.size; },
      } satisfies Storage,
    });
  });

  afterEach(() => {
    values.clear();
    vi.unstubAllGlobals();
  });

  it("tracks install banner dismiss", () => {
    expect(isInstallDismissed()).toBe(false);
    dismissInstallBanner();
    expect(isInstallDismissed()).toBe(true);
  });

  it("detects standalone via matchMedia", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockImplementation((q: string) => ({
      matches: q.includes("standalone"),
      media: q,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
      onchange: null,
    })));
    expect(isStandaloneApp()).toBe(true);
  });

  it("offers update only when a new worker is installed over an existing controller", () => {
    expect(shouldOfferAppUpdate("installed", true)).toBe(true);
    expect(shouldOfferAppUpdate("installed", false)).toBe(false);
    expect(shouldOfferAppUpdate("installing", true)).toBe(false);
    expect(shouldOfferAppUpdate("activated", true)).toBe(false);
  });

  it("does not start update when no waiting worker exists", () => {
    expect(isAppUpdateReady()).toBe(false);
    expect(applyAppUpdate()).toBe(false);
  });

  it("hides install banner after dismiss but still offers install entry", () => {
    // iOS 環境：沒有 deferredInstall 也應可 offer（加入主畫面指引）
    vi.stubGlobal("navigator", {
      ...navigator,
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
      maxTouchPoints: 5,
      standalone: false,
    });
    vi.stubGlobal("matchMedia", vi.fn().mockImplementation((q: string) => ({
      matches: false,
      media: q,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
      onchange: null,
    })));

    expect(canShowInstallBanner()).toBe(true);
    expect(canOfferInstall()).toBe(true);

    dismissInstallBanner();
    expect(isInstallDismissed()).toBe(true);
    // 橫幅應隱藏
    expect(canShowInstallBanner()).toBe(false);
    // 選單入口仍在——使用者關掉提示後仍能主動安裝
    expect(canOfferInstall()).toBe(true);
  });

  it("does not offer install when already standalone", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockImplementation((q: string) => ({
      matches: q.includes("standalone"),
      media: q,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
      onchange: null,
    })));
    expect(isStandaloneApp()).toBe(true);
    expect(canShowInstallBanner()).toBe(false);
    expect(canOfferInstall()).toBe(false);
  });
});
