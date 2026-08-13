import { describe, expect, it } from "vitest";
import {
  VISUAL_CHOICE_MANIFEST,
  VISUAL_CHOICE_PRESETS,
  findPresetById,
  listPresetsByFamily,
  mapPresetToShotPatch,
} from "./visualChoicePresets";
import { VISUAL_CHOICE_MANIFEST_VERSION } from "./visualChoiceTypes";

describe("visualChoicePresets", () => {
  it("has a stable manifest version and non-empty packs", () => {
    expect(VISUAL_CHOICE_MANIFEST.version).toBe(VISUAL_CHOICE_MANIFEST_VERSION);
    expect(VISUAL_CHOICE_PRESETS.length).toBeGreaterThan(20);
  });

  it("every preset has a stable id, family, label, and promptFragment", () => {
    const ids = new Set<string>();
    for (const p of VISUAL_CHOICE_PRESETS) {
      expect(p.id).toMatch(/^[a-z]+\.[a-z0-9_]+$/);
      expect(p.label.trim().length).toBeGreaterThan(0);
      expect(p.promptFragment.trim().length).toBeGreaterThan(0);
      expect(ids.has(p.id)).toBe(false);
      ids.add(p.id);
    }
  });

  it("listPresetsByFamily returns only that family", () => {
    const actions = listPresetsByFamily(VISUAL_CHOICE_PRESETS, "action");
    expect(actions.length).toBeGreaterThan(5);
    expect(actions.every((p) => p.family === "action")).toBe(true);
  });

  it("findPresetById works", () => {
    const p = findPresetById(VISUAL_CHOICE_PRESETS, "expression.surprised");
    expect(p?.label).toBe("驚訝");
  });

  it("mapPresetToShotPatch merges camera without wiping other fields", () => {
    const preset = findPresetById(VISUAL_CHOICE_PRESETS, "camera.close")!;
    const patch = mapPresetToShotPatch(preset, {
      camera: { shotSize: "中景", lighting: "日間自然光" },
    });
    expect(patch.camera?.shotSize).toBe("特寫");
    expect(patch.camera?.lighting).toBe("日間自然光");
  });

  it("mapPresetToShotPatch applies expression to performance.emotion", () => {
    const preset = findPresetById(VISUAL_CHOICE_PRESETS, "expression.happy")!;
    const patch = mapPresetToShotPatch(preset);
    expect(patch.performance?.emotion).toBe("開心");
  });

  it("mapPresetToShotPatch applies action text", () => {
    const preset = findPresetById(VISUAL_CHOICE_PRESETS, "action.looking_back")!;
    const patch = mapPresetToShotPatch(preset);
    expect(patch.action).toContain("回頭");
  });

  it("mapPresetToShotPatch applies lighting into camera.lighting", () => {
    const preset = findPresetById(VISUAL_CHOICE_PRESETS, "lighting.golden_hour")!;
    const patch = mapPresetToShotPatch(preset);
    expect(patch.camera?.lighting).toBe("黃昏逆光");
  });

  it("mapPresetToShotPatch carries styleHint", () => {
    const preset = findPresetById(VISUAL_CHOICE_PRESETS, "style.healing_picturebook")!;
    const patch = mapPresetToShotPatch(preset);
    expect(patch.styleHint).toBe("治癒繪本風");
  });
});
