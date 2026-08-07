import { describe, expect, it } from "vitest";
import { summarizeBoard } from "./boardSummary";
import type { BoardDoc, Stroke } from "./boardDoc";

const BRUSH: Stroke["brush"] = {
  id: "b", name: "鉛筆", engine: "pencil", size: 3, opacity: 0.7, pressure: 0.6, speed: 0.2, grain: 0.5, taper: 0.3, color: "#2b2b30",
};

function stroke(id: string, points: Array<[number, number]>): Stroke {
  return { id, brush: BRUSH, points: points.map(([x, y]) => ({ x, y, p: 0.5 })) };
}

function doc(strokes: Stroke[]): BoardDoc {
  return { v: 1, w: 1600, h: 900, strokes };
}

describe("summarizeBoard", () => {
  it("空白板：0 筆、九格全 0、沒有外框", () => {
    const s = summarizeBoard(doc([]));
    expect(s).toEqual({ strokeCount: 0, cells: new Array(9).fill(0), hasFrame: false });
  });

  it("內容集中在左上時，左上那格最滿（100）、遠處的格子是 0", () => {
    const pts: Array<[number, number]> = Array.from({ length: 40 }, (_, i) => [50 + i, 60 + i]);
    const s = summarizeBoard(doc([stroke("a", pts)]));
    expect(s.strokeCount).toBe(1);
    expect(s.cells[0]).toBe(100); // 左上
    expect(s.cells[8]).toBe(0); // 右下
    expect(s.hasFrame).toBe(false);
  });

  it("貼著白板繞一圈的大框判定為 hasFrame——AI 據此不再畫第二個 frame", () => {
    const frame = stroke("frame", [
      [30, 30], [1570, 30], [1570, 870], [30, 870], [30, 30],
    ]);
    expect(summarizeBoard(doc([frame])).hasFrame).toBe(true);
    // 佔不到八成的普通矩形不算外框
    const smallRect = stroke("rect", [[400, 300], [900, 300], [900, 600], [400, 600], [400, 300]]);
    expect(summarizeBoard(doc([smallRect])).hasFrame).toBe(false);
  });

  it("筆墨量是相對值（最滿的格子＝100），輸出全部落在 0-100", () => {
    const s = summarizeBoard(doc([
      stroke("a", Array.from({ length: 60 }, (_, i) => [100 + i, 100])),
      stroke("b", Array.from({ length: 10 }, (_, i) => [1400 + i, 800])),
    ]));
    expect(Math.max(...s.cells)).toBe(100);
    for (const v of s.cells) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });

  it("超長筆畫有取樣上限——摘要不能因為一筆兩千點就變慢", () => {
    const huge = stroke("huge", Array.from({ length: 2000 }, (_, i) => [i % 1600, (i * 7) % 900]));
    const started = Date.now();
    summarizeBoard(doc(Array.from({ length: 400 }, () => huge)));
    expect(Date.now() - started).toBeLessThan(500);
  });
});
