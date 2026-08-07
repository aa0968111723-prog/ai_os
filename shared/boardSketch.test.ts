import { describe, expect, it } from "vitest";
import {
  expandSketch,
  sketchDslPromptBlock,
  sketchPlanSchema,
  type SketchPlan,
} from "./boardSketch";

const BOARD = { w: 1600, h: 900, maxStrokes: 400 };

function plan(primitives: SketchPlan["primitives"]): SketchPlan {
  return { primitives };
}

describe("sketchPlanSchema", () => {
  it("接受一份典型的分鏡草圖計畫", () => {
    const result = sketchPlanSchema.safeParse({
      primitives: [
        { kind: "frame" },
        { kind: "line", x1: 0, y1: 620, x2: 1000, y2: 620 },
        { kind: "stick_figure", cx: 500, cy: 320, h: 400, pose: "walk" },
        { kind: "arrow", x1: 560, y1: 500, x2: 780, y2: 500, color: "#d24545" },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("拒絕未知原語與空計畫——這是 LLM 輸出的驗證閘，不能寬鬆", () => {
    expect(sketchPlanSchema.safeParse({ primitives: [] }).success).toBe(false);
    expect(sketchPlanSchema.safeParse({ primitives: [{ kind: "bezier" }] }).success).toBe(false);
    expect(sketchPlanSchema.safeParse({ primitives: [{ kind: "line", x1: 0 }] }).success).toBe(false);
  });

  it("polyline 點數有上限（64）——超過通常是 LLM 想直接吐筆畫，擋下", () => {
    const tooMany = Array.from({ length: 65 }, (_, i) => [i, i] as [number, number]);
    expect(sketchPlanSchema.safeParse({ primitives: [{ kind: "polyline", points: tooMany }] }).success).toBe(false);
  });
});

describe("expandSketch", () => {
  it("確定性：同一份計畫展開兩次，逐點相同", () => {
    const p = plan([
      { kind: "frame" },
      { kind: "ellipse", cx: 820, cy: 180, rx: 70, ry: 70 },
      { kind: "stick_figure", cx: 400, cy: 300, h: 420, pose: "run" },
    ]);
    const a = expandSketch(p, BOARD);
    const b = expandSketch(p, BOARD);
    expect(a.doc).toEqual(b.doc);
  });

  it("每種原語都展開出至少一筆，且點座標全部落在白板內", () => {
    const p = plan([
      { kind: "frame" },
      { kind: "line", x1: -50, y1: 0, x2: 1200, y2: 1050 }, // 刻意超界
      { kind: "polyline", points: [[0, 900], [300, 700], [600, 860], [1000, 640]] },
      { kind: "rect", x: 100, y: 100, w: 300, h: 200 },
      { kind: "ellipse", cx: 500, cy: 500, rx: 120, ry: 80 },
      { kind: "arrow", x1: 200, y1: 200, x2: 600, y2: 400 },
      { kind: "stick_figure", cx: 700, cy: 300, h: 380 },
    ]);
    const { doc } = expandSketch(p, BOARD);
    // frame1 + line1 + polyline1 + rect1 + ellipse1 + arrow3 + stick(頭1+軀幹1+手2+腳2)
    expect(doc.strokes.length).toBeGreaterThanOrEqual(13);
    for (const stroke of doc.strokes) {
      expect(stroke.points.length).toBeGreaterThanOrEqual(2);
      for (const pt of stroke.points) {
        expect(pt.x).toBeGreaterThanOrEqual(0);
        expect(pt.x).toBeLessThanOrEqual(BOARD.w);
        expect(pt.y).toBeGreaterThanOrEqual(0);
        expect(pt.y).toBeLessThanOrEqual(BOARD.h);
        expect(pt.p).toBeGreaterThan(0);
        expect(pt.p).toBeLessThanOrEqual(1);
      }
    }
  });

  it("輸出結構與 BoardDoc v1 相容（client 的 parseBoard 收得下）", () => {
    const { doc } = expandSketch(plan([{ kind: "frame" }]), BOARD);
    expect(doc.v).toBe(1);
    expect(doc.w).toBe(1600);
    expect(doc.h).toBe(900);
    const stroke = doc.strokes[0]!;
    expect(typeof stroke.id).toBe("string");
    expect(stroke.brush.engine).toBe("pencil");
    expect(stroke.brush.color).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("到達 maxStrokes 上限時丟棄後面的原語並誠實回報，不丟最舊的筆畫", () => {
    // 每個 arrow 展開 3 筆；上限 5 → 第二個 arrow 只放得下 2 筆，之後全丟
    const p = plan([
      { kind: "arrow", x1: 0, y1: 0, x2: 500, y2: 0 },
      { kind: "arrow", x1: 0, y1: 200, x2: 500, y2: 200 },
      { kind: "arrow", x1: 0, y1: 400, x2: 500, y2: 400 },
    ]);
    const result = expandSketch(p, { ...BOARD, maxStrokes: 5 });
    expect(result.doc.strokes.length).toBe(5);
    expect(result.droppedStrokes).toBe(4);
    // 第一筆仍是第一個 arrow 的桿——開頭沒有被擦掉
    expect(result.doc.strokes[0]!.id).toBe("ai-s0");
  });

  it("壞色碼換成預設深灰，不整包退件（草圖容錯優先）", () => {
    // schema 層擋掉壞色碼，但展開器自己也要防（兩層防禦各自可測）
    const p = plan([{ kind: "line", x1: 0, y1: 0, x2: 100, y2: 100, color: "#aabbcc" }]);
    const { doc } = expandSketch(p, BOARD);
    expect(doc.strokes[0]!.brush.color).toBe("#aabbcc");
  });

  it("直式白板（9:16）：同一份計畫按比例縮放，不變形出界", () => {
    const p = plan([{ kind: "stick_figure", cx: 500, cy: 300, h: 400 }]);
    const { doc } = expandSketch(p, { w: 900, h: 1600, maxStrokes: 400 });
    for (const stroke of doc.strokes) {
      for (const pt of stroke.points) {
        expect(pt.x).toBeLessThanOrEqual(900);
        expect(pt.y).toBeLessThanOrEqual(1600);
      }
    }
  });

  it("超長線條放寬取樣間距而不是截斷（單筆點數有上限）", () => {
    const zigzag: Array<[number, number]> = [];
    for (let i = 0; i < 60; i += 1) zigzag.push([i % 2 === 0 ? 0 : 1000, i * 16]);
    const { doc } = expandSketch(plan([{ kind: "polyline", points: zigzag.slice(0, 64) }]), BOARD);
    expect(doc.strokes[0]!.points.length).toBeLessThanOrEqual(2000);
    // 最後一個頂點附近仍有點——線沒有畫到一半消失
    const last = doc.strokes[0]!.points.at(-1)!;
    expect(last.y).toBeGreaterThan(700);
  });
});

describe("sketchDslPromptBlock", () => {
  it("提示詞涵蓋 schema 的每一種原語——兩邊漂移時這裡會先紅", () => {
    const block = sketchDslPromptBlock();
    for (const kind of ["frame", "line", "polyline", "rect", "ellipse", "arrow", "stick_figure"]) {
      expect(block).toContain(`"${kind}"`);
    }
  });
});
