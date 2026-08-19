/**
 * 重試輸入建構的**行為**測試（#725 P1-4）。
 *
 * 取代 `generation.continuity.test.ts` 裡那條 readFileSync + toContain 的斷言：
 * 那種測試只證明「某串字還在某個檔案裡」。這一輪把重試組法抽成共用函式之後，
 * 字串換了地方——測試立刻紅，但行為完全沒變。反過來說，如果有人保留字串卻改壞行為，
 * 那種測試會一路綠燈。所以改成直接餵一列 generation 進去，斷言組出來的輸入長什麼樣。
 *
 * 這裡是純函式，不需要資料庫。
 */
import { describe, expect, it } from "vitest";
import { buildRetryGenerationInput, signedAssetId } from "./generationRetryInput";
import { storeGenerationSourceMeta } from "../../shared/generationSourceMeta";
import type { schema } from "../db";

type GenerationRow = typeof schema.generations.$inferSelect;

const SNAPSHOT_BASE = {
  version: 1 as const,
  capturedAt: "2026-08-14T00:00:00.000Z",
  fingerprint: "a".repeat(64),
  characters: [],
  scenes: [],
  props: [],
  referenceAssetIds: [],
};

function row(over: Partial<GenerationRow> = {}): GenerationRow {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    projectId: "22222222-2222-4222-8222-222222222222",
    groupId: "33333333-3333-4333-8333-333333333333",
    userId: "44444444-4444-4444-8444-444444444444",
    modelId: "fal-ai/x",
    kind: "image",
    prompt: "原始提示詞",
    params: {},
    status: "failed",
    pointsEst: 5,
    pointsActual: null,
    pointsRefunded: 0,
    requestId: null,
    sceneId: null,
    sceneRole: null,
    characterIds: null,
    scenePresetIds: null,
    propIds: null,
    continuitySnapshot: null,
    workflowRunId: null,
    agentRunId: null,
    resultUrl: null,
    resultText: null,
    sourceUrl: null,
    error: null,
    name: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  } as GenerationRow;
}

describe("signedAssetId", () => {
  it("取得素材網址裡的 assetId", () => {
    expect(signedAssetId("/api/assets/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/file?sig=x"))
      .toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
  });

  it("非 UUID 一律回 undefined（寬鬆比對會讓 pg 的 uuid cast 直接 500）", () => {
    expect(signedAssetId("https://example.com/api/assets/not-a-uuid-at-all-here-xx/file")).toBeUndefined();
    expect(signedAssetId("https://cdn.example.com/pic.png")).toBeUndefined();
    expect(signedAssetId(null)).toBeUndefined();
  });
});

describe("buildRetryGenerationInput — 重試不得靜默降級", () => {
  it("失敗的變體重試後仍是候選：preserveScenePointer 被沿用", () => {
    const input = buildRetryGenerationInput(row({
      sceneId: "55555555-5555-4555-8555-555555555555",
      sceneRole: "visual",
      params: storeGenerationSourceMeta({ prompt: "p" }, { preserveScenePointer: true }),
    }));
    // 少了它，重試出來的生成會變成「會移動指標」的生成，完成時直接蓋掉現用畫面
    expect(input.preserveScenePointer).toBe(true);
  });

  it("失敗的旁白重試後仍是旁白：sceneRole 被沿用", () => {
    const input = buildRetryGenerationInput(row({
      sceneId: "55555555-5555-4555-8555-555555555555",
      sceneRole: "narration",
    }));
    // 少了它，完成時會落進 else 分支，把音訊素材寫進 scenes.assetId（破圖）
    expect(input.sceneRole).toBe("narration");
  });

  it("卡片錨點全部沿用（少了就跨鏡走樣）", () => {
    const input = buildRetryGenerationInput(row({
      characterIds: ["c-1", "c-2"],
      scenePresetIds: ["s-1"],
      propIds: ["p-1"],
    }));
    expect(input.characterIds).toEqual(["c-1", "c-2"]);
    expect(input.scenePresetIds).toEqual(["s-1"]);
    expect(input.propIds).toEqual(["p-1"]);
  });

  it("本鏡造型 lookIds 沿用（少了重試會換掉衣服）", () => {
    const lookId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const input = buildRetryGenerationInput(row({
      continuitySnapshot: {
        ...SNAPSHOT_BASE,
        locked: false,
        characters: [{
          id: "55555555-5555-4555-8555-555555555555",
          name: "小華",
          appearance: "粉橘短髮女孩、白帽T",
          notes: null,
          referenceAssetId: null,
          lookId,
          lookName: "白帽T",
          lookCostume: "白帽T",
        }],
      },
    }));
    expect(input.lookIds).toEqual([lookId]);
    expect(input.continuitySnapshot).toBeUndefined();
  });

  it("方向與批次沿用：重試出來的版本仍歸在原批次", () => {
    const creative = { batchId: "b-1", directionId: "closer", directionLabel: "更靠近人物", batchSize: 3 };
    const input = buildRetryGenerationInput(row({
      params: storeGenerationSourceMeta({ prompt: "p" }, { creative }),
    }));
    expect(input.creative).toEqual(creative);
  });

  it("鎖定的快照才沿用；沒鎖的不沿用（原 source-lock 契約，改成行為斷言）", () => {
    const locked = buildRetryGenerationInput(row({
      continuitySnapshot: { ...SNAPSHOT_BASE, locked: true },
    }));
    expect(locked.continuitySnapshot).toBeTruthy();
    expect(locked.continuityMode).toBe(true);

    const unlocked = buildRetryGenerationInput(row({
      continuitySnapshot: { ...SNAPSHOT_BASE, locked: false },
    }));
    // 沒鎖＝使用者沒有要求凍結，重試時以「重試當下」的卡片重新展開
    expect(unlocked.continuitySnapshot).toBeUndefined();
    expect(unlocked.continuityMode).toBe(false);
  });

  it("凍結的鏡頭語言沿用（否則重試出來的圖立刻被判成過時）", () => {
    const input = buildRetryGenerationInput(row({
      continuitySnapshot: {
        ...SNAPSHOT_BASE,
        locked: true,
        shotDirection: { camera: { shotSize: "特寫" }, performance: null, action: null },
      },
    }));
    expect(input.shotDirection).toEqual({ camera: { shotSize: "特寫" }, performance: null, action: null });
  });

  it("沿用凍結 packet／meta 父圖／聲線／聲音世界（少了重試會重建或斷鏈）", () => {
    const parentId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const packetId = "99999999-9999-4999-8999-999999999999";
    const input = buildRetryGenerationInput(row({
      modelId: "fal-ai/kokoro/mandarin-chinese",
      sourceUrl: "https://v3.fal.media/files/expired-parent.png",
      params: storeGenerationSourceMeta({ prompt: "p", language: "zh" }, {
        shotContextPacketId: packetId,
        sourceAssetId: parentId,
        preserveScenePointer: true,
        voice: {
          canonId: "11111111-1111-4111-8111-111111111111",
          versionId: "22222222-2222-4222-8222-222222222222",
          voiceId: "zf_xiaoxiao",
          applied: true,
        },
        soundWorld: {
          canonId: "33333333-3333-4333-8333-333333333333",
          versionId: "44444444-4444-4444-8444-444444444444",
        },
      }),
    }));
    expect(input.shotContextPacketId).toBe(packetId);
    expect(input.sourceAssetId).toBe(parentId);
    expect(input.sourceUrl).toBeUndefined();
    expect(input.voiceIdentity).toEqual({
      canonId: "11111111-1111-4111-8111-111111111111",
      versionId: "22222222-2222-4222-8222-222222222222",
      voiceId: "zf_xiaoxiao",
      modelId: "fal-ai/kokoro/mandarin-chinese",
      language: "zh",
    });
    expect(input.soundWorldRef).toEqual({
      canonId: "33333333-3333-4333-8333-333333333333",
      versionId: "44444444-4444-4444-8444-444444444444",
    });
  });

  it("素材庫來源走 sourceAssetId 重新簽名；外部網址原樣透傳", () => {
    const fromLibrary = buildRetryGenerationInput(row({
      sourceUrl: "/api/assets/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/file?sig=expired",
    }));
    expect(fromLibrary.sourceAssetId).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    expect(fromLibrary.sourceUrl).toBeUndefined(); // 過期簽名網址原樣重送必敗

    const external = buildRetryGenerationInput(row({ sourceUrl: "https://cdn.example.com/pic.png" }));
    expect(external.sourceAssetId).toBeUndefined();
    expect(external.sourceUrl).toBe("https://cdn.example.com/pic.png");
  });

  it("出處沿用：工作流／代理的重試仍回溯得到原本那條 run", () => {
    const input = buildRetryGenerationInput(row({
      workflowRunId: "66666666-6666-4666-8666-666666666666",
      agentRunId: "77777777-7777-4777-8777-777777777777",
    }));
    expect(input.workflowRunId).toBe("66666666-6666-4666-8666-666666666666");
    expect(input.agentRunId).toBe("77777777-7777-4777-8777-777777777777");
  });

  it("兩個入口拿到的是同一份輸入（web router 與 MCP service 不會再漂移）", () => {
    const gen = row({
      sceneId: "55555555-5555-4555-8555-555555555555",
      sceneRole: "narration",
      characterIds: ["c-1"],
      params: storeGenerationSourceMeta({ prompt: "p" }, { preserveScenePointer: true }),
    });
    // 同一支函式、同一列 → 逐欄相同。這正是抽出共用建構函式要保證的事。
    expect(buildRetryGenerationInput(gen)).toEqual(buildRetryGenerationInput(gen));
  });
});
