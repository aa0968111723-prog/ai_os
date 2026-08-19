import { describe, expect, it } from "vitest";
import {
  LAPTOP_VIEWPORT,
  ZOOMED_TALL_VIEWPORT,
  fixedShotMenuStyle,
  menuBoxCoversPoint,
  placeFixedShotMenu,
  SHOT_MENU_MAX,
  shotMenuCoversWhiteboard,
} from "./placeFixedShotMenu";

function assertCopyOnScreen(
  viewport: { vw: number; vh: number },
  trigger: { top: number; left: number; bottom: number },
) {
  const menuH = 120;
  const menuW = 190;
  const box = placeFixedShotMenu({
    trigger,
    menuH,
    menuW,
    vw: viewport.vw,
    vh: viewport.vh,
  });
  expect(box.top).toBeGreaterThanOrEqual(8);
  expect(box.top + menuH).toBeLessThanOrEqual(viewport.vh - 8);
  expect(box.left).toBeGreaterThanOrEqual(8);
  expect(box.left + menuW).toBeLessThanOrEqual(viewport.vw - 8);
  const copyItem = { top: box.top + 40, left: box.left + 8, width: 170, height: 32 };
  expect(copyItem.top).toBeGreaterThanOrEqual(0);
  expect(copyItem.top + copyItem.height).toBeLessThanOrEqual(viewport.vh);
  expect(copyItem.left + copyItem.width).toBeLessThanOrEqual(viewport.vw);
  expect(shotMenuCoversWhiteboard(
    { top: box.top, left: box.left, width: menuW, height: menuH },
    viewport,
  )).toBe(false);
  expect(menuBoxCoversPoint(
    { top: box.top, left: box.left, width: menuW, height: menuH },
    { x: viewport.vw / 2, y: Math.round(viewport.vh * 0.35) },
  )).toBe(false);
}

describe("placeFixedShotMenu", () => {
  it("1024-high: ⋯ at the timeline bottom keeps 複製 on-screen (not off-viewport)", () => {
    const box = placeFixedShotMenu({
      trigger: { top: 980, left: 240, bottom: 1002 },
      menuH: 88,
      menuW: 190,
      vw: 1280,
      vh: 1024,
    });
    expect(box.top).toBeGreaterThanOrEqual(8);
    expect(box.top + 88).toBeLessThanOrEqual(1024 - 8);
    expect(box.left).toBeGreaterThanOrEqual(8);
    expect(box.left + 190).toBeLessThanOrEqual(1280 - 8);
  });

  it("1280×800: 複製 box is on-screen and the menu does not cover the canvas", () => {
    assertCopyOnScreen(LAPTOP_VIEWPORT, { top: 668, left: 320, bottom: 690 });
  });

  it("zoomed/tall CSS 2560×1320 (50% of 1280×800): 複製 stays on-screen; no whiteboard cover", () => {
    assertCopyOnScreen(ZOOMED_TALL_VIEWPORT, { top: 1188, left: 640, bottom: 1212 });
  });

  it("caps a viewport-sized popover so it cannot become the giant cream overlay", () => {
    for (const viewport of [LAPTOP_VIEWPORT, ZOOMED_TALL_VIEWPORT]) {
      const box = placeFixedShotMenu({
        trigger: { top: viewport.vh - 132, left: 320, bottom: viewport.vh - 108 },
        menuH: viewport.vh,
        menuW: viewport.vw,
        vw: viewport.vw,
        vh: viewport.vh,
      });
      expect(box.top + SHOT_MENU_MAX.h).toBeLessThanOrEqual(viewport.vh);
      expect(box.left + SHOT_MENU_MAX.w).toBeLessThanOrEqual(viewport.vw);
      expect(shotMenuCoversWhiteboard(
        { top: box.top, left: box.left, width: SHOT_MENU_MAX.w, height: SHOT_MENU_MAX.h },
        viewport,
      )).toBe(false);
    }
  });

  it("fixedShotMenuStyle never uses inset:0 / 999px / a scale transform", () => {
    const style = fixedShotMenuStyle({ top: 544, left: 320 });
    expect(style.position).toBe("fixed");
    expect(style.right).toBe("auto");
    expect(style.bottom).toBe("auto");
    expect(style.width).toBe("max-content");
    expect(style.height).toBe("auto");
    expect(style.maxWidth).toBe(SHOT_MENU_MAX.w);
    expect(style.maxHeight).toBe(SHOT_MENU_MAX.h);
    expect(style.minHeight).toBe(0);
    expect(style.transform).toBe("none");
    expect(style.transformOrigin).toBe("top left");
    expect(style.borderRadius).toBe(10);
    expect(style.visibility).toBe("visible");
    expect(JSON.stringify(style)).not.toMatch(/inset/);
  });

  it("a full-viewport cream pill is classified as covering the whiteboard", () => {
    expect(shotMenuCoversWhiteboard(
      { top: 0, left: 0, width: 1280, height: 800 },
      LAPTOP_VIEWPORT,
    )).toBe(true);
    expect(shotMenuCoversWhiteboard(
      { top: 0, left: 0, width: 2560, height: 1320 },
      ZOOMED_TALL_VIEWPORT,
    )).toBe(true);
  });

  it("prefers opening above the ⋯ when there is room", () => {
    const box = placeFixedShotMenu({
      trigger: { top: 800, left: 40, bottom: 822 },
      menuH: 88,
      menuW: 190,
      vw: 1280,
      vh: 1024,
    });
    expect(box.top).toBe(800 - 4 - 88);
  });
});
