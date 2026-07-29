/**
 * WB-00 baseline: lock generate gates (viewer/editor, missing prompt/model/source,
 * incompat source, estimatePoints wiring) before workbench refactor.
 */
import { describe, expect, it } from "vitest";
import { estimatePoints, getModel } from "@shared/models";
import {
  SOURCE_INCOMPAT,
  estimateGenerationPoints,
  filterCompatibleSources,
  getGenerationDisableReason,
  isUsageBasedPoints,
  projectCanEdit,
  type GenerationGateModel,
} from "../generationGates";

const textToImage: GenerationGateModel = {
  id: "fal-ai/flux/schnell",
  points: 1,
  needs: null,
};

const imageToImage: GenerationGateModel = {
  id: "fal-ai/flux/dev/image-to-image",
  points: 2,
  needs: "image",
};

const emptySource = {
  sourceAsset: null as null,
  sourceUrl: "",
  sourceUrlError: "",
};

describe("projectCanEdit (viewer / editor / archived role baseline)", () => {
  it("viewer cannot edit; other roles can", () => {
    expect(projectCanEdit("viewer")).toBe(false);
    expect(projectCanEdit("member")).toBe(true);
    expect(projectCanEdit("leader")).toBe(true);
    expect(projectCanEdit("owner")).toBe(true);
    // archived is a project status, not a role — role still drives canEdit
    expect(projectCanEdit(undefined)).toBe(true);
    expect(projectCanEdit(null)).toBe(true);
  });
});

describe("getGenerationDisableReason", () => {
  it("locks viewer with the exact read-only message", () => {
    expect(
      getGenerationDisableReason({
        canEdit: false,
        model: textToImage,
        prompt: "禪堂清晨",
        ...emptySource,
      }),
    ).toBe("你在此專案是檢視者（唯讀），不能生成——需要編輯請組長到「成員權限」調整");
  });

  it("locks when model list is still loading", () => {
    expect(
      getGenerationDisableReason({
        canEdit: true,
        model: null,
        prompt: "禪堂清晨",
        ...emptySource,
      }),
    ).toBe("模型清單還在載入，稍等一下就能生成");
  });

  it("locks when prompt is empty or whitespace", () => {
    expect(
      getGenerationDisableReason({
        canEdit: true,
        model: textToImage,
        prompt: "   ",
        ...emptySource,
      }),
    ).toBe("先填一句提示詞，描述想要的畫面");
  });

  it("locks models that need a source when none is provided", () => {
    expect(
      getGenerationDisableReason({
        canEdit: true,
        model: imageToImage,
        prompt: "把這張圖改成水墨風",
        ...emptySource,
      }),
    ).toBe("這個模型需要來源素材——從素材庫選一個，或貼上網址");
  });

  it("locks incompatible source kinds with a clear message", () => {
    expect(
      getGenerationDisableReason({
        canEdit: true,
        model: imageToImage,
        prompt: "改圖",
        sourceAsset: { id: "a1", title: "旁白", kind: "audio" },
        sourceUrl: "",
        sourceUrlError: "",
      }),
    ).toBe("選到的素材是音訊，這個模型不能用它——請換一個來源");
  });

  it("locks bad source URLs", () => {
    expect(
      getGenerationDisableReason({
        canEdit: true,
        model: imageToImage,
        prompt: "改圖",
        sourceAsset: null,
        sourceUrl: "ftp://example.com/x.png",
        sourceUrlError: "需以 https:// 開頭",
      }),
    ).toBe("網址格式不對，需以 https:// 開頭");
  });

  it("allows editor with prompt and no-source model", () => {
    expect(
      getGenerationDisableReason({
        canEdit: true,
        model: textToImage,
        prompt: "清晨禪堂，柔和光線",
        ...emptySource,
      }),
    ).toBeNull();
  });

  it("allows model-with-needs when source asset is present and compatible", () => {
    expect(
      getGenerationDisableReason({
        canEdit: true,
        model: imageToImage,
        prompt: "改圖",
        sourceAsset: { id: "img-1", title: "定裝", kind: "image" },
        sourceUrl: "",
        sourceUrlError: "",
      }),
    ).toBeNull();
  });

  it("viewer message wins over missing prompt (priority baseline)", () => {
    expect(
      getGenerationDisableReason({
        canEdit: false,
        model: null,
        prompt: "",
        ...emptySource,
      }),
    ).toBe("你在此專案是檢視者（唯讀），不能生成——需要編輯請組長到「成員權限」調整");
  });
});

describe("SOURCE_INCOMPAT + filterCompatibleSources", () => {
  it("keeps the same incompat table as generation.submit policy", () => {
    expect(SOURCE_INCOMPAT.image).toEqual(["audio"]);
    expect(SOURCE_INCOMPAT.audio).toEqual(["image"]);
    expect(SOURCE_INCOMPAT.video).toEqual(["audio"]);
  });

  it("filters out obviously incompatible assets but keeps the selected one", () => {
    const assets = [
      { id: "1", kind: "image" },
      { id: "2", kind: "audio" },
      { id: "3", kind: "video" },
    ];
    expect(filterCompatibleSources(assets, "image").map((a) => a.id)).toEqual(["1", "3"]);
    // selected audio still listed so <select value> never goes blank
    expect(filterCompatibleSources(assets, "image", "2").map((a) => a.id)).toEqual(["1", "2", "3"]);
  });
});

describe("estimateGenerationPoints (shared estimatePoints wiring)", () => {
  it("uses shared estimatePoints for full models (TTS scales with chars)", () => {
    const ttsId = "fal-ai/elevenlabs/tts/eleven-v3";
    const full = getModel(ttsId)!;
    const model: GenerationGateModel = { id: ttsId, points: full.points, needs: null };

    expect(estimateGenerationPoints(model, 1000)).toBe(estimatePoints(full, { promptChars: 1000 }));
    expect(estimateGenerationPoints(model, 2000)).toBe(estimatePoints(full, { promptChars: 2000 }));
    expect(estimateGenerationPoints(model, 2000)).toBeGreaterThan(estimateGenerationPoints(model, 1000));
  });

  it("keeps flat points for text-to-image", () => {
    const full = getModel(textToImage.id)!;
    expect(estimateGenerationPoints(textToImage, 9999)).toBe(full.points);
    expect(isUsageBasedPoints(textToImage.id)).toBe(false);
  });

  it("marks usage-based TTS models for the confirm-panel hint", () => {
    expect(isUsageBasedPoints("fal-ai/elevenlabs/tts/eleven-v3")).toBe(true);
  });

  it("falls back to list points when full model is missing", () => {
    const orphan: GenerationGateModel = { id: "missing/model", points: 7, needs: null };
    expect(estimateGenerationPoints(orphan, 500, () => undefined)).toBe(7);
    expect(estimateGenerationPoints(null, 10)).toBe(0);
  });
});
