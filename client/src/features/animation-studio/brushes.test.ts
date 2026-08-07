import { describe, expect, it } from "vitest";
import {
  applyPressureCurve,
  BRUSH_ENGINE_LABEL,
  BUILTIN_BRUSHES,
  DEFAULT_BRUSH_ID,
  findBrush,
  nextBrushId,
  normalizePressure,
  resamplePath,
  sanitizeBrush,
  sanitizeColor,
  simplifyStroke,
  smoothPoints,
  speedBetween,
  stabilizeNext,
  strokeWidthAt,
  taperFactor,
  tiltBoost,
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

describe("simplifyStroke", () => {
  it("共線的中間點被拿掉，端點永遠保留", () => {
    const line = Array.from({ length: 50 }, (_, i) => ({ x: i * 2, y: 0, p: 0.5 }));
    const out = simplifyStroke(line);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual(line[0]);
    expect(out[1]).toEqual(line[line.length - 1]);
  });

  it("轉角保留——抽稀不能把形狀改掉", () => {
    const corner = [
      { x: 0, y: 0, p: 0.5 },
      { x: 10, y: 0, p: 0.5 },
      { x: 20, y: 0, p: 0.5 },
      { x: 20, y: 20, p: 0.5 },
      { x: 20, y: 40, p: 0.5 },
    ];
    const out = simplifyStroke(corner);
    expect(out.map((p) => [p.x, p.y])).toEqual([[0, 0], [20, 0], [20, 40]]);
  });

  it("真實塗鴉可以少掉一半以上的點（體積與重畫成本都跟著降）", () => {
    // 手抖但整體平順的一筆：取樣密、位移小
    const scribble = Array.from({ length: 400 }, (_, i) => ({
      x: i * 0.9 + Math.sin(i / 9) * 0.4,
      y: Math.sin(i / 30) * 60,
      p: 0.5,
    }));
    const out = simplifyStroke(scribble);
    expect(out.length).toBeLessThan(scribble.length / 2);
    // 形狀仍在：每個保留點都還在原始路徑上
    expect(out[0]).toEqual(scribble[0]);
    expect(out[out.length - 1]).toEqual(scribble[scribble.length - 1]);
  });

  it("壓力跟著保留點走（線寬的來源不能被平均掉）", () => {
    const pts = [
      { x: 0, y: 0, p: 0.1 },
      { x: 10, y: 30, p: 0.9 },
      { x: 20, y: 0, p: 0.2 },
    ];
    const out = simplifyStroke(pts);
    expect(out.find((p) => p.x === 10)?.p).toBe(0.9);
  });

  it("兩點以下原樣回傳（複本）", () => {
    const one = [{ x: 1, y: 2, p: 0.3 }];
    expect(simplifyStroke(one)).toEqual(one);
    expect(simplifyStroke(one)[0]).not.toBe(one[0]);
    expect(simplifyStroke([])).toEqual([]);
  });

  it("起訖同點的圈狀筆畫不會被壓成一個點", () => {
    const loop = [
      { x: 0, y: 0, p: 0.5 },
      { x: 30, y: 30, p: 0.5 },
      { x: 0, y: 0, p: 0.5 },
    ];
    expect(simplifyStroke(loop)).toHaveLength(3);
  });

  it("一萬個點也不會爆堆疊（長筆畫用迭代不用遞迴）", () => {
    const long = Array.from({ length: 10_000 }, (_, i) => ({ x: i, y: (i % 7) * 3, p: 0.5 }));
    expect(() => simplifyStroke(long)).not.toThrow();
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

describe("stabilizeNext（線條穩定器）", () => {
  it("strength 0 或沒有前一點：原樣通過", () => {
    const raw = { x: 100, y: 50, p: 0.8 };
    expect(stabilizeNext(null, raw, 1)).toEqual(raw);
    expect(stabilizeNext({ x: 0, y: 0, p: 0.5 }, raw, 0)).toEqual(raw);
  });

  it("強度越高，新點越貼近前一點（抖動被吸收）", () => {
    const prev = { x: 0, y: 0, p: 0.5 };
    const raw = { x: 100, y: 0, p: 0.5 };
    const soft = stabilizeNext(prev, raw, 0.3);
    const hard = stabilizeNext(prev, raw, 1);
    expect(hard.x).toBeLessThan(soft.x);
    expect(hard.x).toBeGreaterThan(0); // 最強也還在走，不會「筆停住」
  });

  it("壓力一起平滑——位置穩了、線寬還在跳，看起來仍是抖的", () => {
    const out = stabilizeNext({ x: 0, y: 0, p: 0.2 }, { x: 10, y: 0, p: 1 }, 1);
    expect(out.p).toBeGreaterThan(0.2);
    expect(out.p).toBeLessThan(0.5);
  });
});

describe("tiltBoost（手寫板側鋒）", () => {
  it("沒傾斜不加壓；筆桿放倒最多補 0.25，且封頂在 1", () => {
    expect(tiltBoost(0.5, 0, 0)).toBe(0.5);
    expect(tiltBoost(0.5, undefined, undefined)).toBe(0.5);
    expect(tiltBoost(0.5, 60, 0)).toBeCloseTo(0.75, 5);
    expect(tiltBoost(0.9, 90, 90)).toBe(1);
  });

  it("45° 以上就算完全放倒（側鋒是輔助，曲線平緩）", () => {
    expect(tiltBoost(0.4, 45, 0)).toBeCloseTo(0.65, 5);
    expect(tiltBoost(0.4, 80, 0)).toBeCloseTo(0.65, 5);
  });
});

describe("applyPressureCurve（筆壓曲線校正）", () => {
  it("端點不動：0 還是 0、1 還是 1（校正只改中段反應）", () => {
    for (const curve of ["soft", "normal", "firm"] as const) {
      expect(applyPressureCurve(0, curve)).toBe(0);
      expect(applyPressureCurve(1, curve)).toBe(1);
    }
  });

  it("軟＝輕觸就出粗線（中段變高）、硬＝用力才變粗（中段變低）", () => {
    const mid = 0.5;
    expect(applyPressureCurve(mid, "soft")).toBeGreaterThan(mid);
    expect(applyPressureCurve(mid, "normal")).toBe(mid);
    expect(applyPressureCurve(mid, "firm")).toBeLessThan(mid);
  });

  it("超界輸入夾回 0-1，不會算出負線寬", () => {
    expect(applyPressureCurve(-1, "soft")).toBe(0);
    expect(applyPressureCurve(2, "firm")).toBe(1);
  });
});
