import { describe, expect, it } from "vitest";
import {
  BRUSH_ENGINE_LABEL,
  BUILTIN_BRUSHES,
  DEFAULT_BRUSH_ID,
  findBrush,
  nextBrushId,
  normalizePressure,
  resamplePath,
  sanitizeBrush,
  sanitizeColor,
  smoothPoints,
  speedBetween,
  strokeWidthAt,
  taperFactor,
  type BrushSpec,
} from "./brushes";

const pen = BUILTIN_BRUSHES.find((b) => b.id === "builtin.pen")!;
const ink = BUILTIN_BRUSHES.find((b) => b.id === "builtin.ink")!;
const marker = BUILTIN_BRUSHES.find((b) => b.id === "builtin.marker")!;

describe("內建筆刷櫃", () => {
  it("每一支都是合法規格，且 id 不重複", () => {
    const ids = new Set(BUILTIN_BRUSHES.map((b) => b.id));
    expect(ids.size).toBe(BUILTIN_BRUSHES.length);
    for (const brush of BUILTIN_BRUSHES) {
      expect(sanitizeBrush(brush)).toEqual(brush);
      expect(brush.builtin).toBe(true);
      expect(BRUSH_ENGINE_LABEL[brush.engine]).toBeTruthy();
    }
  });

  it("預設筆刷存在——UI 沒有「沒有筆」這個狀態", () => {
    expect(BUILTIN_BRUSHES.some((b) => b.id === DEFAULT_BRUSH_ID)).toBe(true);
    expect(findBrush(BUILTIN_BRUSHES, "不存在的筆刷").id).toBe(DEFAULT_BRUSH_ID);
    expect(findBrush([], null).id).toBe(DEFAULT_BRUSH_ID);
  });
});

describe("sanitizeBrush", () => {
  it("把超出範圍的數值夾回範圍，不丟例外", () => {
    const brush = sanitizeBrush({ id: "x", name: "壞筆", engine: "pen", size: 9999, opacity: 5, pressure: -3, taper: 42 });
    expect(brush.size).toBe(160);
    expect(brush.opacity).toBe(1);
    expect(brush.pressure).toBe(0);
    expect(brush.taper).toBe(1);
  });

  it("認不得的筆尖種類退回原子筆，並用種類名當預設名稱", () => {
    const brush = sanitizeBrush({ engine: "雷射筆" });
    expect(brush.engine).toBe("pen");
    expect(brush.name).toBe(BRUSH_ENGINE_LABEL.pen);
  });

  it("完全壞掉的輸入也還得出一支可用的筆", () => {
    for (const bad of [null, undefined, 42, "筆", []]) {
      const brush = sanitizeBrush(bad);
      expect(brush.size).toBeGreaterThan(0);
      expect(brush.color).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe("sanitizeColor", () => {
  it("只接受十六進位色，短寫展開成六位", () => {
    expect(sanitizeColor("#ABCDEF")).toBe("#abcdef");
    expect(sanitizeColor("#f00")).toBe("#ff0000");
  });

  it("擋掉會讓 canvas 去外連或吃到 CSS 變數的值", () => {
    expect(sanitizeColor("url(https://evil.example/x.png)")).toBe("#16223b");
    expect(sanitizeColor("var(--primary)")).toBe("#16223b");
    expect(sanitizeColor(123)).toBe("#16223b");
  });
});

describe("normalizePressure", () => {
  it("沒有壓感的裝置回 0.5——壓力 0 會畫出看不見的一筆", () => {
    expect(normalizePressure(0, true)).toBe(0.5);
    expect(normalizePressure(0.5, false)).toBe(0.5);
    expect(normalizePressure(undefined, true)).toBe(0.5);
  });

  it("有壓感時照實回報並夾在 1 以內", () => {
    expect(normalizePressure(0.3, true)).toBe(0.3);
    expect(normalizePressure(2, true)).toBe(1);
  });
});

describe("strokeWidthAt", () => {
  it("壓力權重為 0 的筆刷，線寬不隨壓力變化", () => {
    const flat: BrushSpec = { ...pen, pressure: 0, speed: 0 };
    expect(strokeWidthAt(flat, 0.1)).toBeCloseTo(flat.size);
    expect(strokeWidthAt(flat, 1)).toBeCloseTo(flat.size);
  });

  it("毛筆輕壓比重壓細", () => {
    expect(strokeWidthAt(ink, 0.2)).toBeLessThan(strokeWidthAt(ink, 1));
  });

  it("速度越快越細（飛白），麥克筆不受速度影響", () => {
    expect(strokeWidthAt(ink, 0.6, 2)).toBeLessThan(strokeWidthAt(ink, 0.6, 0));
    expect(strokeWidthAt(marker, 0.6, 3)).toBeCloseTo(strokeWidthAt(marker, 0.6, 0));
  });

  it("永遠不會算出小於一個像素的隱形筆畫", () => {
    const hair: BrushSpec = { ...ink, size: 1 };
    expect(strokeWidthAt(hair, 0.001, 50)).toBeGreaterThanOrEqual(0.35);
  });
});

describe("taperFactor", () => {
  it("不收筆的筆刷全程係數為 1", () => {
    expect(taperFactor(marker, 9, 10)).toBe(1);
  });

  it("收筆只作用在尾段，且末點最細", () => {
    expect(taperFactor(ink, 0, 100)).toBe(1);
    expect(taperFactor(ink, 50, 100)).toBe(1);
    expect(taperFactor(ink, 99, 100)).toBeCloseTo(1 - ink.taper);
    expect(taperFactor(ink, 90, 100)).toBeGreaterThan(taperFactor(ink, 99, 100));
  });

  it("短筆畫也有收尾", () => {
    expect(taperFactor(ink, 2, 3)).toBeLessThan(1);
  });
});

describe("smoothPoints", () => {
  it("頭尾點保持原位——起點飄掉畫細節時會很明顯", () => {
    const raw = [
      { x: 0, y: 0, p: 0.5 },
      { x: 10, y: 30, p: 0.5 },
      { x: 20, y: 0, p: 0.5 },
    ];
    const out = smoothPoints(raw);
    expect(out[0]).toEqual(raw[0]);
    expect(out[out.length - 1]).toEqual(raw[raw.length - 1]);
    expect(out[1].y).toBeCloseTo(10);
  });

  it("兩點以下原樣回傳（複本，不共用參考）", () => {
    const raw = [{ x: 1, y: 2, p: 0.4 }];
    const out = smoothPoints(raw);
    expect(out).toEqual(raw);
    expect(out[0]).not.toBe(raw[0]);
  });
});

describe("resamplePath", () => {
  it("等距取樣：直線 100px、間距 10 會得到 11 個點", () => {
    const out = resamplePath([{ x: 0, y: 0, p: 1 }, { x: 100, y: 0, p: 1 }], 10);
    expect(out).toHaveLength(11);
    expect(out[5].x).toBeCloseTo(50);
  });

  it("壓力沿路徑內插", () => {
    const out = resamplePath([{ x: 0, y: 0, p: 0 }, { x: 10, y: 0, p: 1 }], 5);
    expect(out[1].p).toBeCloseTo(0.5);
  });

  it("重複點與空輸入不會無限迴圈", () => {
    expect(resamplePath([], 4)).toEqual([]);
    const dup = resamplePath([{ x: 3, y: 3, p: 1 }, { x: 3, y: 3, p: 1 }], 4);
    expect(dup).toHaveLength(1);
  });
});

describe("speedBetween", () => {
  it("時間差為 0 或倒退時回 0，不回無限大", () => {
    expect(speedBetween({ x: 0, y: 0, t: 10 }, { x: 50, y: 0, t: 10 })).toBe(0);
    expect(speedBetween({ x: 0, y: 0, t: 10 }, { x: 50, y: 0, t: 5 })).toBe(0);
  });

  it("距離除以時間", () => {
    expect(speedBetween({ x: 0, y: 0, t: 0 }, { x: 30, y: 40, t: 10 })).toBeCloseTo(5);
  });
});

describe("nextBrushId", () => {
  it("避開既有 id，同一批連存兩支不會撞號", () => {
    const existing = [sanitizeBrush({ id: "my.1" }), sanitizeBrush({ id: "my.2" })];
    const id = nextBrushId(existing);
    expect(existing.some((b) => b.id === id)).toBe(false);
    expect(nextBrushId([...existing, sanitizeBrush({ id })])).not.toBe(id);
  });
});
