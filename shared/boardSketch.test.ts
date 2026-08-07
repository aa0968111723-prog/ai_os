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

  it("curve 至少 3 個控制點（2 點沒有東西可平滑，該用 line）", () => {
    expect(sketchPlanSchema.safeParse({
      primitives: [{ kind: "curve", points: [[0, 500], [300, 300], [700, 520]] }],
    }).success).toBe(true);
    expect(sketchPlanSchema.safeParse({
      primitives: [{ kind: "curve", points: [[0, 500], [300, 300]] }],
    }).success).toBe(false);
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
      { kind: "curve", points: [[0, 520], [250, 380], [520, 500], [1000, 420]] },
      { kind: "rect", x: 100, y: 100, w: 300, h: 200 },
      { kind: "ellipse", cx: 500, cy: 500, rx: 120, ry: 80 },
      { kind: "arrow", x1: 200, y1: 200, x2: 600, y2: 400 },
      { kind: "stick_figure", cx: 700, cy: 300, h: 380 },
    ]);
    const { doc } = expandSketch(p, BOARD);
    // frame1 + line1 + polyline1 + curve1 + rect1 + ellipse1 + arrow3 + stick(頭1+軀幹1+手2+腳2+腳掌2)
    expect(doc.strokes.length).toBeGreaterThanOrEqual(14);
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
    // schema 層會擋掉壞色碼，但展開器是獨立入口（呼叫端可能繞過 schema）——
    // 第二層防禦要真的餵壞值才算有測到
    const bad = plan([{ kind: "line", x1: 0, y1: 0, x2: 100, y2: 100, color: "red" as never }]);
    expect(expandSketch(bad, BOARD).doc.strokes[0]!.brush.color).toBe("#2b2b30");
    const good = plan([{ kind: "line", x1: 0, y1: 0, x2: 100, y2: 100, color: "#AABBCC" }]);
    expect(expandSketch(good, BOARD).doc.strokes[0]!.brush.color).toBe("#aabbcc");
  });

  it("巨大尺寸被 schema 退件；展開器對繞過 schema 的大橢圓也有取樣上限（同步迴圈不可卡死）", () => {
    expect(sketchPlanSchema.safeParse({
      primitives: [{ kind: "ellipse", cx: 500, cy: 500, rx: 999999, ry: 999999 }],
    }).success).toBe(false);
    // 直接呼叫展開器（繞過 schema）：取樣數封頂，毫秒級完成而不是百萬點迴圈
    const started = Date.now();
    const { doc } = expandSketch(
      { primitives: [{ kind: "ellipse", cx: 500, cy: 500, rx: 4000, ry: 4000 }] },
      BOARD,
    );
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(doc.strokes[0]!.points.length).toBeLessThanOrEqual(2000);
  });

  it("curve 真的有平滑：展開出的頂點比控制點密，而且全部在白板內", () => {
    const control: Array<[number, number]> = [[0, 500], [300, 250], [600, 550], [1000, 400]];
    const { doc } = expandSketch(plan([{ kind: "curve", points: control }]), BOARD);
    const stroke = doc.strokes[0]!;
    // 3 段 × 至少 4 步取樣 ≫ 4 個控制點——不是把控制點直接連起來
    expect(stroke.points.length).toBeGreaterThan(control.length * 4);
    for (const pt of stroke.points) {
      expect(pt.x).toBeGreaterThanOrEqual(0);
      expect(pt.x).toBeLessThanOrEqual(BOARD.w);
      expect(pt.y).toBeGreaterThanOrEqual(0);
      expect(pt.y).toBeLessThanOrEqual(BOARD.h);
    }
  });

  it("站姿火柴人有腳掌短撇（站在地上，不是懸空）", () => {
    const withFeet = expandSketch(plan([{ kind: "stick_figure", cx: 500, cy: 300, h: 400, pose: "stand" }]), BOARD);
    // 頭1＋軀幹1＋手2＋腳2＋腳掌2
    expect(withFeet.doc.strokes.length).toBe(8);
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
    for (const kind of ["frame", "line", "polyline", "curve", "rect", "ellipse", "arrow", "stick_figure"]) {
      expect(block).toContain(`"${kind}"`);
    }
  });

  it("提示詞帶著構圖與對齊要求——精準度的關鍵指令不能在改版時默默消失", () => {
    const block = sketchDslPromptBlock();
    expect(block).toContain("對齊");
    expect(block).toContain("主體要夠大");
    expect(block).toContain("多個原語組合");
  });
});
