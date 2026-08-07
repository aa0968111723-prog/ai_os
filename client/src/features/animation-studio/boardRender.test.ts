import { describe, expect, it } from "vitest";
import { BUILTIN_BRUSHES, type BrushSpec } from "./brushes";
import { emptyBoard, type Stroke } from "./boardDoc";
import { hashUnit, renderBoard, renderPaper, renderStroke, withAlpha } from "./boardRender";

type Call = { op: string; args: unknown[] };

/** 假的 2D context：只記錄呼叫，讓「橡皮擦到底有沒有挖洞」這種事變成可斷言的 */
function fakeCtx() {
  const calls: Call[] = [];
  const state: Record<string, unknown> = {};
  const record = (op: string) => (...args: unknown[]) => { calls.push({ op, args }); };
  const ctx = {
    calls,
    state,
    save: record("save"),
    restore: record("restore"),
    beginPath: record("beginPath"),
    moveTo: record("moveTo"),
    lineTo: record("lineTo"),
    stroke: record("stroke"),
    fill: record("fill"),
    arc: record("arc"),
    fillRect: record("fillRect"),
    set globalCompositeOperation(v: string) { state.gco = v; calls.push({ op: "set:gco", args: [v] }); },
    get globalCompositeOperation() { return state.gco as string; },
    set strokeStyle(v: string) { state.strokeStyle = v; },
    get strokeStyle() { return state.strokeStyle as string; },
    set fillStyle(v: string) { state.fillStyle = v; },
    get fillStyle() { return state.fillStyle as string; },
    set lineWidth(v: number) { state.lineWidth = v; calls.push({ op: "set:lineWidth", args: [v] }); },
    get lineWidth() { return state.lineWidth as number; },
    set lineCap(v: string) { state.lineCap = v; },
    set lineJoin(v: string) { state.lineJoin = v; },
  };
  return ctx as unknown as CanvasRenderingContext2D & { calls: Call[]; state: Record<string, unknown> };
}

const VIEW = { scale: 1, offsetX: 0, offsetY: 0 };
const byId = (id: string) => BUILTIN_BRUSHES.find((b) => b.id === id)!;

function strokeWith(brush: BrushSpec, points = [{ x: 0, y: 0, p: 0.5 }, { x: 10, y: 0, p: 0.5 }, { x: 20, y: 0, p: 0.5 }]): Stroke {
  return { id: "stroke-1", brush, points };
}

describe("withAlpha", () => {
  it("轉成 rgba 並夾住 alpha", () => {
    expect(withAlpha("#ff8000", 0.5)).toBe("rgba(255, 128, 0, 0.5)");
    expect(withAlpha("#000000", 5)).toBe("rgba(0, 0, 0, 1)");
  });
});

describe("hashUnit", () => {
  it("同樣的種子永遠得到同一個值——顆粒不能在重繪時亂跳", () => {
    expect(hashUnit("abc", 7)).toBe(hashUnit("abc", 7));
    expect(hashUnit("abc", 7)).not.toBe(hashUnit("abc", 8));
    expect(hashUnit("abc", 7)).not.toBe(hashUnit("abd", 7));
  });

  it("落在 0–1", () => {
    for (let i = 0; i < 200; i += 1) {
      const v = hashUnit("seed", i);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe("renderStroke", () => {
  it("橡皮擦用 destination-out 挖掉像素（用白色蓋會蓋掉底下的參考圖）", () => {
    const ctx = fakeCtx();
    renderStroke(ctx, strokeWith(byId("builtin.eraser")), VIEW);
    expect(ctx.state.gco).toBe("destination-out");
  });

  it("麥克筆用 multiply，疊在一起會變深", () => {
    const ctx = fakeCtx();
    renderStroke(ctx, strokeWith(byId("builtin.marker")), VIEW);
    expect(ctx.state.gco).toBe("multiply");
  });

  it("一般筆刷是 source-over", () => {
    const ctx = fakeCtx();
    renderStroke(ctx, strokeWith(byId("builtin.pen")), VIEW);
    expect(ctx.state.gco).toBe("source-over");
  });

  it("點一下（只有一個點）畫得出一個圓點，不是什麼都沒有", () => {
    const ctx = fakeCtx();
    renderStroke(ctx, strokeWith(byId("builtin.pen"), [{ x: 4, y: 4, p: 0.5 }]), VIEW);
    expect(ctx.calls.some((c) => c.op === "arc")).toBe(true);
    expect(ctx.calls.some((c) => c.op === "fill")).toBe(true);
  });

  it("線寬跟著縮放走——放大後線條要一起變粗", () => {
    const widthAt = (scale: number) => {
      const ctx = fakeCtx();
      renderStroke(ctx, strokeWith(byId("builtin.pen")), { scale, offsetX: 0, offsetY: 0 });
      return ctx.calls.filter((c) => c.op === "set:lineWidth").map((c) => c.args[0] as number);
    };
    const one = widthAt(1);
    const two = widthAt(2);
    expect(one.length).toBeGreaterThan(0);
    expect(two[0]).toBeCloseTo(one[0]! * 2);
  });

  it("位移把筆畫搬到正確位置", () => {
    const ctx = fakeCtx();
    renderStroke(ctx, strokeWith(byId("builtin.pen")), { scale: 1, offsetX: 100, offsetY: 50 });
    const first = ctx.calls.find((c) => c.op === "moveTo")!;
    expect(first.args[0]).toBeCloseTo(100);
    expect(first.args[1]).toBeCloseTo(50);
  });

  it("噴槍沿路徑蓋章，畫出來的是散點不是線", () => {
    const ctx = fakeCtx();
    renderStroke(ctx, strokeWith(byId("builtin.spray")), VIEW);
    expect(ctx.calls.filter((c) => c.op === "arc").length).toBeGreaterThan(10);
    expect(ctx.calls.some((c) => c.op === "lineTo")).toBe(false);
  });

  it("同一筆畫重繪兩次結果完全一致（顆粒是決定性的）", () => {
    const run = () => {
      const ctx = fakeCtx();
      renderStroke(ctx, strokeWith(byId("builtin.pencil")), VIEW);
      return JSON.stringify(ctx.calls);
    };
    expect(run()).toBe(run());
  });

  it("空筆畫不畫任何東西", () => {
    const ctx = fakeCtx();
    renderStroke(ctx, strokeWith(byId("builtin.pen"), []), VIEW);
    expect(ctx.calls).toEqual([]);
  });

  it("每一筆都成對 save/restore，狀態不外洩到下一筆", () => {
    const ctx = fakeCtx();
    renderStroke(ctx, strokeWith(byId("builtin.eraser")), VIEW);
    expect(ctx.calls.filter((c) => c.op === "save")).toHaveLength(1);
    expect(ctx.calls.filter((c) => c.op === "restore")).toHaveLength(1);
    expect(ctx.calls[ctx.calls.length - 1].op).toBe("restore");
  });
});

describe("renderBoard / renderPaper", () => {
  it("整份白板按順序重畫", () => {
    const ctx = fakeCtx();
    const doc = { ...emptyBoard(100, 100), strokes: [strokeWith(byId("builtin.pen")), strokeWith(byId("builtin.marker"))] };
    renderBoard(ctx, doc, VIEW);
    const gco = ctx.calls.filter((c) => c.op === "set:gco").map((c) => c.args[0]);
    expect(gco).toEqual(["source-over", "multiply"]);
  });

  it("紙面依縮放填滿白板範圍", () => {
    const ctx = fakeCtx();
    renderPaper(ctx, emptyBoard(200, 100), { scale: 2, offsetX: 10, offsetY: 5 });
    const rect = ctx.calls.find((c) => c.op === "fillRect")!;
    expect(rect.args).toEqual([10, 5, 400, 200]);
  });
});
