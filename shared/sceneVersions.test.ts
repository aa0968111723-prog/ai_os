import { describe, expect, it } from "vitest";
import { MODELS, getModel } from "./models";
import {
  buildSceneVersions,
  findDuplicateCurrent,
  isSceneRefineModel,
  isSceneRegenModel,
  refineGroupOf,
  summarizeSceneVersions,
  type SceneVersionGenerationRow,
} from "./sceneVersions";

function gen(over: Partial<SceneVersionGenerationRow> & { generationId: string; createdAt: string }): SceneVersionGenerationRow {
  return {
    status: "done",
    sceneRole: "visual",
    modelId: "fal-ai/fast-lightning-sdxl",
    prompt: "夕陽下的海邊",
    sourceUrl: null,
    error: null,
    pointsEst: 1,
    pointsActual: 1,
    pointsRefunded: 0,
    assetId: `asset-${over.generationId}`,
    assetUrl: `https://example.test/${over.generationId}.png`,
    assetKind: "image",
    ...over,
  };
}

describe("buildSceneVersions", () => {
  it("依 role 由舊到新編版次，回傳時新到舊", () => {
    const rows = [
      gen({ generationId: "g3", createdAt: "2026-07-03T00:00:00.000Z" }),
      gen({ generationId: "g1", createdAt: "2026-07-01T00:00:00.000Z" }),
      gen({ generationId: "g2", createdAt: "2026-07-02T00:00:00.000Z" }),
    ];
    const versions = buildSceneVersions(rows, { assetId: "asset-g2", narrationAssetId: null });
    expect(versions.map((v) => v.generationId)).toEqual(["g3", "g2", "g1"]);
    expect(versions.map((v) => v.index)).toEqual([3, 2, 1]);
  });

  it("版次不會因為新生成而跳號（第 1 版永遠是第 1 版）", () => {
    const rows = [gen({ generationId: "g1", createdAt: "2026-07-01T00:00:00.000Z" })];
    const before = buildSceneVersions(rows, { assetId: "asset-g1", narrationAssetId: null });
    const after = buildSceneVersions(
      [...rows, gen({ generationId: "g2", createdAt: "2026-07-02T00:00:00.000Z" })],
      { assetId: "asset-g1", narrationAssetId: null },
    );
    expect(before.find((v) => v.generationId === "g1")?.index).toBe(1);
    expect(after.find((v) => v.generationId === "g1")?.index).toBe(1);
    expect(after.find((v) => v.generationId === "g2")?.index).toBe(2);
  });

  it("畫面與旁白各自編號，互不影響", () => {
    const versions = buildSceneVersions(
      [
        gen({ generationId: "v1", createdAt: "2026-07-01T00:00:00.000Z" }),
        gen({ generationId: "n1", createdAt: "2026-07-02T00:00:00.000Z", sceneRole: "narration", assetKind: "audio" }),
        gen({ generationId: "v2", createdAt: "2026-07-03T00:00:00.000Z" }),
      ],
      { assetId: null, narrationAssetId: "asset-n1" },
    );
    expect(versions.find((v) => v.generationId === "v2")?.index).toBe(2);
    expect(versions.find((v) => v.generationId === "n1")?.index).toBe(1);
    expect(versions.find((v) => v.generationId === "n1")?.isCurrent).toBe(true);
  });

  it("現用只看指標，不看生成狀態；同一 role 只有一個現用", () => {
    const versions = buildSceneVersions(
      [
        gen({ generationId: "g1", createdAt: "2026-07-01T00:00:00.000Z" }),
        gen({ generationId: "g2", createdAt: "2026-07-02T00:00:00.000Z" }),
      ],
      { assetId: "asset-g1", narrationAssetId: null },
    );
    expect(versions.find((v) => v.generationId === "g1")?.state).toBe("current");
    expect(versions.find((v) => v.generationId === "g2")?.state).toBe("candidate");
    expect(findDuplicateCurrent(versions)).toEqual([]);
  });

  it("sceneRole 為 null 的舊資料視為畫面", () => {
    const versions = buildSceneVersions(
      [gen({ generationId: "g1", createdAt: "2026-07-01T00:00:00.000Z", sceneRole: null })],
      { assetId: "asset-g1", narrationAssetId: null },
    );
    expect(versions[0]!.role).toBe("visual");
    expect(versions[0]!.isCurrent).toBe(true);
  });

  it("生成中／待審／失敗各自有狀態，且都不可設為現用", () => {
    const versions = buildSceneVersions(
      [
        gen({ generationId: "run", createdAt: "2026-07-03T00:00:00.000Z", status: "running", assetId: null, assetUrl: null, assetKind: null }),
        gen({ generationId: "wait", createdAt: "2026-07-02T00:00:00.000Z", status: "awaiting_approval", assetId: null, assetUrl: null, assetKind: null }),
        gen({ generationId: "bad", createdAt: "2026-07-01T00:00:00.000Z", status: "failed", error: "供應商逾時", assetId: null, assetUrl: null, assetKind: null, pointsRefunded: 1 }),
      ],
      { assetId: null, narrationAssetId: null },
    );
    const byId = Object.fromEntries(versions.map((v) => [v.generationId, v]));
    expect(byId.run!.state).toBe("generating");
    expect(byId.wait!.state).toBe("awaiting_approval");
    expect(byId.bad!.state).toBe("failed");
    expect(versions.every((v) => !v.canSetCurrent)).toBe(true);
    // 失敗已全額退點 → 淨消耗 0，版本清單不該把退掉的點數繼續算在使用者頭上
    expect(byId.bad!.points).toBe(0);
  });

  it("已完成但素材進了回收桶：不可設為現用、也不能當底圖", () => {
    const versions = buildSceneVersions(
      [gen({ generationId: "g1", createdAt: "2026-07-01T00:00:00.000Z", assetId: null, assetUrl: null, assetKind: null })],
      { assetId: null, narrationAssetId: null },
    );
    expect(versions[0]!.canSetCurrent).toBe(false);
    expect(versions[0]!.canRefineFrom).toBe(false);
  });

  it("只有圖片可以當底圖再修（影片／音訊不行）", () => {
    const versions = buildSceneVersions(
      [
        gen({ generationId: "img", createdAt: "2026-07-01T00:00:00.000Z", assetKind: "image" }),
        gen({ generationId: "vid", createdAt: "2026-07-02T00:00:00.000Z", assetKind: "video" }),
      ],
      { assetId: null, narrationAssetId: null },
    );
    expect(versions.find((v) => v.generationId === "img")?.canRefineFrom).toBe(true);
    expect(versions.find((v) => v.generationId === "vid")?.canRefineFrom).toBe(false);
  });

  it("外部帶入的素材另立一版；已有生成紀錄指到同一素材則不重複", () => {
    const rows = [gen({ generationId: "g1", createdAt: "2026-07-02T00:00:00.000Z" })];
    const versions = buildSceneVersions(rows, { assetId: "ext-1", narrationAssetId: null }, [
      { assetId: "ext-1", assetUrl: "https://example.test/ext.png", assetKind: "image", createdAt: "2026-07-01T00:00:00.000Z", title: "加入分鏡的成品" },
      { assetId: "asset-g1", assetUrl: "https://example.test/g1.png", assetKind: "image", createdAt: "2026-07-02T00:00:00.000Z", title: "重複" },
    ]);
    expect(versions).toHaveLength(2);
    const ext = versions.find((v) => v.assetId === "ext-1")!;
    expect(ext.generationId).toBeNull();
    expect(ext.index).toBe(1); // 較早 → 第 1 版
    expect(ext.isCurrent).toBe(true);
    expect(ext.canReusePrompt).toBe(false);
  });

  it("切走後的外部素材仍留在清單，且可以切回去（版本可逆）", () => {
    const rows = [gen({ generationId: "g1", createdAt: "2026-07-02T00:00:00.000Z" })];
    const externals = [
      { assetId: "ext-1", assetUrl: "https://example.test/ext.png", assetKind: "image", createdAt: "2026-07-01T00:00:00.000Z", title: null },
    ];
    const versions = buildSceneVersions(rows, { assetId: "asset-g1", narrationAssetId: null }, externals);
    const ext = versions.find((v) => v.assetId === "ext-1")!;
    expect(ext.isCurrent).toBe(false);
    expect(ext.canSetCurrent).toBe(true);
  });

  it("createdAt 相同時版次仍穩定（用 id 決勝，不會每次查詢跳號）", () => {
    const same = "2026-07-01T00:00:00.000Z";
    const a = buildSceneVersions([gen({ generationId: "b", createdAt: same }), gen({ generationId: "a", createdAt: same })], { assetId: null, narrationAssetId: null });
    const b = buildSceneVersions([gen({ generationId: "a", createdAt: same }), gen({ generationId: "b", createdAt: same })], { assetId: null, narrationAssetId: null });
    expect(a.map((v) => v.generationId)).toEqual(b.map((v) => v.generationId));
    expect(a.find((v) => v.generationId === "a")?.index).toBe(1);
  });

  it("點數以淨消耗計（實花減退回），未結算先用預估", () => {
    const versions = buildSceneVersions(
      [
        gen({ generationId: "settled", createdAt: "2026-07-01T00:00:00.000Z", pointsEst: 2, pointsActual: 5, pointsRefunded: 1 }),
        gen({ generationId: "open", createdAt: "2026-07-02T00:00:00.000Z", status: "running", pointsEst: 3, pointsActual: null, pointsRefunded: 0 }),
      ],
      { assetId: null, narrationAssetId: null },
    );
    expect(versions.find((v) => v.generationId === "settled")?.points).toBe(4);
    expect(versions.find((v) => v.generationId === "open")?.points).toBe(3);
  });

  it("空清單不會炸", () => {
    expect(buildSceneVersions([], { assetId: null, narrationAssetId: null })).toEqual([]);
  });
});

describe("summarizeSceneVersions", () => {
  it("分別數畫面／旁白，並標出現用版次與是否有在跑的", () => {
    const versions = buildSceneVersions(
      [
        gen({ generationId: "v1", createdAt: "2026-07-01T00:00:00.000Z" }),
        gen({ generationId: "v2", createdAt: "2026-07-02T00:00:00.000Z", status: "running", assetId: null, assetUrl: null, assetKind: null }),
        gen({ generationId: "n1", createdAt: "2026-07-03T00:00:00.000Z", sceneRole: "narration", assetKind: "audio" }),
      ],
      { assetId: "asset-v1", narrationAssetId: "asset-n1" },
    );
    expect(summarizeSceneVersions(versions)).toEqual({
      visual: 2,
      narration: 1,
      generating: true,
      currentVisualIndex: 1,
      currentNarrationIndex: 1,
    });
  });
});

describe("findDuplicateCurrent", () => {
  it("投影出兩個現用時要抓得到（指標壞掉的防呆）", () => {
    const versions = buildSceneVersions(
      [
        gen({ generationId: "g1", createdAt: "2026-07-01T00:00:00.000Z", assetId: "same" }),
        gen({ generationId: "g2", createdAt: "2026-07-02T00:00:00.000Z", assetId: "same" }),
      ],
      { assetId: "same", narrationAssetId: null },
    );
    expect(findDuplicateCurrent(versions)).toEqual(["visual"]);
  });
});

describe("單格工作室的模型判斷", () => {
  it("重生模型＝不需來源的圖／影片模型", () => {
    expect(isSceneRegenModel({ kind: "image", needs: undefined })).toBe(true);
    expect(isSceneRegenModel({ kind: "video", needs: undefined })).toBe(true);
    expect(isSceneRegenModel({ kind: "image", needs: "image" })).toBe(false);
    expect(isSceneRegenModel({ kind: "audio", needs: undefined })).toBe(false);
    expect(isSceneRegenModel({ kind: "text", needs: undefined })).toBe(false);
  });

  it("修正模型＝吃圖片來源、輸出仍是畫面", () => {
    expect(isSceneRefineModel({ kind: "image", needs: "image" })).toBe(true);
    expect(isSceneRefineModel({ kind: "video", needs: "image" })).toBe(true);
    expect(isSceneRefineModel({ kind: "image", needs: undefined })).toBe(false);
    expect(isSceneRefineModel({ kind: "text", needs: "image" })).toBe(false); // 圖轉文不該回填畫面槽
    expect(isSceneRefineModel({ kind: "image", needs: "zip" })).toBe(false); // LoRA 訓練不是修圖
  });

  it("兩份清單互斥，且目錄裡真的各有模型可選", () => {
    const regen = MODELS.filter(isSceneRegenModel);
    const refine = MODELS.filter(isSceneRefineModel);
    expect(regen.length).toBeGreaterThan(0);
    expect(refine.length).toBeGreaterThan(0);
    expect(regen.some((m) => refine.includes(m))).toBe(false);
  });

  it("既有逐格生成預設模型仍在重生清單內（不會因收斂而消失）", () => {
    const fallback = getModel("fal-ai/fast-lightning-sdxl");
    expect(fallback).toBeDefined();
    expect(isSceneRegenModel(fallback!)).toBe(true);
  });

  it("修正模型分成「改圖」與「讓它動起來」兩組", () => {
    const refine = MODELS.filter(isSceneRefineModel);
    expect(refine.some((m) => refineGroupOf(m) === "image")).toBe(true);
    expect(refine.some((m) => refineGroupOf(m) === "video")).toBe(true);
  });
});
