import { describe, expect, it } from "vitest";
import {
  compactWorkspaceStatus,
  nextWorkspaceAction,
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
