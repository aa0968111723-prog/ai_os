/**
 * Creative Direction 變體的端到端不變式（純函式層）。
 *
 * 這一份刻意**不是** source-grep。CURRENT 的 scenes.variants.contract.test.ts 與
 * scenes.visualChoiceConcurrency.contract.test.ts 是 readFileSync + toContain：
 * 只要那幾個字串還在就綠燈，而稽核實際抓到的 preserveScenePointer 遺失（發生在
 * generation.decideCost 的 params 全欄覆寫）對那種測試完全隱形。
 * 這裡改成斷言「資料經過那些函式之後長什麼樣」。
 */
import { describe, expect, it } from "vitest";
import {
  GENERATION_SOURCE_META_KEY,
  splitGenerationSourceMeta,
  storeGenerationSourceMeta,
} from "./generationSourceMeta";
import {
  buildSceneVersions,
  groupVisualVariantBatches,
  type SceneVersionGenerationRow,
} from "./sceneVersions";
import { detectContinuityDrift, type ContinuitySnapshot, type CurrentCards } from "./continuity";
import { proposeCreativeDirections } from "./creativeProposals";

const BATCH = "11111111-1111-4111-8111-111111111111";

function genRow(over: Partial<SceneVersionGenerationRow> & { generationId: string }): SceneVersionGenerationRow {
  return {
    status: "done",
    sceneRole: "visual",
    modelId: "fal-ai/x",
    prompt: "p",
    sourceUrl: null,
    error: null,
    createdAt: "2026-08-13T00:00:00.000Z",
    pointsEst: 5,
    pointsActual: 5,
    pointsRefunded: 0,
    assetId: null,
    assetUrl: null,
    assetKind: null,
    creative: null,
    ...over,
  };
}

function creative(directionId: string, label: string, extra?: Record<string, unknown>) {
  return { batchId: BATCH, directionId, directionLabel: label, batchSize: 3, ...extra };
}

describe("source meta：方向與指標政策必須在 params 往返中存活", () => {
  it("preserveScenePointer + creative 一起寫入、一起讀回，且不進 provider 輸入", () => {
    const stored = storeGenerationSourceMeta({ prompt: "hi" }, {
      preserveScenePointer: true,
      creative: creative("low-backlight", "低機位強逆光", { parentAssetId: "a-2" }),
      scenePointerAtSubmit: "asset-1",
    });
    expect(stored[GENERATION_SOURCE_META_KEY]).toBeTruthy();

    const split = splitGenerationSourceMeta(stored);
    // provider 只拿得到真正的模型輸入
    expect(split.providerParams).toEqual({ prompt: "hi" });
    expect(split.providerParams[GENERATION_SOURCE_META_KEY]).toBeUndefined();
    expect(split.meta.preserveScenePointer).toBe(true);
    expect(split.meta.creative?.directionLabel).toBe("低機位強逆光");
    expect(split.meta.creative?.parentAssetId).toBe("a-2");
    expect(split.meta.scenePointerAtSubmit).toBe("asset-1");
  });

  it("成本核准重寫 params 時，攤平既有 meta 才不會弄丟指標政策（稽核確認的 P1）", () => {
    const original = storeGenerationSourceMeta({ prompt: "hi" }, {
      preserveScenePointer: true,
      creative: creative("closer", "更靠近人物"),
      ablation: { runId: "r1", section: "baseline" },
    });
    const parsed = splitGenerationSourceMeta(original);

    // 舊寫法：只挑兩個欄位重建 → preserveScenePointer / ablation 直接蒸發
    const naive = splitGenerationSourceMeta(storeGenerationSourceMeta(parsed.providerParams, {
      secondarySourceUrl: undefined,
      usedUserKey: undefined,
    }));
    expect(naive.meta.preserveScenePointer).toBeUndefined();
    expect(naive.meta.ablation).toBeUndefined();

    // 現行寫法：先攤平既有 meta 再覆寫真的變了的欄位
    const merged = splitGenerationSourceMeta(storeGenerationSourceMeta(parsed.providerParams, {
      ...parsed.meta,
      secondarySourceUrl: undefined,
      usedUserKey: undefined,
    }));
    expect(merged.meta.preserveScenePointer).toBe(true);
    expect(merged.meta.creative?.directionId).toBe("closer");
    expect(merged.meta.ablation?.runId).toBe("r1");
  });

  it("半截的方向註記當作沒有（不讓 UI 顯示一個沒有名字的方向）", () => {
    const split = splitGenerationSourceMeta({ [GENERATION_SOURCE_META_KEY]: { creative: { batchId: BATCH } } });
    expect(split.meta.creative).toBeUndefined();
  });
});

describe("partial failure：批次狀態由持久化真相推導，reload 後仍講得出來", () => {
  const rows = [
    genRow({ generationId: "g1", assetId: "a1", assetUrl: "/a1", assetKind: "image", creative: creative("closer", "更靠近人物") }),
    genRow({ generationId: "g2", status: "failed", error: "provider 逾時", creative: creative("low-backlight", "低機位強逆光") }),
    genRow({ generationId: "g3", status: "awaiting_approval", creative: creative("wide-isolate", "廣角孤立感") }),
  ];

  it("A 成功／B 失敗／C 等待核准三種狀態分別看得到", () => {
    const versions = buildSceneVersions(rows, { assetId: null, narrationAssetId: null });
    const [batch] = groupVisualVariantBatches(versions);
    expect(batch!.successes.map((v) => v.creative!.directionLabel)).toEqual(["更靠近人物"]);
    expect(batch!.failed.map((v) => v.creative!.directionLabel)).toEqual(["低機位強逆光"]);
    expect(batch!.awaitingApproval.map((v) => v.creative!.directionLabel)).toEqual(["廣角孤立感"]);
    // 等待核准 ≠ 已結算：不能對使用者謊稱這一批跑完了
    expect(batch!.settled).toBe(false);
  });

  it("整批不會塌成一個「失敗」——成功的方向仍然是成功的", () => {
    const versions = buildSceneVersions(rows, { assetId: null, narrationAssetId: null });
    const [batch] = groupVisualVariantBatches(versions);
    expect(batch!.successes.length).toBe(1);
    expect(batch!.requested).toBe(3);
  });

  it("同一份資料重算（＝reload 後重新查詢）得到完全一樣的批次狀態", () => {
    const first = groupVisualVariantBatches(buildSceneVersions(rows, { assetId: null, narrationAssetId: null }));
    const second = groupVisualVariantBatches(buildSceneVersions(rows, { assetId: null, narrationAssetId: null }));
    expect(JSON.stringify(second)).toEqual(JSON.stringify(first));
    expect(first[0]!.batchId).toBe(BATCH);
  });

  it("送出當下就失敗、沒落庫的 slot 算得出「還缺幾個」", () => {
    const partial = [rows[0]!, rows[1]!]; // batchSize=3，只有兩筆落庫
    const [batch] = groupVisualVariantBatches(buildSceneVersions(partial, { assetId: null, narrationAssetId: null }));
    expect(batch!.requested).toBe(3);
    expect(batch!.missing).toBe(1);
  });

  it("非變體的一般生成不會被算進任何一批", () => {
    const mixed = [...rows, genRow({ generationId: "g9", assetId: "a9", assetUrl: "/a9", assetKind: "image" })];
    const batches = groupVisualVariantBatches(buildSceneVersions(mixed, { assetId: null, narrationAssetId: null }));
    expect(batches).toHaveLength(1);
    expect(batches[0]!.versions).toHaveLength(3);
  });

  it("全部完成才算結算，並給出可並排的候選", () => {
    const done = rows.map((row, i) => genRow({
      ...row,
      generationId: `d${i}`,
      status: "done",
      assetId: `x${i}`,
      assetUrl: `/x${i}`,
      assetKind: "image",
    }));
    const [batch] = groupVisualVariantBatches(buildSceneVersions(done, { assetId: null, narrationAssetId: null }));
    expect(batch!.settled).toBe(true);
    expect(batch!.compareAssetIds).toHaveLength(3);
  });
});

describe("lineage：V2 →（變體）→ V5 追得回來，且不新增任何表", () => {
  it("parentAssetId 換算成使用者看得到的版次", () => {
    const rows = [
      genRow({ generationId: "g1", createdAt: "2026-08-13T00:00:00.000Z", assetId: "a1", assetUrl: "/a1", assetKind: "image" }),
      genRow({ generationId: "g2", createdAt: "2026-08-13T00:01:00.000Z", assetId: "a2", assetUrl: "/a2", assetKind: "image" }),
      genRow({
        generationId: "g3",
        createdAt: "2026-08-13T00:02:00.000Z",
        assetId: "a3",
        assetUrl: "/a3",
        assetKind: "image",
        creative: creative("closer", "更靠近人物", { parentAssetId: "a2" }),
      }),
    ];
    const versions = buildSceneVersions(rows, { assetId: null, narrationAssetId: null });
    const child = versions.find((v) => v.assetId === "a3")!;
    const parent = versions.find((v) => v.assetId === "a2")!;
    expect(parent.index).toBe(2);
    expect(child.index).toBe(3);
    expect(child.parentIndex).toBe(2); // 「V3 是從 V2 延伸的」
  });

  it("沒有血緣的版本 parentIndex 為 null，不會亂認父親", () => {
    const versions = buildSceneVersions(
      [genRow({ generationId: "g1", assetId: "a1", assetUrl: "/a1", assetKind: "image" })],
      { assetId: null, narrationAssetId: null },
    );
    expect(versions[0]!.parentIndex).toBeNull();
  });

  it("父版被回收（查不到）時不謊報版次", () => {
    const versions = buildSceneVersions(
      [genRow({ generationId: "g1", assetId: "a1", assetUrl: "/a1", assetKind: "image", creative: creative("c", "方向", { parentAssetId: "gone" }) })],
      { assetId: null, narrationAssetId: null },
    );
    expect(versions[0]!.parentIndex).toBeNull();
  });
});

describe("相依感知：改什麼會讓畫面過時", () => {
  const EMPTY_CARDS: CurrentCards = {
    characters: new Map(),
    scenes: new Map(),
    props: new Map(),
    looks: new Map(),
  };
  const snapshot = (shotDirection: ContinuitySnapshot["shotDirection"]): ContinuitySnapshot => ({
    version: 1,
    locked: true,
    capturedAt: "2026-08-13T00:00:00.000Z",
    fingerprint: "a".repeat(64),
    characters: [],
    scenes: [],
    props: [],
    referenceAssetIds: [],
    shotDirection,
  });
  const frozen = snapshot({ camera: { shotSize: "中景", lighting: "柔光" }, performance: { emotion: "平靜" }, action: "站著" });

  it("Camera 改了 → 畫面過時", () => {
    const drifts = detectContinuityDrift(frozen, EMPTY_CARDS, {
      camera: { shotSize: "特寫", lighting: "柔光" }, performance: { emotion: "平靜" }, action: "站著",
    });
    expect(drifts).toHaveLength(1);
    expect(drifts[0]!.kind).toBe("direction");
    expect(drifts[0]!.fields).toEqual(["shotSize"]);
  });

  it("Lighting 改了 → 畫面過時", () => {
    const drifts = detectContinuityDrift(frozen, EMPTY_CARDS, {
      camera: { shotSize: "中景", lighting: "強逆光" }, performance: { emotion: "平靜" }, action: "站著",
    });
    expect(drifts[0]!.fields).toEqual(["lighting"]);
  });

  it("Action / Performance 改了 → 畫面過時", () => {
    expect(detectContinuityDrift(frozen, EMPTY_CARDS, { ...frozen.shotDirection, action: "走過去" })[0]!.fields).toEqual(["action"]);
    expect(detectContinuityDrift(frozen, EMPTY_CARDS, { ...frozen.shotDirection, performance: { emotion: "焦慮" } })[0]!.fields).toEqual(["emotion"]);
  });

  it("配音／環境音／配樂不在快照裡 → 改它們不會讓畫面過時", () => {
    // 這三個欄位根本沒有進 shotDirection，所以「現在的鏡頭語言」與凍結的完全相同
    expect(detectContinuityDrift(frozen, EMPTY_CARDS, frozen.shotDirection)).toEqual([]);
  });

  it("完全沒改 → 不誤報", () => {
    expect(detectContinuityDrift(frozen, EMPTY_CARDS, { camera: { shotSize: "中景", lighting: "柔光" }, performance: { emotion: "平靜" }, action: "站著" })).toEqual([]);
  });

  it("舊快照沒有 shotDirection → 不比對，歷史畫面不會一夜之間全被標成過時", () => {
    expect(detectContinuityDrift(snapshot(undefined), EMPTY_CARDS, { camera: { shotSize: "特寫" } })).toEqual([]);
  });

  it("呼叫端沒有提供現況 → 不猜（與「卡片被刪不算過時」同一條原則）", () => {
    expect(detectContinuityDrift(frozen, EMPTY_CARDS, undefined)).toEqual([]);
  });
});

describe("提案不寫入任何東西", () => {
  it("提案是純函式：沒有 Promise、沒有 mutation、同輸入同輸出", () => {
    const shot = { camera: { shotSize: "中景" }, performance: null, action: null, hasVisual: true };
    const a = proposeCreativeDirections(shot);
    const b = proposeCreativeDirections(shot);
    expect(a).not.toBeInstanceOf(Promise);
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b)); // 可預測：同一鏡每次打開看到一樣的
    expect(a.length).toBeGreaterThan(0);
  });

  it("提案的輸入物件不會被就地修改", () => {
    const shot = { camera: { shotSize: "中景" }, performance: { emotion: "平靜" }, action: "站著", hasVisual: false };
    const before = JSON.stringify(shot);
    proposeCreativeDirections(shot);
    expect(JSON.stringify(shot)).toEqual(before);
  });

  it("已通過審核的鏡不主動慫恿改動", () => {
    expect(proposeCreativeDirections({ camera: null, performance: null, action: null, reviewStatus: "approved" })).toEqual([]);
  });

  it("排掉「你已經是這樣了」的方向，並且每個提案彼此不同", () => {
    const proposals = proposeCreativeDirections({ camera: { shotSize: "中景" }, performance: null, action: null }, { limit: 3 });
    expect(proposals).toHaveLength(3);
    // 一個意圖最多一個提案 → 三個提案來自三個不同角度
    expect(new Set(proposals.map((p) => p.intentId)).size).toBe(3);
    for (const proposal of proposals) expect(proposal.because.length).toBeGreaterThan(4);
  });
});
