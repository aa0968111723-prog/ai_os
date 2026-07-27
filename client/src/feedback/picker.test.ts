import { describe, expect, it } from "vitest";
import { screenshotScale } from "./picker";

describe("feedback screenshot sizing", () => {
  it("keeps ordinary viewports sharp without exceeding the maximum scale", () => {
    expect(screenshotScale(1280, 720)).toBe(0.8);
  });

  it("reduces very large viewports to the screenshot pixel budget", () => {
    const scale = screenshotScale(3840, 2160);
    expect(scale).toBeCloseTo(Math.sqrt(2_000_000 / (3840 * 2160)));
    expect(3840 * 2160 * scale * scale).toBeCloseTo(2_000_000);
  });

  it("uses a safe floor for invalid or extreme dimensions", () => {
    expect(screenshotScale(0, 1080)).toBe(0.35);
    expect(screenshotScale(20_000, 20_000)).toBe(0.35);
  });
});
