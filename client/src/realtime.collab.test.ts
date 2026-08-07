import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  COLLAB_MIRRORING_CLASS,
  applyMirrorViewportLock,
  applyScrollDeltaY,
  caretRatioFromElement,
  collabAnchorFromElement,
  createMirrorLockState,
  cursorViewportPoint,
  ensureAnchorExpanded,
  extrapolateCursorPose,
  findCollabAnchorElement,
  followablePeers,
  listScrollParents,
  refineAnchorRatiosWithCaret,
  shouldSkipCollabScrollBroadcast,
  updatePacketIntervalEma,
  useCollabMirrorFollow,
  zoneOfPeer,
  type CollabPeer,
  type CollabViewMode,
} from "./realtime";

const peers: CollabPeer[] = [
  { userId: "a", name: "安", color: "#c2613f" },
  { userId: "b", name: "哲", color: "#6e8b62" },
  { userId: "c", name: "晴", color: "#b58a3e" },
];

describe("zoneOfPeer / followablePeers", () => {
  it("zoneOfPeer finds zone", () => {
    const zones = { 世界觀: [peers[0]], 分鏡: [peers[1], peers[2]] };
    expect(zoneOfPeer("b", zones)).toBe("分鏡");
    expect(zoneOfPeer("nobody", zones)).toBeNull();
  });
  it("followablePeers excludes self", () => {
    expect(followablePeers(peers, "b").map((p) => p.userId)).toEqual(["a", "c"]);
  });
});

describe("extreme anchor resolution", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("prefers deepest field id inside a card", () => {
    document.body.innerHTML = `
      <section data-fb="世界觀卡" id="onboard-worldview">
        <input id="wv-title" />
      </section>
    `;
    expect(collabAnchorFromElement(document.querySelector("input"))).toBe("#wv-title");
  });

  it("prefers list row id over duplicate data-fb", () => {
    document.body.innerHTML = `
      <div data-fb="分鏡格" id="scene-1"><button>A</button></div>
      <div data-fb="分鏡格" id="scene-2"><button>B</button></div>
    `;
    expect(collabAnchorFromElement(document.querySelectorAll("button")[1])).toBe("#scene-2");
    expect(findCollabAnchorElement("#scene-2")?.textContent).toContain("B");
  });

  it("resolves task- and generation- ids", () => {
    document.body.innerHTML = `
      <div id="task-abc"><span>t</span></div>
      <div id="generation-xyz"><span>g</span></div>
    `;
    expect(collabAnchorFromElement(document.querySelector("#task-abc span"))).toBe("#task-abc");
    expect(collabAnchorFromElement(document.querySelector("#generation-xyz span"))).toBe("#generation-xyz");
  });
});

describe("cursorViewportPoint", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("anchor + ax/ay", () => {
    document.body.innerHTML = `<div id="c1" data-fb="卡"></div>`;
    const el = document.getElementById("c1")!;
    vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
      left: 100, top: 200, width: 200, height: 100, right: 300, bottom: 300, x: 100, y: 200, toJSON: () => ({}),
    });
    expect(cursorViewportPoint({ x: 0, y: 0, anchor: "#c1", ax: 0.25, ay: 0.5 }, null)).toEqual({ x: 150, y: 250 });
  });
});

describe("ensureAnchorExpanded", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("opens nested closed details ancestors", () => {
    document.body.innerHTML = `
      <details id="outer"><summary>o</summary>
        <details id="inner"><summary>i</summary>
          <div id="target">x</div>
        </details>
      </details>
    `;
    const outer = document.getElementById("outer") as HTMLDetailsElement;
    const inner = document.getElementById("inner") as HTMLDetailsElement;
    expect(outer.open).toBe(false);
    expect(inner.open).toBe(false);
    const changed = ensureAnchorExpanded(document.getElementById("target"));
    expect(changed).toBe(true);
    expect(inner.open).toBe(true);
    expect(outer.open).toBe(true);
  });
});

describe("caret + prediction", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("caretRatioFromElement uses selectionStart / length", () => {
    document.body.innerHTML = `<input id="t" value="hello" />`;
    const input = document.getElementById("t") as HTMLInputElement;
    input.setSelectionRange(2, 2);
    expect(caretRatioFromElement(input)).toBeCloseTo(0.4, 5);
  });

  it("refineAnchorRatiosWithCaret maps input ci to ax", () => {
    document.body.innerHTML = `<input id="t" value="hello" />`;
    const input = document.getElementById("t") as HTMLInputElement;
    expect(refineAnchorRatiosWithCaret(input, { ax: 0.1, ay: 0.5, ci: 0.8 })).toEqual({
      ax: 0.8,
      ay: 0.5,
    });
  });

  it("refineAnchorRatiosWithCaret maps textarea lines", () => {
    document.body.innerHTML = `<textarea id="t">ab\ncd\nef</textarea>`;
    const ta = document.getElementById("t") as HTMLTextAreaElement;
    // index at start of line 2 ("ef") → ci ≈ 6/8 = 0.75
    const r = refineAnchorRatiosWithCaret(ta, { ax: 0, ay: 0, ci: 6 / 8 });
    expect(r.ay).toBeGreaterThan(0.4);
  });

  it("extrapolateCursorPose advances along velocity", () => {
    const prev = { t: 1000, ax: 0.2, ay: 0.2, vy: 0.3, vx: 0.4 };
    const curr = { t: 1040, ax: 0.3, ay: 0.2, vy: 0.4, vx: 0.4 };
    // lead 40ms = 1 packet interval → k=1 → ax = 0.3 + 0.1 = 0.4
    const out = extrapolateCursorPose(prev, curr, 40);
    expect(out.ax).toBeCloseTo(0.4, 5);
    expect(out.vy).toBeCloseTo(0.5, 5);
  });

  it("extrapolateCursorPose skips bad intervals", () => {
    const prev = { t: 1000, ax: 0.1, ay: 0.1, vy: 0.1, vx: 0.1 };
    const curr = { t: 1005, ax: 0.9, ay: 0.9, vy: 0.9, vx: 0.9 };
    expect(extrapolateCursorPose(prev, curr, 40)).toEqual({
      ax: 0.9, ay: 0.9, vy: 0.9, vx: 0.9,
    });
  });

  it("cursorViewportPoint uses ci on input", () => {
    document.body.innerHTML = `<input id="wv-title" value="hello world" />`;
    const el = document.getElementById("wv-title")!;
    vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
      left: 0, top: 0, width: 100, height: 20, right: 100, bottom: 20, x: 0, y: 0, toJSON: () => ({}),
    });
    const p = cursorViewportPoint({ x: 0, y: 0, anchor: "#wv-title", ax: 0, ay: 0.5, ci: 0.5 }, null);
    expect(p).toEqual({ x: 50, y: 10 });
  });
});

describe("applyScrollDeltaY / listScrollParents", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("scrolls nested overflow container before window", () => {
    document.body.innerHTML = `
      <div id="scroller" style="overflow:auto;height:100px">
        <div id="inner" style="height:500px">tall</div>
      </div>
    `;
    const scroller = document.getElementById("scroller") as HTMLElement;
    Object.defineProperty(scroller, "scrollHeight", { value: 500, configurable: true });
    Object.defineProperty(scroller, "clientHeight", { value: 100, configurable: true });
    let top = 0;
    Object.defineProperty(scroller, "scrollTop", {
      get: () => top,
      set: (v: number) => { top = v; },
      configurable: true,
    });
    vi.spyOn(window, "getComputedStyle").mockImplementation((el) => {
      if (el === scroller) {
        return { overflowY: "auto", overflowX: "visible" } as CSSStyleDeclaration;
      }
      return { overflowY: "visible", overflowX: "visible" } as CSSStyleDeclaration;
    });
    const parents = listScrollParents(document.getElementById("inner"));
    expect(parents[0]).toBe(scroller);
    const applied = applyScrollDeltaY(document.getElementById("inner"), 40);
    expect(applied).toBe(40);
    expect(top).toBe(40);
  });

  // 程式化捲動會觸發 useCollab 的 capture scroll handler → sendCursorAt → focus，
  // 於是只是在旁邊看的人會被全房當成「正在編輯」。預期位置比對必須擋掉這一次事件，
  // 而且**只擋這一次**——否則使用者接著自己捲動也會被吃掉，跟隨者對全房完全隱形。
  it("marks its own scroll so the follower does not broadcast it back", () => {
    document.body.innerHTML = `
      <div id="scroller" style="overflow:auto;height:100px">
        <div id="inner" style="height:500px">tall</div>
      </div>
    `;
    const scroller = document.getElementById("scroller") as HTMLElement;
    Object.defineProperty(scroller, "scrollHeight", { value: 500, configurable: true });
    Object.defineProperty(scroller, "clientHeight", { value: 100, configurable: true });
    let top = 0;
    Object.defineProperty(scroller, "scrollTop", {
      get: () => top,
      set: (v: number) => { top = v; },
      configurable: true,
    });
    (scroller as unknown as { scrollTo: (o: ScrollToOptions) => void }).scrollTo = (o) => { top = o.top ?? top; };
    vi.spyOn(window, "getComputedStyle").mockImplementation((el) =>
      (el === scroller
        ? { overflowY: "auto", overflowX: "visible" }
        : { overflowY: "visible", overflowX: "visible" }) as CSSStyleDeclaration,
    );

    // useCollab 在 window 與 document 上各掛一個 capture handler，同一個事件會被判斷兩次；
    // 兩次都必須擋，否則被擋掉的那一次會從另一個 handler 原封不動送出去。
    const skipped: boolean[] = [];
    scroller.addEventListener("scroll", (ev) => {
      skipped.length = 0;
      skipped.push(shouldSkipCollabScrollBroadcast(ev), shouldSkipCollabScrollBroadcast(ev));
    });

    applyScrollDeltaY(document.getElementById("inner"), 40);
    scroller.dispatchEvent(new Event("scroll"));
    expect(skipped).toEqual([true, true]);

    // 使用者自己捲的下一次事件照送
    top = 120;
    scroller.dispatchEvent(new Event("scroll"));
    expect(skipped).toEqual([false, false]);
  });
});

describe("applyMirrorViewportLock extreme", () => {
  const root = document.documentElement;

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    delete (Element.prototype as Partial<Element>).scrollTo;
    for (const prop of ["scrollHeight", "clientHeight", "scrollTop"]) {
      if (Object.prototype.hasOwnProperty.call(root, prop)) delete (root as unknown as Record<string, unknown>)[prop];
    }
    if (Object.prototype.hasOwnProperty.call(document, "scrollingElement")) {
      delete (document as unknown as Record<string, unknown>).scrollingElement;
    }
  });

  /**
   * 讓 jsdom 的根捲動元素「吃得下 delta」：沒有版面配置的 jsdom 裡 document.scrollingElement 是 null、
   * scrollHeight 恆為 0，真實瀏覽器則是「一定吃得下」——不補這些，測到的會是永遠走不到的退路分支。
   * 順便補上 jsdom 沒有實作的 Element.prototype.scrollTo。
   */
  function mockRootScroller(): { scrollTo: ReturnType<typeof vi.fn>; get top(): number } {
    let top = 0;
    Object.defineProperty(document, "scrollingElement", { get: () => root, configurable: true });
    Object.defineProperty(root, "scrollHeight", { value: 5000, configurable: true });
    Object.defineProperty(root, "clientHeight", { value: 800, configurable: true });
    Object.defineProperty(root, "scrollTop", {
      get: () => top,
      set: (v: number) => { top = v; },
      configurable: true,
    });
    const scrollTo = vi.fn(function scrollToStub(this: Element, o: ScrollToOptions) {
      if (this === root && typeof o.top === "number") top = o.top;
    });
    (Element.prototype as Partial<Element>).scrollTo = scrollTo as unknown as Element["scrollTo"];
    return { scrollTo, get top() { return top; } };
  }

  // 真實瀏覽器永遠走不到 window.scrollBy 那條退路（scrollingElement 一定吃得下 delta），
  // 所以要驗的是 scrollTo({behavior:"instant"})：直接寫 scrollTop（或 behavior:"auto"，規格上
  // 就是「照 computed 的 scroll-behavior 走」）會繼承 html{scroll-behavior:smooth}，
  // 殘差校正就會量到動畫中途值。
  it("locks anchor point to peer vy via scrollTo with behavior instant", () => {
    document.body.innerHTML = `<div id="lock" data-fb="卡"></div>`;
    const el = document.getElementById("lock")!;
    // 量到 top 200、ay 0.5 → 250；目標 vy 0.25 * 800 = 200；delta 50
    vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
      left: 0, top: 200, width: 100, height: 100, right: 100, bottom: 300, x: 0, y: 200, toJSON: () => ({}),
    });
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(800);
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(1200);
    const scrollBy = vi.spyOn(window, "scrollBy").mockImplementation(() => {});
    const rootScroller = mockRootScroller();

    const moved = applyMirrorViewportLock(
      { x: 0, y: 0, anchor: "#lock", ax: 0.5, ay: 0.5, vy: 0.25 },
      null,
    );

    expect(moved).toBe(true);
    expect(rootScroller.scrollTo).toHaveBeenCalledWith({ top: 50, behavior: "instant" });
    expect(scrollBy).not.toHaveBeenCalled();
  });

  // 2px 的容忍度在有 subpixel 佈局的頁面上會讓殘差每個封包正負來回、永不收斂。
  it("holds still until two residuals agree on a direction", () => {
    document.body.innerHTML = `<div id="lock" data-fb="卡"></div>`;
    const el = document.getElementById("lock")!;
    const rect = (top: number) => ({
      left: 0, top, width: 100, height: 100, right: 100, bottom: top + 100, x: 0, y: top, toJSON: () => ({}),
    });
    const getRect = vi.spyOn(el, "getBoundingClientRect");
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(800);
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(1200);
    vi.spyOn(window, "scrollBy").mockImplementation(() => {});
    const rootScroller = mockRootScroller();
    const cursor = { x: 0, y: 0, anchor: "#lock", ax: 0.5, ay: 0.5, vy: 0.25 };
    // 目標＝0.25 * 800 = 200；量到的錨點中心＝rect.top + 50

    // 大幅落差（≥24px）不等第二次確認：對方跳到別的錨點時晚一個封包會很明顯
    getRect.mockReturnValue(rect(200)); // 殘差 +50
    expect(applyMirrorViewportLock(cursor, null, createMirrorLockState())).toBe(true);
    expect(rootScroller.scrollTo).toHaveBeenCalled();

    const state = createMirrorLockState();
    rootScroller.scrollTo.mockClear();

    getRect.mockReturnValue(rect(160)); // 殘差 +10：第一次只記方向
    expect(applyMirrorViewportLock(cursor, null, state)).toBe(false);
    getRect.mockReturnValue(rect(140)); // 殘差 -10：換號＝抖動，照樣不動
    expect(applyMirrorViewportLock(cursor, null, state)).toBe(false);
    expect(rootScroller.scrollTo).not.toHaveBeenCalled();

    expect(applyMirrorViewportLock(cursor, null, state)).toBe(true); // -10 連續兩次同號才修
    expect(rootScroller.scrollTo).toHaveBeenCalled();
  });

  /**
   * 本站 html 是 overflow-x:clip，根元素橫向根本捲不動，而水平鎖定幾乎每個封包都會走到那條退路。
   * 無條件記一筆「預期 scrollLeft＝現在的 scrollLeft」的帳，永遠等不到對應的 scroll 事件來消耗，
   * 之後（包含退出鏡像後）使用者第一次真實捲動就會被誤判成程式化捲動而不廣播出去。
   */
  it("books no phantom entry when nothing can scroll sideways", () => {
    document.body.innerHTML = `<div id="lock" data-fb="卡"></div>`;
    const el = document.getElementById("lock")!;
    // 垂直刻意零殘差（250 = 0.3125 * 800），這樣只驗得到水平那條路
    vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
      left: 650, top: 200, width: 100, height: 100, right: 750, bottom: 300, x: 650, y: 200, toJSON: () => ({}),
    });
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(800);
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(1200);
    vi.spyOn(window, "scrollBy").mockImplementation(() => {});
    mockRootScroller(); // 縱向捲得動；橫向 scrollWidth 是 jsdom 預設的 0＝捲不動

    applyMirrorViewportLock(
      { x: 0, y: 0, anchor: "#lock", ax: 0.5, ay: 0.5, vy: 0.3125, vx: 0 },
      null,
      createMirrorLockState(),
    );

    const ev = new Event("scroll");
    Object.defineProperty(ev, "target", { value: document });
    expect(shouldSkipCollabScrollBroadcast(ev)).toBe(false);
  });

  /**
   * 對方的游標停在橫向可捲的容器裡時，水平那一捲會把「有沒有動過」點亮；
   * 殘差回合若跟著它跑，上面被死區刻意擋下的垂直殘差就會被純 epsilon 修掉——死區等於沒加。
   */
  it("keeps the vertical dead zone even when the sideways pass scrolled", () => {
    document.body.innerHTML = `<div id="hscroll"><div id="lock" data-fb="卡"></div></div>`;
    const box = document.getElementById("hscroll") as HTMLElement;
    const el = document.getElementById("lock")!;
    Object.defineProperty(box, "scrollWidth", { value: 2000, configurable: true });
    Object.defineProperty(box, "clientWidth", { value: 500, configurable: true });
    let left = 0;
    Object.defineProperty(box, "scrollLeft", {
      get: () => left,
      set: (v: number) => { left = v; },
      configurable: true,
    });
    // 垂直殘差 +10：≥ epsilon（6）但 < snap（24），死區要求連續兩次同號，這一次不該動
    vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
      left: 650, top: 160, width: 100, height: 100, right: 750, bottom: 260, x: 650, y: 160, toJSON: () => ({}),
    });
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(800);
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(1200);
    vi.spyOn(window, "scrollBy").mockImplementation(() => {});
    vi.spyOn(window, "getComputedStyle").mockImplementation((node) =>
      (node === box
        ? { overflowX: "auto", overflowY: "visible" }
        : { overflowX: "visible", overflowY: "visible" }) as CSSStyleDeclaration,
    );
    const rootScroller = mockRootScroller();
    (box as unknown as { scrollTo: (o: ScrollToOptions) => void }).scrollTo = (o) => {
      if (typeof o.left === "number") left = o.left;
    };

    applyMirrorViewportLock(
      { x: 0, y: 0, anchor: "#lock", ax: 0.5, ay: 0.5, vy: 0.25, vx: 0 },
      null,
      createMirrorLockState(),
    );

    expect(left).toBeGreaterThan(0); // 水平確實捲了
    expect(rootScroller.top).toBe(0); // 垂直一動也沒動
  });

  it("opens details before locking", () => {
    document.body.innerHTML = `
      <details id="d"><summary>s</summary>
        <div id="lock" data-fb="卡"></div>
      </details>
    `;
    const el = document.getElementById("lock")!;
    vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
      left: 0, top: 400, width: 50, height: 50, right: 50, bottom: 450, x: 0, y: 400, toJSON: () => ({}),
    });
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(800);
    vi.spyOn(window, "scrollBy").mockImplementation(() => {});
    vi.spyOn(window, "scrollY", "get").mockReturnValue(0);
    applyMirrorViewportLock({ x: 0, y: 0, anchor: "#lock", ax: 0, ay: 0, vy: 0.2 }, null);
    expect((document.getElementById("d") as HTMLDetailsElement).open).toBe(true);
  });
});

describe("updatePacketIntervalEma", () => {
  it("tracks the measured arrival interval", () => {
    // 初值 32ms，實際每 60ms 到一次 → 平均值要往 60 靠，預測才補得滿這段空窗
    let ema = 32;
    for (let i = 0; i < 20; i += 1) ema = updatePacketIntervalEma(ema, 60);
    expect(ema).toBeGreaterThan(55);
    expect(ema).toBeLessThanOrEqual(60);
  });

  it("ignores intervals outside the trustworthy window", () => {
    // 分頁被凍結／網路卡頓送來的離譜間隔不能污染平均值
    expect(updatePacketIntervalEma(40, 5_000)).toBe(40);
    expect(updatePacketIntervalEma(40, 1)).toBe(40);
    expect(updatePacketIntervalEma(40, Number.NaN)).toBe(40);
  });
});

describe("useCollabMirrorFollow root class", () => {
  afterEach(() => {
    document.documentElement.classList.remove(COLLAB_MIRRORING_CLASS);
  });

  // class 殘留會**永久**停用全站的平滑捲動與 .gen-row 的離屏繪製最佳化，
  // 所以每一條離開路徑（切模式、跟隨對象消失、元件卸載）都必須把它卸掉。
  it("adds the class while mirroring and removes it on every exit path", () => {
    const cursors = new Map();
    type Props = { mode: CollabViewMode; follow: string | null };
    const view = renderHook(
      ({ mode, follow }: Props) => useCollabMirrorFollow(mode, follow, cursors, {}),
      { initialProps: { mode: "mirror", follow: "a" } as Props },
    );
    expect(document.documentElement.classList.contains(COLLAB_MIRRORING_CLASS)).toBe(true);

    view.rerender({ mode: "live", follow: "a" });
    expect(document.documentElement.classList.contains(COLLAB_MIRRORING_CLASS)).toBe(false);

    // 跟隨對象離線 → followUserId 歸零，一樣要卸掉
    view.rerender({ mode: "mirror", follow: "a" });
    expect(document.documentElement.classList.contains(COLLAB_MIRRORING_CLASS)).toBe(true);
    view.rerender({ mode: "mirror", follow: null });
    expect(document.documentElement.classList.contains(COLLAB_MIRRORING_CLASS)).toBe(false);

    view.rerender({ mode: "mirror", follow: "a" });
    view.unmount();
    expect(document.documentElement.classList.contains(COLLAB_MIRRORING_CLASS)).toBe(false);
  });
});
