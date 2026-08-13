import { describe, expect, it } from "vitest";
import { VISUAL_CHOICE_PRESETS } from "@shared/visualChoicePresets";
import {
  buildCreativeState,
  buildMixedCreativeState,
  presetMatchesShot,
  snapshotOperationTargets,
  summarizeTargetImpact,
} from "./visualCreativeState";

describe("visual creative current state", () => {
  const shot = {
    characterIds: ["char-1"],
    lookIds: ["look-4"],
    scenePresetIds: ["scene-1"],
    propIds: ["prop-1"],
    action: "回頭望，身體仍朝前",
    camera: { shotSize: "中景", lighting: "黃昏逆光" },
    performance: { emotion: "驚訝" },
  };

  it("derives all eight visible current-state families from durable truth", () => {
    const state = buildCreativeState({
      shot,
      characterNames: new Map([["char-1", "娜美"]]),
      lookNames: new Map([["look-4", "夏季服裝 V4"]]),
      sceneNames: new Map([["scene-1", "淺水灣"]]),
      propNames: new Map([["prop-1", "紅傘"]]),
      projectStyle: "治癒繪本風",
    });
    expect(state.map((item) => item.value)).toEqual([
      "娜美",
      "夏季服裝 V4",
      "回頭望，身體仍朝前",
      "驚訝",
      "淺水灣",
      "紅傘",
      "黃昏逆光",
      "中景",
      "治癒繪本風",
    ]);
  });

  it("projects multi-shot consensus and MIXED distributions without new truth", () => {
    const mixed = buildMixedCreativeState({
      shots: [shot, { ...shot, lookIds: ["look-3"], scenePresetIds: ["scene-2"] }, { ...shot, lookIds: ["look-4"] }],
      characterNames: new Map([["char-1", "娜美"]]),
      lookNames: new Map([["look-4", "夏季服裝 V4"], ["look-3", "夏季服裝 V3"]]),
      sceneNames: new Map([["scene-1", "淺水灣"], ["scene-2", "禪堂"]]),
      propNames: new Map([["prop-1", "紅傘"]]),
      projectStyle: "治癒繪本風",
    });
    expect(mixed.find((item) => item.family === "character")).toMatchObject({ mode: "uniform", value: "娜美" });
    expect(mixed.find((item) => item.family === "look")).toMatchObject({
      mode: "mixed",
      value: "MIXED",
      distribution: [{ value: "夏季服裝 V4", count: 2 }, { value: "夏季服裝 V3", count: 1 }],
    });
    expect(mixed.find((item) => item.family === "scene")?.detail).toContain("淺水灣 ×2");
  });

  it("recognizes structured preset state without relying on UI state", () => {
    const action = VISUAL_CHOICE_PRESETS.find((preset) => preset.id === "action.looking_back")!;
    const camera = VISUAL_CHOICE_PRESETS.find((preset) => preset.id === "camera.medium")!;
    expect(presetMatchesShot(action, shot)).toBe(true);
    expect(presetMatchesShot(camera, shot)).toBe(true);
  });

  it("freezes exact ids per operation and leaves later UI selection independent", () => {
    const selected = ["shot-2", "shot-4", "shot-7", "shot-4"];
    const frozen = snapshotOperationTargets(selected);
    selected.splice(0, selected.length, "shot-9");
    expect(frozen).toEqual(["shot-2", "shot-4", "shot-7"]);
    expect(selected).toEqual(["shot-9"]);
  });

  it("summarizes approved impact so batch writes can protect accepted work", () => {
    expect(summarizeTargetImpact([
      { id: "a" },
      { id: "b", assetId: "asset-b" },
      { id: "c", assetId: "asset-c", reviewStatus: "approved" },
    ], ["a", "b", "c"])).toEqual({ total: 3, draft: 1, withVisual: 1, approved: 1 });
  });
});
