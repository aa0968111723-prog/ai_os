import { describe, expect, it } from "vitest";
import { modelMechanicsFor } from "./modelMechanics";

describe("modelMechanicsFor", () => {
  it("describes FLUX as joint attention, not the old cross-attention U-Net", () => {
    const flux = modelMechanicsFor("fal-ai/flux/dev");
    expect(flux.family).toBe("flux-dual-stream");
    expect(flux.conditioning).toContain("Joint attention");
    expect(flux.stages.map((stage) => stage.key)).toEqual([
      "encoder",
      "double-stream",
      "single-stream",
      "latent",
      "decode",
    ]);
  });

  it("describes SDXL as cross-attention and warns about the 77-token squeeze", () => {
    const sdxl = modelMechanicsFor("fal-ai/fast-lightning-sdxl");
    expect(sdxl.family).toBe("unet");
    expect(sdxl.conditioning).toContain("Cross-attention");
    expect(sdxl.stages.find((stage) => stage.key === "cross-attn")?.detail).toContain("77");
  });

  it("routes video models to the temporal DiT explanation", () => {
    expect(modelMechanicsFor("fal-ai/kling-video/v2/master/text-to-video").family).toBe("dit");
    expect(modelMechanicsFor("fal-ai/wan/v2.5/text-to-video").stages.some((stage) => stage.key === "temporal")).toBe(true);
  });

  it("recognises LLM endpoints from the id when no category is given", () => {
    expect(modelMechanicsFor("nvidia-nim#llama-3.1-70b").family).toBe("llm");
    expect(modelMechanicsFor("anything", "llm").family).toBe("llm");
  });

  it("says attention weights are not available rather than pretending to show them", () => {
    const llm = modelMechanicsFor("nvidia-nim#llama-3.1-70b");
    const attention = llm.stages.find((stage) => stage.key === "attention");
    expect(attention?.detail).toContain("供應商不回傳這些權重");
  });

  it("admits it has no architecture data instead of inventing one", () => {
    const unknown = modelMechanicsFor("some/unlisted-model");
    expect(unknown.family).toBe("unknown");
    expect(unknown.caveat).toContain("還沒整理");
    // 文字窗口那一關仍然可查，所以還是給得出一個階段
    expect(unknown.stages).toHaveLength(1);
  });

  it("keeps the encoder stage in sync with the text-window data", () => {
    const encoderStage = modelMechanicsFor("fal-ai/flux/schnell").stages[0];
    expect(encoderStage.summary).toContain("T5-XXL");
    expect(encoderStage.detail).toContain("256");
  });
});
