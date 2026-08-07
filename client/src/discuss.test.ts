/**
 * 高亮與跳轉必須分開。
 *
 * 協作事件（別人改了某一格）只能「亮一下」，**絕不能捲動**：直接沿用 flashAnchor 的話，
 * 別人每存一次分鏡標題，全房的畫面就被強制平滑捲走一次——而 smooth 捲動正是鏡像跟隨
 * 那批修掉的抖動來源，等於把同一個問題從另一條路放回來。
 *
 * 這條測試盯的就是「有人把 highlightAnchor 改回呼叫 scrollIntoView」這種重構。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { flashAnchor, highlightAnchor } from "./discuss";

function mountAnchor(id: string): { el: HTMLElement; scrollIntoView: ReturnType<typeof vi.fn> } {
  const el = document.createElement("div");
  el.id = id;
  const scrollIntoView = vi.fn();
  el.scrollIntoView = scrollIntoView;
  document.body.appendChild(el);
  return { el, scrollIntoView };
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("highlightAnchor", () => {
  it("加上高亮 class，但**不捲動**", () => {
    const { el, scrollIntoView } = mountAnchor("scene-abc");
    expect(highlightAnchor("scene-abc")).toBe(true);
    expect(el.classList.contains("flash-target")).toBe(true);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("找不到元素回 false（呼叫端據此決定要不要提示，不是靜默失敗）", () => {
    expect(highlightAnchor("scene-nope")).toBe(false);
  });

  it("高亮會自己退場，不會永久留著 class", () => {
    vi.useFakeTimers();
    const { el } = mountAnchor("scene-abc");
    highlightAnchor("scene-abc");
    expect(el.classList.contains("flash-target")).toBe(true);
    vi.advanceTimersByTime(2500);
    expect(el.classList.contains("flash-target")).toBe(false);
  });
});

describe("flashAnchor", () => {
  it("捲動**並且**高亮——使用者自己點跳轉時才走這條", () => {
    const { el, scrollIntoView } = mountAnchor("scene-abc");
    expect(flashAnchor("scene-abc")).toBe(true);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(el.classList.contains("flash-target")).toBe(true);
  });

  it("找不到元素時不捲動也不拋", () => {
    const { scrollIntoView } = mountAnchor("other");
    expect(flashAnchor("scene-nope")).toBe(false);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
