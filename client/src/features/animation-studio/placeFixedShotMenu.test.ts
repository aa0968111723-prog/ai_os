import { describe, expect, it } from "vitest";
import { LAPTOP_VIEWPORT, menuBoxCoversPoint, placeFixedShotMenu, SHOT_MENU_MAX } from "./placeFixedShotMenu";

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
    const menuH = 120;
    const menuW = 190;
    const box = placeFixedShotMenu({
      trigger: { top: 668, left: 320, bottom: 690 },
      menuH,
      menuW,
      vw: LAPTOP_VIEWPORT.vw,
      vh: LAPTOP_VIEWPORT.vh,
    });
    expect(menuW).toBeLessThanOrEqual(SHOT_MENU_MAX.w);
    expect(menuH).toBeLessThanOrEqual(SHOT_MENU_MAX.h);
    expect(box.top).toBeGreaterThanOrEqual(8);
    expect(box.top + menuH).toBeLessThanOrEqual(LAPTOP_VIEWPORT.vh - 8);
    expect(box.left + menuW).toBeLessThanOrEqual(LAPTOP_VIEWPORT.vw - 8);
    const copyItem = { top: box.top + 40, left: box.left + 8, width: 170, height: 32 };
    expect(copyItem.top).toBeGreaterThanOrEqual(box.top);
    expect(copyItem.top + copyItem.height).toBeLessThanOrEqual(LAPTOP_VIEWPORT.vh);
    expect(menuBoxCoversPoint(
      { top: box.top, left: box.left, width: menuW, height: menuH },
      { x: LAPTOP_VIEWPORT.vw / 2, y: 280 },
    )).toBe(false);
  });

  it("caps a viewport-sized popover so it cannot become the giant cream overlay", () => {
    const box = placeFixedShotMenu({
      trigger: { top: 668, left: 320, bottom: 690 },
      menuH: 800,
      menuW: 1280,
      vw: 1280,
      vh: 800,
    });
    expect(box.top + SHOT_MENU_MAX.h).toBeLessThanOrEqual(800);
    expect(box.left + SHOT_MENU_MAX.w).toBeLessThanOrEqual(1280);
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
