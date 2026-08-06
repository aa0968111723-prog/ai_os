import { describe, expect, it } from "vitest";
import {
  countScenesWithMedia,
  deriveSuggestedPhase,
  formatCoCreateWorkSummary,
  isPhaseComplete,
  isStructureComplete,
  isThemeComplete,
  isVisualsComplete,
  isWrapComplete,
  coCreateJourneyStatesWithProgress,
  type CoCreateProgressInput,
} from "./coCreateProgress";

const empty: CoCreateProgressInput = {
  wvReady: false,
  logline: "",
  tones: [],
  sceneCount: 0,
  scenesWithMedia: 0,
};

describe("coCreateProgress (G1)", () => {
  it("theme complete when wvReady or logline", () => {
    expect(isThemeComplete(empty)).toBe(false);
    expect(isThemeComplete({ ...empty, logline: "  一句話  " })).toBe(true);
    expect(isThemeComplete({ ...empty, wvReady: true })).toBe(true);
  });

  it("structure / visuals / wrap thresholds", () => {
    expect(isStructureComplete({ ...empty, sceneCount: 1 })).toBe(true);
    expect(isVisualsComplete({ ...empty, scenesWithMedia: 1 })).toBe(true);
    expect(isWrapComplete({ ...empty, sceneCount: 2, scenesWithMedia: 2 })).toBe(true);
  });

  it("derives first incomplete phase", () => {
    expect(deriveSuggestedPhase(empty)).toBe("theme");
    expect(
      deriveSuggestedPhase({ ...empty, wvReady: true, sceneCount: 0 }),
    ).toBe("structure");
    expect(
      deriveSuggestedPhase({
        ...empty,
        wvReady: true,
        sceneCount: 2,
        scenesWithMedia: 0,
      }),
    ).toBe("visuals");
    expect(
      deriveSuggestedPhase({
        ...empty,
        wvReady: true,
        sceneCount: 2,
        scenesWithMedia: 1,
      }),
    ).toBe("wrap");
    expect(
      deriveSuggestedPhase({
        ...empty,
        wvReady: true,
        sceneCount: 2,
        scenesWithMedia: 2,
      }),
    ).toBe("wrap");
  });

  it("journey states mix server completion + session current", () => {
    const p: CoCreateProgressInput = {
      wvReady: true,
      sceneCount: 2,
      scenesWithMedia: 0,
    };
    // session on theme：theme 當 current；structure 已完成仍標 done
    expect(coCreateJourneyStatesWithProgress("theme", p)).toEqual([
      "current",
      "done",
      "upcoming",
      "upcoming",
    ]);
    // session on structure after theme done
    expect(coCreateJourneyStatesWithProgress("structure", p)).toEqual([
      "done",
      "current",
      "upcoming",
      "upcoming",
    ]);
  });

  it("formats work summary", () => {
    expect(formatCoCreateWorkSummary(empty)).toContain("設定（待）");
    expect(
      formatCoCreateWorkSummary({
        wvReady: true,
        logline: "清晨禪堂",
        tones: ["平靜", "溫暖"],
        sceneCount: 3,
        scenesWithMedia: 1,
      }),
    ).toMatch(/設定：「清晨禪堂」/);
    expect(
      formatCoCreateWorkSummary({
        wvReady: true,
        logline: "清晨禪堂",
        tones: ["平靜"],
        sceneCount: 3,
        scenesWithMedia: 1,
      }),
    ).toMatch(/缺 2/);
  });

  it("counts media from scene rows", () => {
    const rows = [
      { assetId: "a" },
      { narrationAssetId: "n" },
      { assetId: null, narrationAssetId: null },
    ];
    expect(countScenesWithMedia(rows)).toBe(2);
  });

  it("isPhaseComplete covers all ids", () => {
    expect(isPhaseComplete("theme", empty)).toBe(false);
    expect(isPhaseComplete("structure", { ...empty, sceneCount: 1 })).toBe(true);
  });
});
