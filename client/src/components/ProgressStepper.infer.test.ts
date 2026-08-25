import { describe, expect, it } from "vitest";
import { DEFAULT_STEPS, inferProjectCurrentStep } from "./ProgressStepper";

describe("DEFAULT_STEPS labels align with mobile stages", () => {
  it("uses 故事／分鏡／視覺／生成／交付", () => {
    expect(DEFAULT_STEPS.map((s) => s.label)).toEqual([
      "故事",
      "分鏡",
      "視覺",
      "生成",
      "交付",
    ]);
  });
});

describe("inferProjectCurrentStep", () => {
  it("returns 5 when archived", () => {
    expect(inferProjectCurrentStep({ status: "archived" })).toBe(5);
  });

  it("returns 4 when awaiting generations (Launchpad path)", () => {
    expect(
      inferProjectCurrentStep({ status: "active" }, { awaitingGenerations: 2 }),
    ).toBe(4);
  });

  it("returns 2 when no counts and no awaiting (conservative)", () => {
    expect(inferProjectCurrentStep({ status: "active" })).toBe(2);
    expect(inferProjectCurrentStep({ status: "active" }, { awaitingGenerations: 0 })).toBe(2);
  });

  it("with counts: empty story → 1", () => {
    expect(
      inferProjectCurrentStep({ status: "active" }, null, {
        hasStory: false,
        shots: 0,
      }),
    ).toBe(1);
  });

  it("with counts: has story, no shots → 2 (分鏡)", () => {
    expect(
      inferProjectCurrentStep({ status: "active" }, null, {
        hasStory: true,
        shots: 0,
      }),
    ).toBe(2);
  });

  it("with counts: shots but no visuals → 3 (視覺)", () => {
    expect(
      inferProjectCurrentStep({ status: "active" }, null, {
        hasStory: true,
        shots: 5,
        shotsWithVisual: 0,
      }),
    ).toBe(3);
  });

  it("with counts: partial visuals → 4 (生成)", () => {
    expect(
      inferProjectCurrentStep({ status: "active" }, null, {
        hasStory: true,
        shots: 5,
        shotsWithVisual: 2,
      }),
    ).toBe(4);
  });

  it("with counts: playable result → 5 (交付)", () => {
    expect(
      inferProjectCurrentStep({ status: "active" }, null, {
        hasStory: true,
        shots: 5,
        shotsWithVisual: 5,
        playableResultCount: 1,
      }),
    ).toBe(5);
  });

  it("awaiting overrides to 4 even when shots incomplete", () => {
    expect(
      inferProjectCurrentStep(
        { status: "active" },
        { awaitingGenerations: 1 },
        { hasStory: true, shots: 3, shotsWithVisual: 0 },
      ),
    ).toBe(4);
  });
});
