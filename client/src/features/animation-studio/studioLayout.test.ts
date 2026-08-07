import { describe, expect, it } from "vitest";
import {
  clampZoom,
  fitBoardToBox,
  resolveStudioLayout,
  STUDIO_LITE_QUERY,
  STUDIO_MOBILE_BREAKPOINT,
  STUDIO_ZOOM,
} from "./studioLayout";

describe("resolveStudioLayout", () => {
  it("桌機視窗給完整版面：常駐右欄、常駐分鏡軌、進階筆刷參數", () => {
    const layout = resolveStudioLayout({ viewportWidth: 1440, devicePixelRatio: 2 });
    expect(layout.mode).toBe("desktop");
    expect(layout.aiPanel).toBe("column");
    expect(layout.shotStrip).toBe("rail");
    expect(layout.brushShelf).toBe("column");
    expect(layout.showBrushTuning).toBe(true);
  });

  it("手機寬度走輕量版：面板改 sheet、筆刷櫃改底部 dock", () => {
    const layout = resolveStudioLayout({ viewportWidth: 390, devicePixelRatio: 3 });
    expect(layout.mode).toBe("lite");
    expect(layout.aiPanel).toBe("sheet");
    expect(layout.shotStrip).toBe("sheet");
    expect(layout.brushShelf).toBe("dock");
    expect(layout.showBrushTuning).toBe(false);
  });

  it("輕量版真的把成本降下來，不只是把面板藏起來", () => {
    const lite = resolveStudioLayout({ viewportWidth: 390, devicePixelRatio: 3 });
    const desktop = resolveStudioLayout({ viewportWidth: 1440, devicePixelRatio: 2 });
    expect(lite.maxStrokes).toBeLessThan(desktop.maxStrokes);
    expect(lite.maxUndo).toBeLessThan(desktop.maxUndo);
    expect(lite.exportMaxEdge).toBeLessThan(desktop.exportMaxEdge);
  });

  it("斷點與全站手機斷點一致（CSS 與 JS 不得各寫一個數字）", () => {
    expect(resolveStudioLayout({ viewportWidth: STUDIO_MOBILE_BREAKPOINT }).mode).toBe("lite");
    expect(resolveStudioLayout({ viewportWidth: STUDIO_MOBILE_BREAKPOINT + 1 }).mode).toBe("desktop");
    expect(STUDIO_LITE_QUERY).toBe(`(max-width: ${STUDIO_MOBILE_BREAKPOINT}px)`);
  });

  it("觸控平板即使視窗較寬也走輕量版（手指的操作預算跟手機一樣）", () => {
    expect(resolveStudioLayout({ viewportWidth: 1024, coarsePointer: true }).mode).toBe("lite");
    expect(resolveStudioLayout({ viewportWidth: 1024, coarsePointer: false }).mode).toBe("desktop");
    // 大型觸控螢幕（>1100）仍是桌機版面
    expect(resolveStudioLayout({ viewportWidth: 1600, coarsePointer: true }).mode).toBe("desktop");
  });

  it("渲染像素比封頂在 2——DPR 3 的手機畫滿版白板是四倍像素成本", () => {
    expect(resolveStudioLayout({ viewportWidth: 390, devicePixelRatio: 3 }).maxDpr).toBe(2);
    expect(resolveStudioLayout({ viewportWidth: 390, devicePixelRatio: 1 }).maxDpr).toBe(1);
    expect(resolveStudioLayout({ viewportWidth: 390 }).maxDpr).toBe(1);
    expect(resolveStudioLayout({ viewportWidth: 390, devicePixelRatio: Number.NaN }).maxDpr).toBe(1);
  });
});

describe("fitBoardToBox", () => {
  it("整張放得下並置中", () => {
    const fit = fitBoardToBox({ w: 1600, h: 900 }, { w: 800, h: 800 });
    expect(fit.scale).toBeCloseTo(0.5);
    expect(fit.offsetX).toBeCloseTo(0);
    expect(fit.offsetY).toBeCloseTo((800 - 450) / 2);
  });

  it("直式白板在寬容器裡靠比例縮，不會被拉變形", () => {
    const fit = fitBoardToBox({ w: 900, h: 1600 }, { w: 1200, h: 400 });
    expect(fit.scale).toBeCloseTo(0.25);
    expect(fit.offsetX).toBeCloseTo((1200 - 225) / 2);
  });

  it("尺寸為 0 時回安全值（容器還沒量到大小的第一幀）", () => {
    expect(fitBoardToBox({ w: 0, h: 0 }, { w: 100, h: 100 })).toEqual({ scale: 1, offsetX: 0, offsetY: 0 });
    expect(fitBoardToBox({ w: 100, h: 100 }, { w: 0, h: 0 })).toEqual({ scale: 1, offsetX: 0, offsetY: 0 });
  });
});

describe("clampZoom", () => {
  it("夾在可用範圍內，壞值退回 1", () => {
    expect(clampZoom(0.01)).toBe(STUDIO_ZOOM.min);
    expect(clampZoom(99)).toBe(STUDIO_ZOOM.max);
    expect(clampZoom(Number.NaN)).toBe(1);
    expect(clampZoom(2)).toBe(2);
  });
});
