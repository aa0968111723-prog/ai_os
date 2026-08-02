/**
 * WB-00 baseline: lock generate gates (viewer/editor, missing prompt/model/source,
 * incompat source, estimatePoints wiring, approval threshold, submit payload)
 * before workbench refactor.
 */
import { describe, expect, it } from "vitest";
import { estimatePoints, getModel } from "@shared/models";
import { SOURCE_INCOMPAT as SHARED_SOURCE_INCOMPAT } from "@shared/sourceIncompat";
import {
  SOURCE_INCOMPAT,
  approvalThresholdNotice,
  buildGenerationSubmitInput,
  estimateGenerationPoints,
  filterCompatibleSources,
  getGenerationDisableReason,
  isGenerateButtonDisabled,
  isUsageBasedPoints,
  projectCanEdit,
  shouldShowApprovalThresholdNotice,
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

const audioNeeds: GenerationGateModel = {
  id: "audio-needs-model",
  points: 1,
  needs: "audio",
};

const lipSync: GenerationGateModel = {
  id: "fal-ai/sync-lipsync/v2/pro",
  points: 155,
  needs: "video",
  secondaryNeeds: "audio",
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
    ).toBe("這個模型需要來源素材——請上傳本機檔、從素材庫選一個，或貼上雲端網址");
  });

  it("locks incompatible source kinds with clear messages (audio → 音訊, image → 圖片)", () => {
    // image-needs + audio source → 音訊
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

    // audio-needs + image source → 圖片
    expect(
      getGenerationDisableReason({
        canEdit: true,
        model: audioNeeds,
        prompt: "轉錄",
        sourceAsset: { id: "img-1", title: "定裝", kind: "image" },
        sourceUrl: "",
        sourceUrlError: "",
      }),
    ).toBe("選到的素材是圖片，這個模型不能用它——請換一個來源");

    // 文件／壓縮檔不是圖片來源，送出前即攔下，避免 Fal 422。
    expect(
      getGenerationDisableReason({
        canEdit: true,
        model: imageToImage,
        prompt: "改圖",
        sourceAsset: { id: "d1", title: "附件", kind: "doc" },
        sourceUrl: "",
        sourceUrlError: "",
      }),
    ).toBe("選到的素材是文件／壓縮檔，這個模型不能用它——請換一個來源");
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

  it("requires a separate audio source for lip-sync instead of treating prompt as an URL", () => {
    expect(getGenerationDisableReason({
      canEdit: true,
      model: lipSync,
      prompt: "中文配音版",
      sourceAsset: { id: "video-1", title: "人物影片", kind: "video" },
      sourceUrl: "",
      sourceUrlError: "",
    })).toBe("這個模型還需要第二個來源檔——請上傳、從素材庫選取或貼上雲端網址");

    expect(getGenerationDisableReason({
      canEdit: true,
      model: lipSync,
      prompt: "中文配音版",
      sourceAsset: { id: "video-1", title: "人物影片", kind: "video" },
      sourceUrl: "",
      sourceUrlError: "",
      secondarySourceAsset: { id: "audio-1", title: "配音", kind: "audio" },
    })).toBeNull();
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

describe("isGenerateButtonDisabled (disableReason OR submit pending)", () => {
  it("disables when reason is set or submit is pending", () => {
    expect(isGenerateButtonDisabled(null, false)).toBe(false);
    expect(isGenerateButtonDisabled("先填一句提示詞，描述想要的畫面", false)).toBe(true);
    expect(isGenerateButtonDisabled(null, true)).toBe(true);
    expect(isGenerateButtonDisabled("x", true)).toBe(true);
  });
});

describe("SOURCE_INCOMPAT + filterCompatibleSources", () => {
  it("re-exports the shared client/server incompat table (no dual-copy drift)", () => {
    // shared/sourceIncompat.ts is the single source; server generationCore imports the same module.
    expect(SOURCE_INCOMPAT).toBe(SHARED_SOURCE_INCOMPAT);
    expect([...SOURCE_INCOMPAT.image]).toEqual(["audio", "video", "doc"]);
    expect([...SOURCE_INCOMPAT.audio]).toEqual(["image", "doc"]);
    expect([...SOURCE_INCOMPAT.video]).toEqual(["audio", "image", "doc"]);
    expect([...SOURCE_INCOMPAT.zip]).toEqual(["audio", "image", "video"]);
  });

  it("filters out obviously incompatible assets but keeps the selected one", () => {
    const assets = [
      { id: "1", kind: "image" },
      { id: "2", kind: "audio" },
      { id: "3", kind: "video" },
    ];
    expect(filterCompatibleSources(assets, "image").map((a) => a.id)).toEqual(["1"]);
    // selected audio still listed so <select value> never goes blank
    expect(filterCompatibleSources(assets, "image", "2").map((a) => a.id)).toEqual(["1", "2"]);
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

describe("approval threshold notice (confirm panel)", () => {
  it("shows only for members at or above a positive threshold using estPoints", () => {
    expect(
      shouldShowApprovalThresholdNotice({ myRole: "member", approvalThreshold: 10, estPoints: 10 }),
    ).toBe(true);
    expect(
      shouldShowApprovalThresholdNotice({ myRole: "member", approvalThreshold: 10, estPoints: 9 }),
    ).toBe(false);
    expect(
      shouldShowApprovalThresholdNotice({ myRole: "leader", approvalThreshold: 10, estPoints: 99 }),
    ).toBe(false);
    expect(
      shouldShowApprovalThresholdNotice({ myRole: "member", approvalThreshold: 0, estPoints: 99 }),
    ).toBe(false);
    expect(
      shouldShowApprovalThresholdNotice({ myRole: "member", approvalThreshold: null, estPoints: 99 }),
    ).toBe(false);
  });

  it("locks the exact confirm-panel copy", () => {
    expect(approvalThresholdNotice(12, 10)).toBe(
      "⏳ 這筆需要組長核准後才會開始生成（12 點 ≥ 門檻 10 點）",
    );
  });
});

describe("buildGenerationSubmitInput (confirm 生成 payload)", () => {
  it("sends lip-sync video and audio as two real source assets", () => {
    const payload = buildGenerationSubmitInput({
      projectId: "project-1",
      model: lipSync,
      prompt: "中文配音版",
      sourceAsset: { id: "video-1", title: "人物影片", kind: "video" },
      sourceUrl: "",
      secondarySourceAsset: { id: "audio-1", title: "配音", kind: "audio" },
      secondarySourceUrl: "",
      characterIds: [],
      scenePresetIds: [],
      clientRequestId: "req-1",
    });
    expect(payload.sourceAssetId).toBe("video-1");
    expect(payload.secondarySourceAssetId).toBe("audio-1");
    expect(payload.sourceUrl).toBeUndefined();
    expect(payload.secondarySourceUrl).toBeUndefined();
  });

  it("builds the generation.submit payload with source and card optional fields", () => {
    expect(
      buildGenerationSubmitInput({
        projectId: "project-1",
        model: imageToImage,
        prompt: "  改圖  ",
        sourceAsset: { id: "asset-9", title: "底圖", kind: "image" },
        sourceUrl: "https://ignored.example/when-asset",
        characterIds: ["c1"],
        scenePresetIds: [],
        clientRequestId: "req-1",
      }),
    ).toEqual({
      projectId: "project-1",
      modelId: imageToImage.id,
      prompt: "改圖",
      sourceAssetId: "asset-9",
      sourceUrl: undefined,
      characterIds: ["c1"],
      scenePresetIds: undefined,
      continuityMode: true,
      clientRequestId: "req-1",
    });
  });

  it("uses sourceUrl only when model needs source and no asset is selected", () => {
    expect(
      buildGenerationSubmitInput({
        projectId: "p",
        model: imageToImage,
        prompt: "x",
        sourceAsset: null,
        sourceUrl: "  https://cdn.example/a.png  ",
        characterIds: [],
        scenePresetIds: ["s1"],
        clientRequestId: "req-2",
      }),
    ).toMatchObject({
      sourceAssetId: undefined,
      sourceUrl: "https://cdn.example/a.png",
      characterIds: undefined,
      scenePresetIds: ["s1"],
    });
  });

  it("omits source fields for models that do not need a source", () => {
    expect(
      buildGenerationSubmitInput({
        projectId: "p",
        model: textToImage,
        prompt: "禪",
        sourceAsset: { id: "a", title: "t", kind: "image" },
        sourceUrl: "https://x",
        characterIds: [],
        scenePresetIds: [],
        clientRequestId: "req-3",
      }),
    ).toMatchObject({
      sourceAssetId: undefined,
      sourceUrl: undefined,
    });
  });

  it("lets the user disable multi-reference locking while keeping selected cards", () => {
    expect(buildGenerationSubmitInput({
      projectId: "p",
      model: textToImage,
      prompt: "禪",
      sourceAsset: null,
      sourceUrl: "",
      characterIds: ["c1"],
      scenePresetIds: [],
      continuityMode: false,
      clientRequestId: "req-4",
    })).toMatchObject({ characterIds: ["c1"], continuityMode: false });
  });
});
