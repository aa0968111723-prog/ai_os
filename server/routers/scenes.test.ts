/**
 * 單格工作室的純規則守門單元測試（scenes.refine／generateInto／setVisualFromAsset）。
 *
 * 這幾條規則擋的都是「扣了點才發現送錯」——模型目錄有 300+ 條、底圖有現用／指定／
 * 已回收／非圖片數種狀態，靠手動點畫面驗不完，所以規則抽成純函式逐條測。
 */
import { describe, expect, it } from "vitest";
import { getModel } from "../../shared/models";
import { SCRIPT_PROMPT_MAX, SCRIPT_TITLE_MAX, SCRIPT_VOICEOVER_MAX } from "../../shared/storyboardScript";
import { MAX_PROMPT_CHARS } from "./prompts";
import { cardPatchFromScript, refineRejection, regenRejection, sceneSlotForAssetKind } from "./scenes";

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

/**
 * 文字腳本寫回的欄位上限必須與單格編輯（scenes.update）同口徑。
 * 兩邊各寫一份數字，遲早有一邊被調大——那時寫回就成了繞過護欄的後門，所以用測試釘住。
 */
describe("文字腳本寫回的上限與單格編輯同口徑", () => {
  it("畫面上限＝MAX_PROMPT_CHARS", () => {
    expect(SCRIPT_PROMPT_MAX).toBe(MAX_PROMPT_CHARS);
  });

  it("標題與旁白上限是同一組常數（scenes.update 直接吃 shared 的值，不另寫數字）", () => {
    expect([SCRIPT_TITLE_MAX, SCRIPT_VOICEOVER_MAX]).toEqual([60, 2000]);
  });
});

/**
 * 文字腳本的三行卡片 → 要寫進哪幾欄。
 *
 * 名字回推卡片的規則本身在 shared/sceneCards.ts（有自己的測試）；這裡守的是接縫：
 * 不套用時**一定要出聲**、沒變的不算更新、解除要真的寫成 null。
 * 整行靜默跳過的話，使用者看到的是「更新 3 鏡」而他寫的角色一個都沒進去。
 */
describe("cardPatchFromScript（文字腳本的卡片行 → 分鏡欄位）", () => {
  const LOOKUP = {
    characters: [{ id: "c-anjie", names: ["安倢"] }, { id: "c-master", names: ["師父"] }],
    scenePresets: [{ id: "s-hall", names: ["禪堂"] }],
    props: [{ id: "p-umbrella", names: ["安倢的紅傘", "紅傘"] }],
  };
  const patchOf = (scene: Record<string, string>, current: Record<string, string[] | null> | null = null) => {
    const warnings: string[] = [];
    const patch = cardPatchFromScript(scene as never, current, LOOKUP, "第 1 鏡的", warnings);
    return { patch, warnings };
  };

  it("三行各自寫進各自的欄位", () => {
    const { patch, warnings } = patchOf({ characters: "師父・安倢", scenePresets: "禪堂", props: "紅傘" });
    expect(patch).toEqual({
      characterIds: ["c-master", "c-anjie"],
      scenePresetIds: ["s-hall"],
      propIds: ["p-umbrella"],
    });
    expect(warnings).toEqual([]);
  });

  it("「無」寫成 null，不是空陣列——空陣列會被讀成「指定了空的」", () => {
    expect(patchOf({ characters: "無" }, { characterIds: ["c-anjie"] }).patch).toEqual({ characterIds: null });
  });

  it("名單一模一樣就不算更新（連順序都一樣才算沒變）", () => {
    expect(patchOf({ characters: "安倢・師父" }, { characterIds: ["c-anjie", "c-master"] }).patch).toEqual({});
    expect(patchOf({ characters: "師父・安倢" }, { characterIds: ["c-anjie", "c-master"] }).patch).toEqual({
      characterIds: ["c-master", "c-anjie"],
    });
  });

  it("名字對不上 → 那一欄不動，而且一定講出來（靜默跳過最難查）", () => {
    const { patch, warnings } = patchOf({ characters: "安倢・小明" }, { characterIds: ["c-anjie"] });
    expect(patch).toEqual({});
    expect(warnings).toEqual([expect.stringContaining("第 1 鏡的")]);
    expect(warnings[0]).toContain("小明");
  });

  it("留白＝維持原值，並在真的有東西會被誤清時提醒怎麼解除", () => {
    const bound = patchOf({ characters: "" }, { characterIds: ["c-anjie"] });
    expect(bound.patch).toEqual({});
    expect(bound.warnings[0]).toContain("角色卡：無");
    // 沒綁卡的鏡留白是常態，不出聲
    expect(patchOf({ characters: "" }).warnings).toEqual([]);
  });

  it("沒寫卡片行的鏡完全不產生 patch（省略＝維持原值）", () => {
    expect(patchOf({}, { characterIds: ["c-anjie"] })).toEqual({ patch: {}, warnings: [] });
  });
});
