import { describe, expect, it } from "vitest";
import { placeFixedShotMenu } from "./placeFixedShotMenu";

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
