import { describe, expect, it } from "vitest";
import {
  coCreateQuickPrompts,
  phaseAdvanceNotice,
  primaryActionTypesForPhase,
  suggestedPhaseAfterAction,
  wrapNextStepHint,
} from "./coCreateActions";

describe("coCreateActions (G2)", () => {
  it("primaryActionTypesForPhase matches phase main CTA", () => {
    expect(primaryActionTypesForPhase("theme")).toContain("apply_worldview_chips");
    expect(primaryActionTypesForPhase("structure")).toEqual(
      expect.arrayContaining(["split_script", "create_scene"]),
    );
    expect(primaryActionTypesForPhase("visuals")).toEqual(["generate"]);
    expect(primaryActionTypesForPhase("wrap")).toEqual(["submit_approval"]);
  });

  it("coCreateQuickPrompts are phase-scoped and include dharma example on theme", () => {
    const theme = coCreateQuickPrompts("theme");
    expect(theme.length).toBeGreaterThanOrEqual(2);
    expect(theme.length).toBeLessThanOrEqual(4);
    expect(theme.some((q) => q.includes("弘法") || q.includes("主題"))).toBe(true);

    const structure = coCreateQuickPrompts("structure");
    expect(structure.some((q) => q.includes("鏡頭") || q.includes("分鏡"))).toBe(true);
    expect(structure.some((q) => q.includes("弘法"))).toBe(false);
  });

  it("suggestedPhaseAfterAction advances only on matching success types", () => {
    expect(suggestedPhaseAfterAction("apply_worldview_chips", "theme")).toBe("structure");
    expect(suggestedPhaseAfterAction("generate", "theme")).toBeNull();
    expect(suggestedPhaseAfterAction("split_script", "structure")).toBe("visuals");
    expect(suggestedPhaseAfterAction("create_scene", "structure")).toBe("visuals");
    expect(suggestedPhaseAfterAction("generate", "visuals")).toBe("wrap");
    expect(suggestedPhaseAfterAction("submit_approval", "wrap")).toBeNull();
  });

  it("phaseAdvanceNotice is human-readable", () => {
    expect(phaseAdvanceNotice("theme", "structure")).toMatch(/定調/);
    expect(phaseAdvanceNotice("theme", "structure")).toMatch(/分鏡/);
  });

  it("wrapNextStepHint covers empty / missing media / ready", () => {
    expect(wrapNextStepHint({ sceneCount: 0, scenesWithMedia: 0, approvedCount: 0 })).toMatch(
      /分鏡/,
    );
    expect(
      wrapNextStepHint({ sceneCount: 4, scenesWithMedia: 1, approvedCount: 0 }),
    ).toMatch(/缺畫面|生成/);
    expect(
      wrapNextStepHint({ sceneCount: 2, scenesWithMedia: 2, approvedCount: 0 }),
    ).toMatch(/送審|打包/);
    expect(
      wrapNextStepHint({ sceneCount: 2, scenesWithMedia: 2, approvedCount: 1 }),
    ).toMatch(/打包|匯出/);
  });
});
