import { describe, expect, it } from "vitest";
import {
  CHARACTER_SHEET_MODEL_ID,
  characterSheetPrompt,
  isAllowedCharacterSheetModel,
} from "./characterSheetGenerate";

describe("character sheet cheap-image path", () => {
  it("allows schnell / sdxl and refuses Veo", () => {
    expect(CHARACTER_SHEET_MODEL_ID).toBe("fal-ai/flux/schnell");
    expect(isAllowedCharacterSheetModel("fal-ai/flux/schnell")).toBe(true);
    expect(isAllowedCharacterSheetModel("fal-ai/fast-lightning-sdxl")).toBe(true);
    expect(isAllowedCharacterSheetModel("fal-ai/qwen-image-2/text-to-image")).toBe(true);
    expect(isAllowedCharacterSheetModel("fal-ai/veo3.1")).toBe(false);
    expect(isAllowedCharacterSheetModel("fal-ai/veo3.1/fast")).toBe(false);
    expect(isAllowedCharacterSheetModel("fal-ai/veo3.1/image-to-video")).toBe(false);
  });

  it("locks 小華 to 粉橘短髮女孩 and keeps 淡江 when the look names 淡大", () => {
    const locked = characterSheetPrompt("小華", "年輕男性站在淡大校門口");
    expect(locked).toContain("粉橘短髮女孩");
    expect(locked).toContain("淡江大二化工");
    expect(locked).not.toContain("年輕男性");
    expect(locked).not.toMatch(/veo/i);
  });
});
