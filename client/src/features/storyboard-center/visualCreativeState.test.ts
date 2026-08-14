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

/**
 * Mixed State 的比對鍵回歸（稽核確認的 P1／P2）。
 *
 * v3 拿「把 id 換成名字之後的顯示字串」當分群鍵，於是兩種情況會把**真的不一樣的鏡**
 * 折成同一群，UI 顯示 uniform、使用者按下套用才發現有幾鏡根本不是那樣：
 *  1. 卡片查不到名字（剛被刪、還在載入、權限外）→ 該 id 被靜默丟掉；
 *  2. 兩張不同的卡剛好同名。
 */
describe("Mixed State 由結構化的 id 推導，不由顯示名稱推導", () => {
  const names = {
    characterNames: new Map([["c-1", "娜美"]]),
    lookNames: new Map<string, string>(),
    sceneNames: new Map<string, string>(),
    propNames: new Map<string, string>(),
  };

  it("有綁定但查不到名字的 id 不會讓兩個不同的鏡看起來一樣", () => {
    const state = buildMixedCreativeState({
      ...names,
      shots: [
        { characterIds: ["c-1"] },
        { characterIds: ["c-1", "c-deleted"] }, // 多綁了一個查不到名字的
      ],
    });
    const character = state.find((item) => item.family === "character")!;
    expect(character.mode).toBe("mixed"); // v3 會回 uniform
    expect(character.value).toBe("MIXED");
    expect(character.unresolved).toBeGreaterThan(0);
  });

  it("查不到名字時不謊稱「尚未設定」", () => {
    const state = buildMixedCreativeState({ ...names, shots: [{ characterIds: ["c-unknown"] }] });
    const character = state.find((item) => item.family === "character")!;
    expect(character.empty).toBe(false); // 有綁定，只是名字還沒讀到
    expect(character.value).not.toBe("尚未設定");
  });

  it("兩張不同的卡同名 → 仍然算 MIXED", () => {
    const state = buildMixedCreativeState({
      ...names,
      characterNames: new Map([["c-1", "路人"], ["c-2", "路人"]]),
      shots: [{ characterIds: ["c-1"] }, { characterIds: ["c-2"] }],
    });
    expect(state.find((item) => item.family === "character")!.mode).toBe("mixed");
  });

  it("真的都沒有綁定才算空", () => {
    const state = buildMixedCreativeState({ ...names, shots: [{ characterIds: [] }, { characterIds: null }] });
    const character = state.find((item) => item.family === "character")!;
    expect(character.empty).toBe(true);
    expect(character.mode).toBe("uniform");
  });

  it("順序不同不算創作差異（集合語意仍然成立）", () => {
    const state = buildMixedCreativeState({
      ...names,
      characterNames: new Map([["c-1", "娜美"], ["c-2", "索隆"]]),
      shots: [{ characterIds: ["c-1", "c-2"] }, { characterIds: ["c-2", "c-1"] }],
    });
    expect(state.find((item) => item.family === "character")!.mode).toBe("uniform");
  });
});
