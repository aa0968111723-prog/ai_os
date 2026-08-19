import { describe, expect, it } from "vitest";
import { cardBringInPayload, pickStudioReferenceAssetId } from "./studioReferenceImage";

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

describe("pickStudioReferenceAssetId", () => {
  it("honours 角色卡 生成時帶入 — first checked sheet", () => {
    expect(pickStudioReferenceAssetId([XIAOHUA, TURTLE], [XIAOHUA.id])).toBe(XIAOHUA.referenceAssetId);
  });

  it("checked with 0 refs omits source — text lock only", () => {
    expect(pickStudioReferenceAssetId([EMPTY_SHEET], [EMPTY_SHEET.id])).toBeUndefined();
  });

  it("trashed sheet (bound but no url) is omitted", () => {
    expect(pickStudioReferenceAssetId([TRASHED], [TRASHED.id])).toBeUndefined();
  });

  it("unchecked 0/6 does not attach another card's sheet", () => {
    expect(pickStudioReferenceAssetId([XIAOHUA, TURTLE], [])).toBeUndefined();
    expect(pickStudioReferenceAssetId([XIAOHUA, TURTLE], [TURTLE.id])).toBeUndefined();
  });
});

describe("cardBringInPayload", () => {
  it("checked + sheet sends characterIds and sourceAssetId", () => {
    expect(cardBringInPayload([XIAOHUA], [XIAOHUA.id])).toEqual({
      characterIds: [XIAOHUA.id],
      sourceAssetId: XIAOHUA.referenceAssetId,
    });
  });

  it("checked with 0 refs sends characterIds only", () => {
    expect(cardBringInPayload([EMPTY_SHEET], [EMPTY_SHEET.id])).toEqual({
      characterIds: [EMPTY_SHEET.id],
    });
  });

  it("已選 0/6 sends neither field", () => {
    expect(cardBringInPayload([XIAOHUA], [])).toEqual({});
  });
});
