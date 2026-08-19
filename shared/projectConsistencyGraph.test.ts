import { describe, expect, it } from "vitest";
import {
  buildConsistencyScorecard,
  compactWorkspaceStatus,
  nextWorkspaceAction,
  scorecardNeedsSetupCta,
  scorecardNeedsSheetCta,
  scorecardNeedsDeliveryCta,
  scorecardNeedsOpenCardsCta,
  visualCoverageScore,
} from "./projectConsistencyGraph";
import { inheritContinuityState, referenceRoleConflicts } from "./shotContextPacket";

describe("workspace projection", () => {
  it("reports 0 visual coverage when there are no visual references", () => {
    expect(visualCoverageScore(0, 8)).toBe(0);
    expect(visualCoverageScore(4, 8)).toBe(0.5);
  });

  it("keeps the first-screen status short and actionable", () => {
    expect(compactWorkspaceStatus({
      charactersApplied: true,
      sceneCount: 5,
      consistentShots: 18,
      shotCount: 20,
      needsConfirm: 2,
    })).toBe("人物已套用 · 5 個場景 · 18/20 鏡一致 · 2 鏡需確認");
    expect(nextWorkspaceAction({
      storyReady: true,
      parsed: true,
      shotCount: 20,
      needsConfirm: 2,
      consistentShots: 18,
    })).toMatch(/確認/);
    expect(nextWorkspaceAction({
      storyReady: true,
      parsed: false,
      shotCount: 26,
      needsConfirm: 0,
      consistentShots: 21,
    })).toBe("只重做不一致的鏡頭");
    expect(nextWorkspaceAction({
      storyReady: true,
      parsed: false,
      shotCount: 26,
      needsConfirm: 0,
      consistentShots: 21,
    })).not.toBe("解析故事，讓人物與場景就位");
    expect(compactWorkspaceStatus({
      charactersApplied: true,
      sceneCount: 5,
      consistentShots: 21,
      shotCount: 26,
      needsConfirm: 0,
    })).toBe("人物已套用 · 5 個場景 · 21/26 鏡一致");
    expect(compactWorkspaceStatus({
      charactersApplied: true,
      sceneCount: 5,
      consistentShots: 21,
      shotCount: 26,
      needsConfirm: 0,
      untitledOrphans: 5,
    })).toBe("人物已套用 · 5 個場景 · 21/26 鏡一致 · 5 鏡未分場");
    expect(nextWorkspaceAction({
      storyReady: true,
      parsed: false,
      shotCount: 26,
      needsConfirm: 5,
      untitledOrphans: 5,
      consistentShots: 21,
    })).toBe("打開分鏡，把 5 鏡未分場歸場");
    expect(nextWorkspaceAction({
      storyReady: true,
      parsed: false,
      shotCount: 26,
      needsConfirm: 5,
      untitledOrphans: 5,
      consistentShots: 21,
    })).not.toMatch(/確認 5 個項目後再生成/);
  });
});

describe("mixed-asset and continuity rules", () => {
  it("flags two primary identity references as a conflict", () => {
    const conflicts = referenceRoleConflicts([
      { assetId: "a", role: "identity", priority: "PRIMARY" },
      { assetId: "b", role: "identity", priority: "PRIMARY" },
    ]);
    expect(conflicts).toHaveLength(1);
  });

  it("inherits wet clothes unless the script time-jumps", () => {
    const next = inheritContinuityState(
      { actors: [{ characterId: "c1", lookId: "l1", wetness: "wet" }], environment: { weather: "雨" } },
      { actors: [{ characterId: "c1", lookId: "l1", pose: "walk" }] },
      "cut",
    );
    expect(next.actors[0]?.wetness).toBe("wet");
    const jumped = inheritContinuityState(
      { actors: [{ characterId: "c1", lookId: "l1", wetness: "wet" }], environment: { weather: "雨" } },
      { actors: [{ characterId: "c1", lookId: "l1" }], environment: { weather: "晴" } },
      "time_jump",
    );
    expect(jumped.actors[0]?.wetness).toBeUndefined();
    expect(jumped.environment).toEqual({ weather: "晴" });
  });
});

describe("consistency scorecard (closure §11)", () => {
  const empty = {
    charactersMissingReference: [], charactersBoundShotIds: [],
    looksMissingReference: [], presetsMissingReference: [],
    unresolvedPropShotIds: [], styleCanonPinned: true,
    staleShotIds: [], multiCharacterShotIds: [],
    voiceFindingShotIds: [], charactersSpeakingWithoutVoice: 0,
    soundFindingShotIds: [], soundWorldPinned: true,
    lineageGapShotIds: [], deliveryBlockers: [],
  };

  it("a healthy project shows an empty scorecard (first layer stays quiet)", () => {
    expect(buildConsistencyScorecard(empty)).toEqual([]);
  });

  it("each dimension carries real affectedShotIds and a repair reason, no flat percentage", () => {
    const rows = buildConsistencyScorecard({
      ...empty,
      unresolvedPropShotIds: ["sh3"],
      staleShotIds: ["sh1", "sh2"],
      voiceFindingShotIds: ["sh4"],
      deliveryBlockers: ["有鏡頭尚未核准"],
    });
    const prop = rows.find((row) => row.dimension === "prop");
    expect(prop?.status).toBe("unresolved");
    expect(prop?.affectedShotIds).toEqual(["sh3"]);
    const continuity = rows.find((row) => row.dimension === "continuity");
    expect(continuity?.status).toBe("stale");
    expect(continuity?.affectedShotIds).toEqual(["sh1", "sh2"]);
    const voice = rows.find((row) => row.dimension === "voice");
    expect(voice?.status).toBe("stale");
    const delivery = rows.find((row) => row.dimension === "delivery");
    expect(delivery?.status).toBe("blocker");
    expect(delivery?.affectedShotIds).toEqual([]);
    expect(scorecardNeedsDeliveryCta(delivery!)).toBe(true);
    expect(scorecardNeedsSetupCta(delivery!)).toBe(false);
    expect(scorecardNeedsSheetCta(delivery!)).toBe(false);
    expect(rows.every((row) => typeof row.reason === "string" && row.reason.length > 0)).toBe(true);
  });

  it("multi-character shots surface as capability downgrade, not a fake OK", () => {
    const rows = buildConsistencyScorecard({ ...empty, multiCharacterShotIds: ["sh9"] });
    expect(rows.find((row) => row.status === "capability_downgrade")?.affectedShotIds).toEqual(["sh9"]);
  });

  it("unpinned style/sound_world are project-level setup, not 修復 N 鏡", () => {
    const rows = buildConsistencyScorecard({
      ...empty,
      styleCanonPinned: false,
      soundWorldPinned: false,
    });
    const style = rows.find((row) => row.dimension === "style");
    const sound = rows.find((row) => row.dimension === "sound_world");
    expect(style?.affectedShotIds).toEqual([]);
    expect(sound?.affectedShotIds).toEqual([]);
    expect(scorecardNeedsSetupCta(style!)).toBe(true);
    expect(scorecardNeedsSetupCta(sound!)).toBe(true);
    expect(scorecardNeedsSetupCta({
      dimension: "voice",
      status: "warning",
      affectedShotIds: [],
      reason: "1 位有台詞的角色還沒綁定聲線",
    })).toBe(false);
  });

  it("identity missing sheets ask for 生成定裝, not 修復 N 鏡", () => {
    const rows = buildConsistencyScorecard({
      ...empty,
      charactersMissingReference: ["c-xiaohua"],
      charactersBoundShotIds: ["sh1"],
    });
    const identity = rows.find((row) => row.dimension === "identity" && row.status === "warning");
    expect(identity?.reason).toMatch(/沒有定裝參考圖/);
    expect(scorecardNeedsSheetCta(identity!)).toBe(true);
    expect(scorecardNeedsSetupCta(identity!)).toBe(false);
  });

  it("look/scene missing reference opens cards, not 修復 0 鏡 or 生成定裝", () => {
    const rows = buildConsistencyScorecard({
      ...empty,
      looksMissingReference: ["look-1"],
      presetsMissingReference: ["preset-1"],
    });
    const look = rows.find((row) => row.dimension === "look");
    const scene = rows.find((row) => row.dimension === "scene");
    expect(look?.affectedShotIds).toEqual([]);
    expect(scene?.affectedShotIds).toEqual([]);
    expect(scorecardNeedsOpenCardsCta(look!)).toBe("looks");
    expect(scorecardNeedsOpenCardsCta(scene!)).toBe("scenes");
    expect(scorecardNeedsSheetCta(look!)).toBe(false);
    expect(scorecardNeedsSheetCta(scene!)).toBe(false);
    expect(scorecardNeedsSetupCta(look!)).toBe(false);
    expect(scorecardNeedsDeliveryCta(look!)).toBe(false);
  });
});
