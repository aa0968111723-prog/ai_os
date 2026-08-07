/**
 * 圖上標注的座標換算。
 *
 * 這支測試盯的是一種「不會有人回報」的錯：用元素 rect 而非 object-fit: contain 的
 * 內容框來算，所有標注會系統性偏移，但圓點畫得出來、點得到、存得進去——完全沒有症狀。
 * 所以這裡刻意用「長寬比不同」的組合當主要案例，那正是偏移會顯現的唯一條件。
 */
import { describe, expect, it } from "vitest";
import { containedBox, eventPointFromMedia, mediaPointFromEvent } from "./mediaPoint";

/** 16:9 的素材放進 400×400 的正方形元素框：上下各留 87.5px 白 */
const SQUARE_BOX = { left: 100, top: 50, width: 400, height: 400 };
const WIDE = { w: 1600, h: 900 };

describe("containedBox：contain 的內容框", () => {
  it("寬素材放進方框：寬度填滿、上下置中留白", () => {
    const inner = containedBox(SQUARE_BOX, WIDE)!;
    expect(inner.width).toBe(400);
    expect(inner.height).toBe(225); // 400 * 900/1600
    expect(inner.left).toBe(100);
    expect(inner.top).toBe(50 + (400 - 225) / 2);
  });

  it("長寬比相同時內容框＝元素框（沒有留白）", () => {
    const inner = containedBox({ left: 0, top: 0, width: 320, height: 180 }, WIDE)!;
    expect(inner).toEqual({ left: 0, top: 0, width: 320, height: 180 });
  });

  it("尚未載入（intrinsic 為 0）或元素尺寸為 0 一律回 null——不能拿它算出一個假座標", () => {
    expect(containedBox(SQUARE_BOX, { w: 0, h: 900 })).toBeNull();
    expect(containedBox(SQUARE_BOX, { w: 1600, h: 0 })).toBeNull();
    expect(containedBox({ left: 0, top: 0, width: 0, height: 400 }, WIDE)).toBeNull();
  });
});

describe("mediaPointFromEvent：點擊 → 比例座標", () => {
  it("點在內容框正中央＝(0.5, 0.5)", () => {
    const inner = containedBox(SQUARE_BOX, WIDE)!;
    const p = mediaPointFromEvent(SQUARE_BOX, WIDE, {
      clientX: inner.left + inner.width / 2,
      clientY: inner.top + inner.height / 2,
    })!;
    expect(p.ax).toBeCloseTo(0.5, 10);
    expect(p.ay).toBeCloseTo(0.5, 10);
  });

  /**
   * 這一條就是整支檔案的理由。
   * 用元素框算的話，元素正中央會被算成 (0.5, 0.5)——但那個位置在畫面上其實也是正中央，
   * 所以正中央測不出差異。要測就得測「非中央」的點：元素框上緣往下 1/4 處，
   * 在 contain 之下其實還在上方的 letterbox 留白裡，根本不在畫面上。
   */
  it("點在 letterbox 留白上回 null（用元素框算的話會誤判成畫面上緣）", () => {
    const p = mediaPointFromEvent(SQUARE_BOX, WIDE, {
      clientX: SQUARE_BOX.left + 200,
      clientY: SQUARE_BOX.top + 40, // 內容框從 top+87.5 才開始
    });
    expect(p).toBeNull();
  });

  it("同一個實際畫面位置，在不同元素框尺寸下換算出相同比例座標", () => {
    // 桌機：寬元素框；手機：矮元素框（styles.css 在 ≤900px 會把 max-height 降一級）
    const desktop = { left: 0, top: 0, width: 800, height: 800 };
    const mobile = { left: 0, top: 0, width: 360, height: 300 };
    const target = { ax: 0.25, ay: 0.75 };
    const onDesktop = eventPointFromMedia(desktop, WIDE, target)!;
    const onMobile = eventPointFromMedia(mobile, WIDE, target)!;
    expect(mediaPointFromEvent(desktop, WIDE, { clientX: onDesktop.x, clientY: onDesktop.y })!.ax).toBeCloseTo(0.25, 10);
    expect(mediaPointFromEvent(mobile, WIDE, { clientX: onMobile.x, clientY: onMobile.y })!.ay).toBeCloseTo(0.75, 10);
  });

  it("尚未載入時不收點（回 null，而不是收一個角落座標）", () => {
    expect(mediaPointFromEvent(SQUARE_BOX, { w: 0, h: 0 }, { clientX: 200, clientY: 200 })).toBeNull();
  });

  it("四個角落落在 0/1 邊界上，且仍算在畫面內", () => {
    const inner = containedBox(SQUARE_BOX, WIDE)!;
    const tl = mediaPointFromEvent(SQUARE_BOX, WIDE, { clientX: inner.left, clientY: inner.top })!;
    const br = mediaPointFromEvent(SQUARE_BOX, WIDE, {
      clientX: inner.left + inner.width,
      clientY: inner.top + inner.height,
    })!;
    expect(tl).toEqual({ ax: 0, ay: 0 });
    expect(br.ax).toBeCloseTo(1, 10);
    expect(br.ay).toBeCloseTo(1, 10);
  });
});

describe("正反向換算對稱", () => {
  it.each([
    ["寬素材配方框（上下留白）", SQUARE_BOX, WIDE],
    ["高素材配寬框（左右留白）", { left: 12, top: 34, width: 500, height: 300 }, { w: 1080, h: 1920 }],
    ["長寬比相同（無留白）", { left: 0, top: 0, width: 640, height: 360 }, WIDE],
  ])("%s：ax/ay → 座標 → ax/ay 誤差 < 1e-6", (_label, box, intrinsic) => {
    for (const point of [{ ax: 0, ay: 0 }, { ax: 0.13, ay: 0.87 }, { ax: 0.5, ay: 0.5 }, { ax: 1, ay: 1 }]) {
      const xy = eventPointFromMedia(box, intrinsic, point)!;
      const back = mediaPointFromEvent(box, intrinsic, { clientX: xy.x, clientY: xy.y })!;
      expect(back.ax).toBeCloseTo(point.ax, 6);
      expect(back.ay).toBeCloseTo(point.ay, 6);
    }
  });
});
