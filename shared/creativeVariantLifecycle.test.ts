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
import { compileDirection, diagnoseDirectionBatch } from "./creativeDirections";

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

/**
 * Fresh-eye 第三輪（Production Reliability）確認缺陷的回歸鎖。
 * 每一條都對應一個「測試綠燈但行為已壞」的實際情境。
 */
describe("多樣性守門必須真的會亮（instruction 不得掩蓋『這一鏡已經是這樣了』）", () => {
  const shot = { camera: { shotSize: "特寫" }, performance: null, action: null };

  it("方向帶了自己的 instruction，仍然算得出結構化上沒差", () => {
    const compiled = compileDirection(shot, {
      id: "closer",
      label: "更靠近人物",
      camera: { shotSize: "特寫" },
      instruction: "臉不要改",
    });
    expect(compiled.differs).toBe(true);            // 有自然語言內容
    expect(compiled.structurallyDiffers).toBe(false); // 但結構上這一鏡已經是特寫了
  });

  it("diagnoseDirectionBatch 以結構化差異判定 no-op，否則守門永遠不亮", () => {
    const report = diagnoseDirectionBatch(shot, [
      { id: "closer", label: "更靠近人物", camera: { shotSize: "特寫" }, instruction: "臉不要改" },
      { id: "low", label: "低機位", camera: { angle: "低角度" }, instruction: "壓暗背景" },
    ]);
    expect(report.noop).toEqual(["closer"]);
  });

  it("起手包對「已經是特寫」的鏡，提案不再建議「更靠近人物」", () => {
    const proposals = proposeCreativeDirections({ camera: { shotSize: "特寫" }, performance: null, action: null });
    expect(proposals.map((p) => p.direction.id)).not.toContain("closer");
  });

  it("不同的鏡拿到不同的提案（提案是 shot-aware，不是固定三張卡）", () => {
    const plain = proposeCreativeDirections({ camera: { shotSize: "中景" }, performance: null, action: null });
    const closeUp = proposeCreativeDirections({ camera: { shotSize: "特寫", angle: "低角度" }, performance: null, action: null });
    expect(plain.map((p) => p.direction.id)).not.toEqual(closeUp.map((p) => p.direction.id));
  });
});

describe("重試必須沿用方向與批次（否則重試出來的版本會脫離它那一批）", () => {
  it("meta.creative 經過一次 store→split 往返仍完整，可直接餵回 executeGenerationCommand", () => {
    const stored = storeGenerationSourceMeta({ prompt: "p" }, {
      preserveScenePointer: true,
      creative: creative("low-backlight", "低機位強逆光", { parentAssetId: "a-2", batchSize: 3 }),
    });
    const { meta } = splitGenerationSourceMeta(stored);
    // retry 會把這一份原樣轉交；欄位缺一個，重試出來的版本就分不回原批
    expect(meta.creative).toEqual({
      batchId: BATCH,
      directionId: "low-backlight",
      directionLabel: "低機位強逆光",
      parentAssetId: "a-2",
      batchSize: 3,
    });
  });

  it("重試沿用同一個 batchId → 仍然歸在同一批，不會變成孤兒版本", () => {
    const rows = [
      genRow({ generationId: "g1", assetId: "a1", assetUrl: "/a1", assetKind: "image", creative: creative("closer", "更靠近人物") }),
      // g2 失敗、g2r 是它的重試——沿用同一個 batchId
      genRow({ generationId: "g2", status: "failed", creative: creative("low-backlight", "低機位強逆光") }),
      genRow({ generationId: "g2r", assetId: "a2", assetUrl: "/a2", assetKind: "image", creative: creative("low-backlight", "低機位強逆光") }),
    ];
    const batches = groupVisualVariantBatches(buildSceneVersions(rows, { assetId: null, narrationAssetId: null }));
    expect(batches).toHaveLength(1);
    expect(batches[0]!.successes).toHaveLength(2);
    expect(batches[0]!.failed).toHaveLength(1);
  });
});


/**
 * #725 P1-7：連戲／過時引擎原本看不見任何面板寫入。
 *
 * 原始 finding：detectContinuityDrift 只迭代**凍結快照**並比對卡片**內容文字**，
 * 從不比對該鏡當下綁了哪些 id。換 Look、加減角色、換場景——#722/#723 面板的全部意義——
 * 都不會被標「畫面過時」。
 */
describe("#725 P1-7 換卡片同樣讓畫面過時（綁定漂移）", () => {
  const CHAR_A = "aaaaaaaa-1111-4111-8111-111111111111";
  const CHAR_B = "bbbbbbbb-1111-4111-8111-111111111111";
  const LOOK_1 = "11111111-2222-4222-8222-222222222222";
  const LOOK_2 = "22222222-2222-4222-8222-222222222222";
  const SCENE_1 = "33333333-3333-4333-8333-333333333333";
  const SCENE_2 = "44444444-3333-4333-8333-333333333333";
  const PROP_1 = "55555555-4444-4444-8444-444444444444";
  /** 造型的擁有者要查得到，綁定漂移才分得出「換造型」與「孤兒造型」 */
  const EMPTY_CARDS: CurrentCards = {
    characters: new Map(), scenes: new Map(), props: new Map(),
    looks: new Map([
      [LOOK_1, { name: "L1", costume: null, characterId: CHAR_A }],
      [LOOK_2, { name: "L2", costume: null, characterId: CHAR_A }],
    ]),
  };

  /** 生成當下綁了：角色 A（造型 LOOK_1）、場景 1、道具 1 */
  const frozen: ContinuitySnapshot = {
    version: 1,
    locked: true,
    capturedAt: "2026-08-14T00:00:00.000Z",
    fingerprint: "a".repeat(64),
    characters: [{ id: CHAR_A, name: "安倢", appearance: "黑色長髮", notes: null, referenceAssetId: null, lookId: LOOK_1 }],
    scenes: [{ id: SCENE_1, name: "晨光禪堂", palette: "米白", lighting: null, referenceAssetId: null }],
    props: [{ id: PROP_1, name: "紅傘", appearance: "紅色", notes: null, referenceAssetId: null }],
    referenceAssetIds: [],
  };
  const sameBindings = {
    characterIds: [CHAR_A], lookIds: [LOOK_1], scenePresetIds: [SCENE_1], propIds: [PROP_1],
  };

  it("綁定完全沒動 → 不誤報", () => {
    expect(detectContinuityDrift(frozen, EMPTY_CARDS, undefined, sameBindings)).toEqual([]);
  });

  it("換 Look（面板把 Look A 換成 B）→ 這一鏡被標為過時", () => {
    const drifts = detectContinuityDrift(frozen, EMPTY_CARDS, undefined, { ...sameBindings, lookIds: [LOOK_2] });
    expect(drifts).toHaveLength(1);
    expect(drifts[0]!.kind).toBe("binding");
    expect(drifts[0]!.fields).toEqual(["looks"]);
  });

  it("加一個角色 → 過時", () => {
    const drifts = detectContinuityDrift(frozen, EMPTY_CARDS, undefined, { ...sameBindings, characterIds: [CHAR_A, CHAR_B] });
    expect(drifts[0]!.fields).toEqual(["characters"]);
  });

  it("換場景 → 過時", () => {
    const drifts = detectContinuityDrift(frozen, EMPTY_CARDS, undefined, { ...sameBindings, scenePresetIds: [SCENE_2] });
    expect(drifts[0]!.fields).toEqual(["scenes"]);
  });

  it("加道具 → 過時", () => {
    const drifts = detectContinuityDrift(frozen, EMPTY_CARDS, undefined, {
      ...sameBindings, propIds: [PROP_1, "66666666-4444-4444-8444-444444444444"],
    });
    expect(drifts[0]!.fields).toEqual(["props"]);
  });

  it("移除道具刻意**不**報過時（快照因自動帶入合法地比綁定多，雙向比會誤報）", () => {
    // mergePropIdsWithCarried 會把掛在角色/場景底下的道具自動帶進生成，
    // 但 scenes.propIds 不會跟著變 ⇒ 快照 ⊇ 綁定。寧可漏報也不要每張圖一出生就過時。
    expect(detectContinuityDrift(frozen, EMPTY_CARDS, undefined, { ...sameBindings, propIds: [] })).toEqual([]);
  });

  it("這一鏡完全沒有自己的卡片綁定 → 不比對（生成用的是生成台的 fallback 勾選）", () => {
    expect(detectContinuityDrift(frozen, EMPTY_CARDS, undefined, {
      characterIds: [], lookIds: [], scenePresetIds: [], propIds: [],
    })).toEqual([]);
  });

  it("順序不同不算差異（id 集合語意）", () => {
    const twoChars: ContinuitySnapshot = {
      ...frozen,
      characters: [
        { id: CHAR_A, name: "安倢", appearance: "x", notes: null, referenceAssetId: null, lookId: LOOK_1 },
        { id: CHAR_B, name: "慕恩", appearance: "y", notes: null, referenceAssetId: null, lookId: null },
      ],
    };
    const drifts = detectContinuityDrift(twoChars, EMPTY_CARDS, undefined, {
      ...sameBindings, characterIds: [CHAR_B, CHAR_A],
    });
    expect(drifts).toEqual([]);
  });

  it("呼叫端沒傳綁定 → 不比對（無從判斷就別猜，舊呼叫端維持既有行為）", () => {
    expect(detectContinuityDrift(frozen, EMPTY_CARDS, undefined, undefined)).toEqual([]);
  });

  it("孤兒造型不算漂移：造型掛在鏡上但它的角色沒被綁，生成時本來就沒注入", () => {
    // e2e「卡片沒動時不誤報過時」實際踩到的情形：該鏡有 lookIds 但 characterIds 是 null
    const orphanFrozen: ContinuitySnapshot = { ...frozen, characters: [] };
    expect(detectContinuityDrift(orphanFrozen, EMPTY_CARDS, undefined, {
      characterIds: [], lookIds: [LOOK_1], scenePresetIds: [SCENE_1], propIds: [PROP_1],
    })).toEqual([]);
  });

  it("查不到擁有者的造型同樣不比（無從判斷就別猜）", () => {
    const unknownLook = "99999999-2222-4222-8222-222222222222";
    expect(detectContinuityDrift(frozen, EMPTY_CARDS, undefined, {
      ...sameBindings, lookIds: [LOOK_1, unknownLook],
    })).toEqual([]);
  });
});
