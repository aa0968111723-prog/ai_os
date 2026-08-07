import { render } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { REVEAL_EVENT, goTo, revealOnSamePageClick, useRevealFocus, type RevealDetail } from "./goTo";

/**
 * 這組測試守的是一個「靜默死鍵」的修復：wouter 的 usePathname 只認 location.pathname
 * （useSyncExternalStore 的 snapshot 不含 search），所以從 /p/A 導航到 /p/A?focus=X
 * 不會觸發任何 re-render——深連結的消費者全是掛載時讀一次，於是那一按什麼都不會發生。
 * goTo 的補救是第二軌：同頁時補派 aios:reveal 事件，已掛載的消費者自己補收。
 */
describe("goTo", () => {
  afterEach(() => window.history.replaceState(null, "", "/"));

  it("跨頁導航：只改網址，不派事件（軌一會在重新掛載時讀 ?focus=）", () => {
    window.history.replaceState(null, "", "/dashboard");
    const seen = vi.fn();
    window.addEventListener(REVEAL_EVENT, seen);
    goTo("/p/proj-1", { focus: "agent-run-r1" });
    window.removeEventListener(REVEAL_EVENT, seen);
    expect(window.location.pathname).toBe("/p/proj-1");
    expect(window.location.search).toBe("?focus=agent-run-r1");
    expect(seen).not.toHaveBeenCalled();
  });

  it("同頁導航：wouter 不會 re-render，所以要補派 aios:reveal 事件", () => {
    window.history.replaceState(null, "", "/p/proj-1");
    const seen = vi.fn((e: Event) => (e as CustomEvent<RevealDetail>).detail);
    window.addEventListener(REVEAL_EVENT, seen);
    goTo("/p/proj-1", { focus: "agent-run-r1" });
    window.removeEventListener(REVEAL_EVENT, seen);
    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen.mock.results[0]!.value).toEqual({ focus: "agent-run-r1" });
    // 網址仍要更新——重整、分享連結都靠它
    expect(window.location.search).toBe("?focus=agent-run-r1");
  });

  it("沒帶 focus 就是普通導航，不派事件", () => {
    window.history.replaceState(null, "", "/p/proj-1");
    const seen = vi.fn();
    window.addEventListener(REVEAL_EVENT, seen);
    goTo("/p/proj-1");
    window.removeEventListener(REVEAL_EVENT, seen);
    expect(seen).not.toHaveBeenCalled();
  });
});

describe("useRevealFocus", () => {
  afterEach(() => window.history.replaceState(null, "", "/"));

  function Probe({ onFocus }: { onFocus: (f: string) => void | (() => void) }) {
    useRevealFocus(onFocus);
    return null;
  }

  it("掛載時讀網址的 ?focus=（軌一：跨頁重新掛載的路徑）", () => {
    window.history.replaceState(null, "", "/p/proj-1?focus=scene-abc");
    const onFocus = vi.fn();
    render(<Probe onFocus={onFocus} />);
    expect(onFocus).toHaveBeenCalledWith("scene-abc");
  });

  it("掛載後收 aios:reveal 事件（軌二：同頁補收的路徑）", () => {
    window.history.replaceState(null, "", "/p/proj-1");
    const onFocus = vi.fn();
    render(<Probe onFocus={onFocus} />);
    expect(onFocus).not.toHaveBeenCalled();
    act(() => {
      window.dispatchEvent(new CustomEvent<RevealDetail>(REVEAL_EVENT, { detail: { focus: "scene-x" } }));
    });
    expect(onFocus).toHaveBeenCalledWith("scene-x");
  });

  it("下一次揭示先清掉上一次的輪詢——連按兩次不能有兩個計時器搶捲動", () => {
    window.history.replaceState(null, "", "/p/proj-1");
    const cleanup = vi.fn();
    const onFocus = vi.fn(() => cleanup);
    render(<Probe onFocus={onFocus} />);
    act(() => {
      window.dispatchEvent(new CustomEvent<RevealDetail>(REVEAL_EVENT, { detail: { focus: "a" } }));
    });
    expect(cleanup).not.toHaveBeenCalled();
    act(() => {
      window.dispatchEvent(new CustomEvent<RevealDetail>(REVEAL_EVENT, { detail: { focus: "b" } }));
    });
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("卸載時清掉最後一次的輪詢", () => {
    window.history.replaceState(null, "", "/p/proj-1?focus=scene-abc");
    const cleanup = vi.fn();
    const { unmount } = render(<Probe onFocus={vi.fn(() => cleanup)} />);
    unmount();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("handler 換了不重新訂閱，但收到事件時用的是最新的 handler", () => {
    window.history.replaceState(null, "", "/p/proj-1");
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<Probe onFocus={first} />);
    rerender(<Probe onFocus={second} />);
    act(() => {
      window.dispatchEvent(new CustomEvent<RevealDetail>(REVEAL_EVENT, { detail: { focus: "x" } }));
    });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith("x");
  });
});

describe("revealOnSamePageClick", () => {
  afterEach(() => window.history.replaceState(null, "", "/"));

  it("點的就是目前這一頁時補派事件（<Link> 保留原生行為，只補軌二）", () => {
    window.history.replaceState(null, "", "/p/proj-1");
    const seen = vi.fn((e: Event) => (e as CustomEvent<RevealDetail>).detail);
    window.addEventListener(REVEAL_EVENT, seen);
    revealOnSamePageClick("/p/proj-1?focus=pending");
    window.removeEventListener(REVEAL_EVENT, seen);
    expect(seen.mock.results[0]!.value).toEqual({ focus: "pending" });
  });

  it("點別頁時不派——那條路 wouter 會正常重新掛載，軌一自己會收", () => {
    window.history.replaceState(null, "", "/dashboard");
    const seen = vi.fn();
    window.addEventListener(REVEAL_EVENT, seen);
    revealOnSamePageClick("/p/proj-1?focus=pending");
    window.removeEventListener(REVEAL_EVENT, seen);
    expect(seen).not.toHaveBeenCalled();
  });
});
