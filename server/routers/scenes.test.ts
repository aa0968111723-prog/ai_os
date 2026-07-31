/**
 * 單格工作室的純規則守門單元測試（scenes.refine／generateInto／setVisualFromAsset）。
 *
 * 這幾條規則擋的都是「扣了點才發現送錯」——模型目錄有 300+ 條、底圖有現用／指定／
 * 已回收／非圖片數種狀態，靠手動點畫面驗不完，所以規則抽成純函式逐條測。
 */
import { describe, expect, it } from "vitest";
import { getModel } from "../../shared/models";
import { refineRejection, regenRejection, sceneSlotForAssetKind } from "./scenes";

const PROJECT = "p-1";
const imageSource = { projectId: PROJECT, kind: "image" };
/** 目錄裡真實存在的兩支模型：文生圖（重生用）與圖生圖（修正用） */
const textToImage = getModel("fal-ai/fast-lightning-sdxl");
const imageToImage = getModel("fal-ai/flux-pro/kontext");

function refine(over: Partial<Parameters<typeof refineRejection>[0]> = {}) {
  return refineRejection({
    model: imageToImage,
    prompt: "把天空換成黃昏，其餘不變",
    sourceAssetId: "a-1",
    source: imageSource,
    sceneProjectId: PROJECT,
    ...over,
  });
}

describe("refineRejection（以這張為底圖修正）", () => {
  it("目錄裡確實有這兩支模型可用（測試前提不會因目錄異動而默默失效）", () => {
    expect(textToImage).toBeDefined();
    expect(imageToImage).toBeDefined();
    expect(imageToImage!.needs).toBe("image");
  });

  it("合規：圖生圖模型＋有指示＋底圖是本專案的圖片", () => {
    expect(refine()).toBeNull();
  });

  it("模型不吃底圖（文生圖）→ 擋下，不讓它白跑一趟", () => {
    expect(refine({ model: textToImage })).toContain("吃底圖");
  });

  it("未知模型 → 擋下", () => {
    expect(refine({ model: undefined })).toContain("吃底圖");
  });

  it("沒寫修改指示（空白或全空白字元）→ 擋下並示範怎麼寫", () => {
    expect(refine({ prompt: "" })).toContain("要改哪裡");
    expect(refine({ prompt: "   \n " })).toContain("要改哪裡");
  });

  it("這一格還沒有畫面 → 指路去「生成這一格」或挑一版當底圖", () => {
    expect(refine({ sourceAssetId: null, source: undefined })).toContain("還沒有畫面");
  });

  it("底圖查無（已進回收桶）→ 擋下", () => {
    expect(refine({ source: undefined })).toContain("不屬於本專案");
  });

  it("底圖屬於別的專案 → 擋下（跨專案誤指）", () => {
    expect(refine({ source: { projectId: "p-other", kind: "image" } })).toContain("不屬於本專案");
  });

  it("底圖不是圖片（影片／音訊版本）→ 擋下", () => {
    expect(refine({ source: { projectId: PROJECT, kind: "video" } })).toContain("底圖必須是圖片");
    expect(refine({ source: { projectId: PROJECT, kind: "audio" } })).toContain("底圖必須是圖片");
  });

  it("先擋模型再擋指示：送錯模型時不會誤報成「沒寫指示」", () => {
    expect(refine({ model: textToImage, prompt: "" })).toContain("吃底圖");
  });
});

describe("regenRejection（生成／重生這一格）", () => {
  it("文生圖模型放行", () => {
    expect(regenRejection(textToImage)).toBeNull();
  });

  it("需要底圖的模型 → 指路去單格工作室的修正（不要等扣點後才報看不懂的錯）", () => {
    const msg = regenRejection(imageToImage);
    expect(msg).toContain("需要底圖");
    expect(msg).toContain(imageToImage!.label);
  });

  it("非畫面模型（TTS／LLM）→ 擋下", () => {
    expect(regenRejection(getModel("fal-ai/kokoro/mandarin-chinese"))).toContain("圖像或影片");
    expect(regenRejection(undefined)).toContain("圖像或影片");
  });
});

describe("sceneSlotForAssetKind（版本切回哪個槽）", () => {
  it("音訊進旁白槽，圖／影進主畫面槽", () => {
    expect(sceneSlotForAssetKind("audio")).toBe("narrationAssetId");
    expect(sceneSlotForAssetKind("image")).toBe("assetId");
    expect(sceneSlotForAssetKind("video")).toBe("assetId");
  });

  it("文件等其他型態不能當分鏡素材", () => {
    expect(sceneSlotForAssetKind("doc")).toBeNull();
    expect(sceneSlotForAssetKind("")).toBeNull();
  });
});
