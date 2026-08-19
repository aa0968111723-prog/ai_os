import { describe, expect, it } from "vitest";
import {
  cardBringInPayload,
  characterHasLiveSheet,
  honorExplicitCharacterSheet,
  pickStudioReferenceAssetId,
  selectableBringInIds,
} from "./studioReferenceImage";

const XIAOHUA = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "小華",
  referenceAssetId: "22222222-2222-4222-8222-222222222222",
  referenceUrl: "https://example.test/xiaohua-sheet.png",
};
const EMPTY_SHEET = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "小華",
  referenceAssetId: null,
  referenceUrl: null,
};
const TRASHED = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "小華",
  referenceAssetId: "22222222-2222-4222-8222-222222222222",
  referenceUrl: null,
};
const TURTLE = {
  id: "33333333-3333-4333-8333-333333333333",
  name: "禪定龜龜",
  referenceAssetId: null,
  referenceUrl: null,
};
const STRAY = "44444444-4444-4444-8444-444444444444";

describe("characterHasLiveSheet", () => {
  it("only 小華’s own live 定裝參考圖 counts", () => {
    expect(characterHasLiveSheet(XIAOHUA)).toBe(true);
    expect(characterHasLiveSheet(EMPTY_SHEET)).toBe(false);
    expect(characterHasLiveSheet(TRASHED)).toBe(false);
    expect(characterHasLiveSheet(TURTLE)).toBe(false);
  });
});

describe("selectableBringInIds", () => {
  it("0 refs stays 0/6 even if the checkbox was ticked", () => {
    expect(selectableBringInIds([EMPTY_SHEET], [EMPTY_SHEET.id])).toEqual([]);
  });

  it("live 小華 sheet may become 1/6", () => {
    expect(selectableBringInIds([XIAOHUA], [XIAOHUA.id])).toEqual([XIAOHUA.id]);
  });
});

describe("pickStudioReferenceAssetId", () => {
  it("honours 角色卡 生成時帶入 — that character's own sheet", () => {
    expect(pickStudioReferenceAssetId([XIAOHUA, TURTLE], [XIAOHUA.id])).toBe(XIAOHUA.referenceAssetId);
  });

  it("0 refs omits source — text lock only", () => {
    expect(pickStudioReferenceAssetId([EMPTY_SHEET], [EMPTY_SHEET.id])).toBeUndefined();
  });

  it("does not attach another card's sheet", () => {
    expect(pickStudioReferenceAssetId([XIAOHUA, TURTLE], [TURTLE.id])).toBeUndefined();
  });
});

describe("cardBringInPayload", () => {
  it("checked + 小華 sheet sends characterIds and sourceAssetId", () => {
    expect(cardBringInPayload([XIAOHUA], [XIAOHUA.id])).toEqual({
      characterIds: [XIAOHUA.id],
      sourceAssetId: XIAOHUA.referenceAssetId,
    });
  });

  it("0 refs stays empty — no 1/6, no stray source", () => {
    expect(cardBringInPayload([EMPTY_SHEET], [EMPTY_SHEET.id])).toEqual({});
  });
});

describe("honorExplicitCharacterSheet", () => {
  it("drops an arbitrary 1/50 that is not 小華’s 定裝", () => {
    expect(honorExplicitCharacterSheet([XIAOHUA], [XIAOHUA.id], STRAY)).toBe(XIAOHUA.referenceAssetId);
    expect(honorExplicitCharacterSheet([EMPTY_SHEET], [EMPTY_SHEET.id], STRAY)).toBeUndefined();
  });

  it("accepts explicit only when it is that character's own sheet", () => {
    expect(honorExplicitCharacterSheet([XIAOHUA], [XIAOHUA.id], XIAOHUA.referenceAssetId)).toBe(
      XIAOHUA.referenceAssetId,
    );
  });
});
