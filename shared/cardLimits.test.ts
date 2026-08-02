import { describe, expect, it } from "vitest";
import {
  CHAR_APPEARANCE_MAX,
  CHAR_NAME_MAX,
  CHAR_NOTES_MAX,
  MAX_GENERATE_CHARACTERS,
  MAX_GENERATE_PROPS,
  MAX_GENERATE_SCENE_PRESETS,
  MAX_PROJECT_CHARACTERS,
  MAX_PROJECT_PROPS,
  MAX_PROJECT_SCENE_PRESETS,
  PROP_APPEARANCE_MAX,
  PROP_NAME_MAX,
  PROP_NOTES_MAX,
  SCENE_LIGHTING_MAX,
  SCENE_NAME_MAX,
  SCENE_PALETTE_MAX,
} from "./cardLimits";

describe("cardLimits", () => {
  it("生成帶入上限與歷史契約一致", () => {
    expect(MAX_GENERATE_CHARACTERS).toBe(6);
    expect(MAX_GENERATE_SCENE_PRESETS).toBe(4);
    expect(MAX_GENERATE_PROPS).toBe(4);
  });

  it("每專案張數有界", () => {
    expect(MAX_PROJECT_CHARACTERS).toBe(50);
    expect(MAX_PROJECT_SCENE_PRESETS).toBe(50);
    expect(MAX_PROJECT_PROPS).toBe(50);
  });

  it("欄位上限合理且外觀 ≥ 錨點截短空間", () => {
    expect(CHAR_NAME_MAX).toBe(40);
    expect(CHAR_APPEARANCE_MAX).toBe(1000);
    expect(CHAR_NOTES_MAX).toBe(1000);
    expect(SCENE_NAME_MAX).toBe(40);
    expect(SCENE_PALETTE_MAX).toBe(500);
    expect(SCENE_LIGHTING_MAX).toBe(500);
    expect(PROP_NAME_MAX).toBe(40);
    expect(PROP_APPEARANCE_MAX).toBe(1000);
    expect(PROP_NOTES_MAX).toBe(1000);
    // cardAnchors.CARD_FIELD_MAX = 160；入庫上限必須不小於注入截短
    expect(CHAR_APPEARANCE_MAX).toBeGreaterThanOrEqual(160);
    expect(PROP_APPEARANCE_MAX).toBeGreaterThanOrEqual(160);
  });
});
