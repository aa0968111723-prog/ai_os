import { describe, expect, it } from "vitest";
import {
  countApprovedScenes,
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
  approvedCount: 0,
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
    expect(isWrapComplete({ ...empty, approvedCount: 1 })).toBe(true);
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
        scenesWithMedia: 2,
        approvedCount: 0,
      }),
    ).toBe("wrap");
    expect(
      deriveSuggestedPhase({
        ...empty,
        wvReady: true,
        sceneCount: 2,
        scenesWithMedia: 2,
        approvedCount: 1,
      }),
    ).toBe("wrap");
  });

  it("journey states mix server completion + session current", () => {
    const p: CoCreateProgressInput = {
      wvReady: true,
      sceneCount: 2,
      scenesWithMedia: 0,
      approvedCount: 0,
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
        approvedCount: 0,
      }),
    ).toMatch(/設定：「清晨禪堂」/);
    expect(
      formatCoCreateWorkSummary({
        wvReady: true,
        logline: "清晨禪堂",
        tones: ["平靜"],
        sceneCount: 3,
        scenesWithMedia: 1,
        approvedCount: 0,
      }),
    ).toMatch(/缺 2/);
  });

  it("counts media and approved from scene rows", () => {
    const rows = [
      { assetId: "a", status: "todo" },
      { narrationAssetId: "n", status: "approved" },
      { assetId: null, narrationAssetId: null, status: "pending" },
    ];
    expect(countScenesWithMedia(rows)).toBe(2);
    expect(countApprovedScenes(rows)).toBe(1);
  });

  it("isPhaseComplete covers all ids", () => {
    expect(isPhaseComplete("theme", empty)).toBe(false);
    expect(isPhaseComplete("structure", { ...empty, sceneCount: 1 })).toBe(true);
  });
});
