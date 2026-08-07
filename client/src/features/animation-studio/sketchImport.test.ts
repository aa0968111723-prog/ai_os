import { describe, expect, it } from "vitest";
import { expandSketch } from "@shared/boardSketch";
import { boardDocFromSketch, clampSketchToCapacity } from "./sketchImport";
import type { BoardDoc } from "./boardDoc";

/**
 * 這支測試守的是整條真實管線：展開器輸出 → 轉換 → parseBoard → 可用的白板文件。
 * 第一版就是因為只斷言「形狀相容」、沒真的走 parseBoard，讓一個「整個功能
 * 靜默不動作」的 bug 通過了全部測試。
 */
describe("boardDocFromSketch", () => {
  it("展開器的輸出經轉換後 parseBoard 收得下，筆數與點數不失真", () => {
    const { doc: sketch } = expandSketch(
      {
        primitives: [
          { kind: "frame" },
          { kind: "stick_figure", cx: 500, cy: 300, h: 400, pose: "walk" },
          { kind: "arrow", x1: 200, y1: 700, x2: 700, y2: 700, color: "#d24545", pen: "marker" },
        ],
      },
      { w: 1600, h: 900, maxStrokes: 400 },
    );
    const board = boardDocFromSketch(sketch);
    expect(board).not.toBeNull();
    expect(board!.strokes.length).toBe(sketch.strokes.length);
    expect(board!.w).toBe(1600);
    // 筆刷經 sanitizeBrush 收斂但引擎與顏色要留下來
    const marker = board!.strokes.at(-3)!; // arrow 桿（frame1+頭1+軀幹1+手2+腳2 之後）
    expect(["pencil", "pen", "marker"]).toContain(marker.brush.engine);
    for (const stroke of board!.strokes) {
      expect(stroke.points.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("直式白板同樣過閘", () => {
    const { doc: sketch } = expandSketch(
      { primitives: [{ kind: "ellipse", cx: 500, cy: 400, rx: 200, ry: 150 }] },
      { w: 900, h: 1600, maxStrokes: 400 },
    );
    const board = boardDocFromSketch(sketch);
    expect(board).not.toBeNull();
    expect(board!.h).toBe(1600);
  });
});

describe("clampSketchToCapacity", () => {
  const doc = (n: number): BoardDoc => ({
    v: 1, w: 1600, h: 900,
    strokes: Array.from({ length: n }, (_, i) => ({
      id: `s${i}`,
      brush: { id: "b", name: "鉛筆", engine: "pencil" as const, size: 3, opacity: 0.7, pressure: 0.6, speed: 0.2, grain: 0.5, taper: 0.3, color: "#2b2b30" },
      points: [{ x: 0, y: 0, p: 0.5 }, { x: 10, y: 10, p: 0.5 }],
    })),
  });

  it("放得下就原樣通過", () => {
    const result = clampSketchToCapacity(doc(10), 100, 400);
    expect(result.clipped).toBe(0);
    expect(result.doc.strokes.length).toBe(10);
  });

  it("放不下時裁掉尾巴並回報數量——使用者已畫的筆一筆都不動", () => {
    // lite 白板上限 400、使用者已畫 380 筆、AI 畫了 50 筆 → 只放前 20 筆
    const result = clampSketchToCapacity(doc(50), 380, 400);
    expect(result.doc.strokes.length).toBe(20);
    expect(result.clipped).toBe(30);
    // 保留的是開頭（構圖框在前）不是結尾
    expect(result.doc.strokes[0]!.id).toBe("s0");
  });

  it("完全沒空間時裁到零筆——寧可不畫也不擠掉使用者的畫", () => {
    const result = clampSketchToCapacity(doc(10), 400, 400);
    expect(result.doc.strokes.length).toBe(0);
    expect(result.clipped).toBe(10);
  });
});
