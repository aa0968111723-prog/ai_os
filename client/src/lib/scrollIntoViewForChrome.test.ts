import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chromeBottomReservePx, scrollIntoViewForChrome } from "./scrollIntoViewForChrome";

describe("scrollIntoViewForChrome", () => {
  beforeEach(() => {
    vi.stubGlobal("innerHeight", 800);
    // 模擬 CSS 變數
    vi.spyOn(window, "getComputedStyle").mockImplementation(() => ({
      getPropertyValue: (name: string) => {
        if (name === "--chrome-bottom") return "100px";
        if (name === "--safe-bottom") return "0px";
        if (name === "--safe-top") return "0px";
        return "";
      },
    }) as CSSStyleDeclaration);
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: { height: 800, offsetTop: 0 },
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("chromeBottomReservePx 讀 --chrome-bottom 並加緩衝", () => {
    expect(chromeBottomReservePx()).toBeGreaterThanOrEqual(100 + 12);
  });

  it("已在安全區內則不 scrollBy", () => {
    const scrollBy = vi.fn();
    vi.stubGlobal("scrollBy", scrollBy);
    const el = document.createElement("div");
    el.getBoundingClientRect = () =>
      ({ top: 200, bottom: 280, height: 80, left: 0, right: 0, width: 100, x: 0, y: 200, toJSON: () => ({}) }) as DOMRect;
    scrollIntoViewForChrome(el, { behavior: "auto" });
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it("被底欄裁切時會 scrollBy", () => {
    const scrollBy = vi.fn();
    vi.stubGlobal("scrollBy", scrollBy);
    const el = document.createElement("div");
    // 接近視窗底部，會超出 bottomSafe（800 - 112）
    el.getBoundingClientRect = () =>
      ({ top: 720, bottom: 790, height: 70, left: 0, right: 0, width: 100, x: 0, y: 720, toJSON: () => ({}) }) as DOMRect;
    scrollIntoViewForChrome(el, { behavior: "auto" });
    expect(scrollBy).toHaveBeenCalled();
    const arg = scrollBy.mock.calls[0][0] as { top: number };
    expect(arg.top).not.toBe(0);
  });
});
