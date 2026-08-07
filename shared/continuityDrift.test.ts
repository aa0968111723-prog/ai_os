/**
 * 過時偵測（PE 計畫 §23 / P3 Continuity Checker）。
 *
 * 這段的責任是回答「這張已經生成的圖，還跟卡片對得上嗎」。
 * 錯在兩個方向都很糟：漏報＝使用者到成片才發現傘還是紅的；
 * 誤報＝每改一個備註就跳一次「畫面過時」，提示很快被當成雜訊忽略。
 * 所以「哪些欄位算數」必須跟 cardAnchors 真正注入畫面的欄位一致，這裡逐項釘住。
 */
import { describe, it, expect } from "vitest";
import {
  detectContinuityDrift,
  describeDrift,
  type ContinuitySnapshot,
  type CurrentCards,
} from "./continuity";

const C1 = "00000000-0000-4000-8000-000000000001";
const S1 = "00000000-0000-4000-8000-000000000002";
const P1 = "00000000-0000-4000-8000-000000000003";
const L1 = "00000000-0000-4000-8000-000000000004";

function snap(over: Partial<ContinuitySnapshot> = {}): ContinuitySnapshot {
  return {
    version: 1,
    locked: true,
    capturedAt: "2026-08-01T00:00:00.000Z",
    fingerprint: "a".repeat(64),
    characters: [
      { id: C1, name: "安倢", appearance: "黑色長髮、柔和五官", notes: "溫柔", referenceAssetId: null },
    ],
    scenes: [{ id: S1, name: "克難坡", palette: "低飽和暖灰", lighting: "陰天散射", referenceAssetId: null }],
    props: [{ id: P1, name: "紅傘", appearance: "正紅油紙傘", notes: null, referenceAssetId: null }],
    referenceAssetIds: [],
    ...over,
  };
}

function cards(over: Partial<CurrentCards> = {}): CurrentCards {
  return {
    characters: new Map([[C1, { appearance: "黑色長髮、柔和五官" }]]),
    scenes: new Map([[S1, { palette: "低飽和暖灰", lighting: "陰天散射" }]]),
    props: new Map([[P1, { appearance: "正紅油紙傘" }]]),
    looks: new Map(),
    ...over,
  };
}

describe("detectContinuityDrift", () => {
  it("卡片沒動＝沒有過時（不製造假警報）", () => {
    expect(detectContinuityDrift(snap(), cards())).toEqual([]);
  });

  it("沒有快照的舊生成不亂標（無從判斷就別猜）", () => {
    expect(detectContinuityDrift(null, cards())).toEqual([]);
    expect(detectContinuityDrift(undefined, cards())).toEqual([]);
  });

  it("角色外觀改了＝過時，且用快照當時的名字（卡片可能已改名）", () => {
    const now = cards({ characters: new Map([[C1, { appearance: "俐落短髮、戴眼鏡" }]]) });
    expect(detectContinuityDrift(snap(), now)).toEqual([
      { kind: "character", id: C1, name: "安倢", fields: ["appearance"] },
    ]);
  });

  it("道具外觀改了＝過時（紅傘→黃傘正是 §23 的例子）", () => {
    const now = cards({ props: new Map([[P1, { appearance: "鮮黃油紙傘" }]]) });
    expect(detectContinuityDrift(snap(), now)).toEqual([
      { kind: "prop", id: P1, name: "紅傘", fields: ["appearance"] },
    ]);
  });

  it("場景色板與光線分開認列", () => {
    const now = cards({ scenes: new Map([[S1, { palette: "高飽和藍", lighting: "強烈直射" }]]) });
    expect(detectContinuityDrift(snap(), now)).toEqual([
      { kind: "scene", id: S1, name: "克難坡", fields: ["palette", "lighting"] },
    ]);
  });

  it("造型換了＝過時；costume 優先、退回 name（與錨點取值順序一致）", () => {
    const withLook = snap({
      characters: [{ id: C1, name: "安倢", appearance: "黑色長髮", notes: null, referenceAssetId: null, lookId: L1, lookName: "開學日", lookCostume: "米白外套" }],
    });
    const base = cards({ characters: new Map([[C1, { appearance: "黑色長髮" }]]) });

    const same = { ...base, looks: new Map([[L1, { name: "開學日", costume: "米白外套" }]]) };
    expect(detectContinuityDrift(withLook, same)).toEqual([]);

    const changed = { ...base, looks: new Map([[L1, { name: "開學日", costume: "深藍雨衣" }]]) };
    expect(detectContinuityDrift(withLook, changed)).toEqual([
      { kind: "character", id: C1, name: "安倢", fields: ["look"] },
    ]);
  });

  it("這一鏡沒鎖造型時，專案後來新增造型不算過時（誤報整批舊圖的元凶）", () => {
    const noLook = snap(); // 快照沒有 lookId＝當時沒鎖造型
    const now = cards({ looks: new Map([[L1, { name: "開學日", costume: "米白外套" }]]) });
    expect(detectContinuityDrift(noLook, now)).toEqual([]);
  });

  it("造型卡被刪掉不算過時（與「卡片被刪不算過時」同一條規則）", () => {
    const withLook = snap({
      characters: [{ id: C1, name: "安倢", appearance: "黑色長髮", notes: null, referenceAssetId: null, lookId: L1, lookName: "開學日", lookCostume: "米白外套" }],
    });
    const now = cards({ characters: new Map([[C1, { appearance: "黑色長髮" }]]), looks: new Map() });
    expect(detectContinuityDrift(withLook, now)).toEqual([]);
  });

  it("只有備註改了不算過時——notes 不進畫面，誤報會讓提示變雜訊", () => {
    // notes 根本不在 CurrentCards 裡：這個測試釘的是「我們刻意不看它」
    const now = cards({ characters: new Map([[C1, { appearance: "黑色長髮、柔和五官" }]]) });
    expect(detectContinuityDrift(snap(), now)).toEqual([]);
  });

  it("只有空白差異不算改（trim／摺疊後比對）", () => {
    const now = cards({ characters: new Map([[C1, { appearance: "  黑色長髮、柔和五官  " }]]) });
    expect(detectContinuityDrift(snap(), now)).toEqual([]);
  });

  it("卡片被刪掉不算過時（圖仍忠實反映當初設定；刪卡另有回收桶提示）", () => {
    const now = cards({ characters: new Map(), props: new Map(), scenes: new Map() });
    expect(detectContinuityDrift(snap(), now)).toEqual([]);
  });

  it("多張卡同時改，逐項列出", () => {
    const now = cards({
      characters: new Map([[C1, { appearance: "短髮" }]]),
      props: new Map([[P1, { appearance: "黃傘" }]]),
    });
    const drift = detectContinuityDrift(snap(), now);
    expect(drift).toHaveLength(2);
    expect(drift.map((d) => d.kind)).toEqual(["character", "prop"]);
  });
});

describe("describeDrift", () => {
  it("組成人看得懂的一句話", () => {
    expect(
      describeDrift([
        { kind: "character", id: C1, name: "安倢", fields: ["appearance", "look"] },
        { kind: "prop", id: P1, name: "紅傘", fields: ["appearance"] },
      ]),
    ).toBe("安倢的外觀、造型；紅傘的外觀");
  });

  it("沒過時回空字串（呼叫端據此整段不顯示）", () => {
    expect(describeDrift([])).toBe("");
  });
});
