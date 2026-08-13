import { describe, expect, it } from "vitest";
import { formatWorldviewVisualPositive, worldviewSchema } from "./worldview";
import { formatShotDirection } from "./story";
import { findPresetById, mapPresetToShotPatch, VISUAL_CHOICE_PRESETS } from "./visualChoicePresets";

describe("visual choice generation context truthfulness", () => {
  it("structured camera, lighting, and expression choices become the existing shot-direction context", () => {
    const medium = findPresetById(VISUAL_CHOICE_PRESETS, "camera.medium")!;
    const dusk = findPresetById(VISUAL_CHOICE_PRESETS, "lighting.golden_hour")!;
    const surprised = findPresetById(VISUAL_CHOICE_PRESETS, "expression.surprised")!;
    const withCamera = mapPresetToShotPatch(medium);
    const withLight = mapPresetToShotPatch(dusk, { camera: withCamera.camera });
    const withExpression = mapPresetToShotPatch(surprised);
    const context = formatShotDirection(withLight.camera, withExpression.performance);
    expect(context).toContain("中景");
    expect(context).toContain("黃昏逆光");
    expect(context).toContain("驚訝");
  });

  it("adopted Style uses durable worldview semantics already read by generationCore", () => {
    const style = findPresetById(VISUAL_CHOICE_PRESETS, "style.healing_picturebook")!;
    const worldview = worldviewSchema.parse({ styles: [style.label] });
    const context = formatWorldviewVisualPositive(worldview);
    expect(context).toContain(style.label);
  });
});
