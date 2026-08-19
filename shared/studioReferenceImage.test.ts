import { describe, expect, it } from "vitest";
import {
  defaultStudioBringInIds,
  pickStudioReferenceAssetId,
  studioGenerateCardPayload,
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

describe("pickStudioReferenceAssetId", () => {
  it("sends the first selected character sheet", () => {
    expect(pickStudioReferenceAssetId([XIAOHUA, TURTLE], [XIAOHUA.id])).toBe(XIAOHUA.referenceAssetId);
  });

  it("empty sheet is omitted — generate must not 500", () => {
    expect(pickStudioReferenceAssetId([EMPTY_SHEET], [EMPTY_SHEET.id])).toBeUndefined();
  });

  it("trashed sheet (bound but no url) is omitted", () => {
    expect(pickStudioReferenceAssetId([TRASHED], [TRASHED.id])).toBeUndefined();
  });

  it("unchecked character does not attach another card's sheet", () => {
    expect(pickStudioReferenceAssetId([XIAOHUA, TURTLE], [TURTLE.id])).toBeUndefined();
  });
});

describe("defaultStudioBringInIds", () => {
  it("reuses workbench selection when those cards still exist", () => {
    expect(defaultStudioBringInIds([XIAOHUA, TURTLE], [TURTLE.id])).toEqual([TURTLE.id]);
  });

  it("defaults to project characters so studio is not stuck at 0/6", () => {
    expect(defaultStudioBringInIds([XIAOHUA, TURTLE], [])).toEqual([XIAOHUA.id, TURTLE.id]);
  });
});

describe("studioGenerateCardPayload", () => {
  it("attaches sheet + characterIds when the sheet exists", () => {
    expect(studioGenerateCardPayload([XIAOHUA], [XIAOHUA.id])).toEqual({
      characterIds: [XIAOHUA.id],
      sourceAssetId: XIAOHUA.referenceAssetId,
    });
  });

  it("empty sheet sends characterIds only", () => {
    expect(studioGenerateCardPayload([EMPTY_SHEET], [EMPTY_SHEET.id])).toEqual({
      characterIds: [EMPTY_SHEET.id],
    });
  });

  it("nothing selected sends neither field", () => {
    expect(studioGenerateCardPayload([XIAOHUA], [])).toEqual({});
  });
});
