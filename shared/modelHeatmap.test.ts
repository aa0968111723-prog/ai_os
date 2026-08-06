import { describe, expect, it } from "vitest";
import { buildHeatmapContext, heatmapCell, HEATMAP_METRICS, rowAverage, type HeatmapRow } from "./modelHeatmap";

/**
 * 熱力圖分數的守門測試。
 *
 * 熱力圖最容易說謊的地方是「沒有資料的格子」：把未公開的窗口塗成淺色，
 * 讀圖的人會以為那顆模型窗口很短。所以 null 與 0 分的界線是這裡最重要的斷言。
 */

const base: HeatmapRow = { id: "m", points: 10, verified: true };

const rows: HeatmapRow[] = [
  { id: "cheap", points: 1, verified: true, health: "live_ok", textEncoderLimit: 512, supportsNegativePrompt: true, supportsSeed: true },
  { id: "mid", points: 30, verified: false, health: "never_probed", textEncoderLimit: 77, supportsNegativePrompt: false, supportsSeed: false },
  { id: "dear", points: 300, verified: true, health: "openapi_404" },
];
const ctx = buildHeatmapContext(rows);

describe("heatmapCell", () => {
  it("便宜的模型在「省點數」得高分，貴的得低分", () => {
    const cheap = heatmapCell("cost", rows[0], ctx);
    const dear = heatmapCell("cost", rows[2], ctx);
    expect(cheap.score).toBeGreaterThan(dear.score!);
    expect(cheap.display).toBe("1 點/次");
  });

  it("未公開的文字窗口是「沒有資料」，不是 0 分", () => {
    const cell = heatmapCell("window", { ...base, textEncoderLimit: null }, ctx);
    expect(cell.score).toBeNull();
    expect(cell.display).toContain("未公開");
    // 有數字時才給分，且長窗口分數更高
    expect(heatmapCell("window", { ...base, textEncoderLimit: 512 }, ctx).score).toBeGreaterThan(
      heatmapCell("window", { ...base, textEncoderLimit: 77 }, ctx).score!,
    );
  });

  it("可控性依兩顆旋鈕給分；兩顆都沒有契約資料時不給分", () => {
    expect(heatmapCell("control", { ...base, supportsNegativePrompt: true, supportsSeed: true }, ctx).score).toBe(1);
    expect(heatmapCell("control", { ...base, supportsNegativePrompt: true, supportsSeed: false }, ctx).score).toBe(0.5);
    // 明確查證過「兩顆都沒有」＝0 分（不是沒資料）
    const none = heatmapCell("control", { ...base, supportsNegativePrompt: false, supportsSeed: false }, ctx);
    expect(none.score).toBe(0);
    expect(none.display).toContain("都沒有");
    expect(heatmapCell("control", base, ctx).score).toBeNull();
  });

  it("端點異常是 0 分，未實測是沒有資料——兩者不可混為一談", () => {
    expect(heatmapCell("health", { ...base, health: "openapi_404" }, ctx).score).toBe(0);
    expect(heatmapCell("health", { ...base, health: "never_probed" }, ctx).score).toBeNull();
    expect(heatmapCell("health", { ...base, health: "live_ok" }, ctx).score).toBe(1);
  });

  it("沒跑過的模型，實測欄一律空白（不是 0 分）", () => {
    for (const metric of HEATMAP_METRICS.filter((m) => m.source === "live")) {
      const cell = heatmapCell(metric.id, base, ctx);
      expect(cell.score, metric.id).toBeNull();
      expect(cell.display, metric.id).toContain("還沒");
    }
  });

  it("成功率與速度取自使用者自己的紀錄", () => {
    const row: HeatmapRow = { ...base, usage: { submits: 4, done: 3, failed: 1, avgSeconds: 12 } };
    const rate = heatmapCell("successRate", row, ctx);
    expect(rate.score).toBeCloseTo(0.75);
    expect(rate.display).toBe("75%（3/4）");

    const timed = buildHeatmapContext([
      { ...base, id: "fast", usage: { submits: 1, done: 1, failed: 0, avgSeconds: 5 } },
      { ...base, id: "slow", usage: { submits: 1, done: 1, failed: 0, avgSeconds: 500 } },
    ]);
    const fast = heatmapCell("speed", { ...base, usage: { submits: 1, done: 1, failed: 0, avgSeconds: 5 } }, timed);
    const slow = heatmapCell("speed", { ...base, usage: { submits: 1, done: 1, failed: 0, avgSeconds: 500 } }, timed);
    expect(fast.score).toBeGreaterThan(slow.score!);
    expect(fast.display).toBe("平均 5 秒");
  });

  it("不認得的指標不會意外給分", () => {
    expect(heatmapCell("nope", base, ctx)).toEqual({ score: null, display: "—" });
  });
});

describe("rowAverage", () => {
  const ids = HEATMAP_METRICS.map((m) => m.id);

  it("只平均有資料的格子，缺資料不當 0 分拉低平均", () => {
    // 這一列只有「已查證」有資料：平均應該就是那一格，而不是被七個 null 稀釋成 1/8
    const only = rowAverage({ id: "x", points: 0, verified: true }, ["verified", "window", "control"], ctx);
    expect(only).toBe(1);
  });

  it("全部沒有資料時回 null，不會謊報一個 0 分", () => {
    expect(rowAverage({ id: "x", points: 0, verified: true }, ["window", "control", "successRate"], ctx)).toBeNull();
  });

  it("條件較好的模型綜合分較高（排序用）", () => {
    const strong = rowAverage(rows[0], ids, ctx);
    const weak = rowAverage(rows[2], ids, ctx);
    expect(strong).not.toBeNull();
    expect(weak).not.toBeNull();
    expect(strong!).toBeGreaterThan(weak!);
  });
});
