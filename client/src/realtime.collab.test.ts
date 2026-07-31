import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyMirrorViewportLock,
  applyScrollDeltaY,
  caretRatioFromElement,
  collabAnchorFromElement,
  cursorViewportPoint,
  ensureAnchorExpanded,
  extrapolateCursorPose,
  findCollabAnchorElement,
  followablePeers,
  listScrollParents,
  refineAnchorRatiosWithCaret,
  zoneOfPeer,
  type CollabPeer,
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
});

describe("applyMirrorViewportLock extreme", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("locks anchor point to peer vy with double-pass scrollBy", () => {
    document.body.innerHTML = `<div id="lock" data-fb="卡"></div>`;
    const el = document.getElementById("lock")!;
    // First measure: top 200, ay 0.5 → 250; target vy 0.25 * 800 = 200; delta 50
    // After scroll, second measure still returns same mock (jsdom) — still exercises path
    vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
      left: 0, top: 200, width: 100, height: 100, right: 100, bottom: 300, x: 0, y: 200, toJSON: () => ({}),
    });
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(800);
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(1200);
    const scrollBy = vi.spyOn(window, "scrollBy").mockImplementation(() => {});
    vi.spyOn(window, "scrollY", "get").mockReturnValue(0);
    const moved = applyMirrorViewportLock(
      { x: 0, y: 0, anchor: "#lock", ax: 0.5, ay: 0.5, vy: 0.25 },
      null,
    );
    expect(moved).toBe(true);
    expect(scrollBy).toHaveBeenCalled();
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
