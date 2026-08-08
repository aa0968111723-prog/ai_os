/**
 * 工具列規則測試。這些規則錯了的症狀都很難從畫面上看出來：
 * 選了橡皮擦卻還在畫、切到 AI 把使用者的筆換掉、導覽模式下白板仍然吃筆——
 * 全是「使用者以為自己手殘」的那種 bug，所以規則抽成純函式逐條鎖住。
 */
import { describe, it, expect } from "vitest";
import {
  STUDIO_TOOLS,
  PLANNED_TOOLS,
  FRAME_GUIDES,
  DEFAULT_GUIDES,
  DEFAULT_PANELS,
  TIMELINE_HEIGHT,
  SAFE_AREA,
  brushIdFor,
  clampTimelineHeight,
  optionsKindFor,
  panModeFor,
  toggleGuide,
  toolForBrushId,
} from "./studioTools";

describe("STUDIO_TOOLS", () => {
  it("只列真的做得到的工具——假工具比少一個工具更傷專業感", () => {
    expect(STUDIO_TOOLS.map((t) => t.id)).toEqual(["select", "draw", "eraser", "reference", "ai"]);
  });

  it("每個工具都有標籤、圖示、快捷鍵與一句說明（不留沒說明的 icon）", () => {
    for (const tool of STUDIO_TOOLS) {
      expect(tool.label.length).toBeGreaterThan(0);
      expect(tool.icon.length).toBeGreaterThan(0);
      expect(tool.hint.length).toBeGreaterThan(0);
      expect(tool.detail.length).toBeGreaterThan(0);
    }
  });

  it("快捷鍵不重複（撞鍵＝其中一個永遠按不到）", () => {
    const hints = STUDIO_TOOLS.map((t) => t.hint);
    expect(new Set(hints).size).toBe(hints.length);
  });

  it("規劃中的工具與可用工具分開列，不混進 STUDIO_TOOLS", () => {
    const usable = new Set(STUDIO_TOOLS.map((t) => t.label));
    for (const planned of PLANNED_TOOLS) {
      expect(usable.has(planned.label)).toBe(false);
    }
  });
});

describe("optionsKindFor（Contextual Tool Options）", () => {
  it("畫筆與橡皮擦共用筆刷面板——橡皮擦就是一支筆", () => {
    expect(optionsKindFor("draw")).toBe("brush");
    expect(optionsKindFor("eraser")).toBe("brush");
  });
  it("底稿與 AI 各有自己的二級面板", () => {
    expect(optionsKindFor("reference")).toBe("reference");
    expect(optionsKindFor("ai")).toBe("ai");
  });
  it("導覽沒有二級設定——左欄收成一條窄軌，畫布拿回空間", () => {
    expect(optionsKindFor("select")).toBeNull();
  });
});

describe("panModeFor", () => {
  it("只有選取／移動進平移模式，其餘工具都要能落筆", () => {
    expect(panModeFor("select")).toBe(true);
    for (const tool of ["draw", "eraser", "reference", "ai"] as const) {
      expect(panModeFor(tool)).toBe(false);
    }
  });
});

describe("brushIdFor / toolForBrushId", () => {
  it("切到橡皮擦選內建橡皮擦", () => {
    expect(brushIdFor("eraser", "builtin.pen")).toBe("builtin.eraser");
  });
  it("切回畫筆回到「上一支畫圖的筆」，不是固定的預設筆", () => {
    expect(brushIdFor("draw", "mine.marker-1")).toBe("mine.marker-1");
  });
  it("導覽／底稿／AI 一律不動筆刷（換工具不該把使用者的筆換掉）", () => {
    for (const tool of ["select", "reference", "ai"] as const) {
      expect(brushIdFor(tool, "mine.marker-1")).toBeNull();
    }
  });
  it("由筆刷反推工具：快捷鍵直接換筆時左欄要跟著亮", () => {
    expect(toolForBrushId("builtin.eraser")).toBe("eraser");
    expect(toolForBrushId("builtin.pen")).toBe("draw");
    expect(toolForBrushId("mine.whatever")).toBe("draw");
  });
});

describe("Frame guides", () => {
  it("預設只開安全區——一次全開白板會變方格紙", () => {
    expect(DEFAULT_GUIDES).toEqual({ safe: true, thirds: false, center: false, grid: false });
  });
  it("每條輔助線都有說明（使用者要知道這條線在管什麼）", () => {
    expect(FRAME_GUIDES.map((g) => g.key)).toEqual(["safe", "thirds", "center", "grid"]);
    for (const guide of FRAME_GUIDES) expect(guide.detail.length).toBeGreaterThan(0);
  });
  it("toggleGuide 只翻指定那一條，不動其他", () => {
    const next = toggleGuide(DEFAULT_GUIDES, "thirds");
    expect(next.thirds).toBe(true);
    expect(next.safe).toBe(true);
    expect(next.center).toBe(false);
    // 不可變：原物件不能被改掉（React state 靠參照判斷是否重繪）
    expect(DEFAULT_GUIDES.thirds).toBe(false);
  });
  it("安全區沿用產業慣例的 90%／93%", () => {
    expect(SAFE_AREA.title).toBe(0.9);
    expect(SAFE_AREA.action).toBe(0.93);
    expect(SAFE_AREA.title).toBeLessThan(SAFE_AREA.action);
  });
});

describe("面板與 Timeline 高度", () => {
  it("預設兩個面板都展開（專業工具第一眼要看得到全部工作區）", () => {
    expect(DEFAULT_PANELS).toEqual({ inspector: false, timeline: false });
  });
  it("Timeline 高度夾在可用範圍內，壞值退回預設", () => {
    expect(clampTimelineHeight(40)).toBe(TIMELINE_HEIGHT.min);
    expect(clampTimelineHeight(9999)).toBe(TIMELINE_HEIGHT.max);
    expect(clampTimelineHeight(150)).toBe(150);
    expect(clampTimelineHeight(Number.NaN)).toBe(TIMELINE_HEIGHT.default);
  });
});
