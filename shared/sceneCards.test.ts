/**
 * 逐鏡卡片綁定的解析規則：有綁就整組用它，沒綁才沿用生成台勾選。
 * 這條「整組」規則是關鍵——逐欄補會讓「這鏡不要人」永遠表達不出來。
 */
import { describe, expect, it } from "vitest";
import { formatSceneCardNames, hasSceneCardBinding, resolveSceneCards } from "./sceneCards";

const FALLBACK = { characterIds: ["g-char"], scenePresetIds: ["g-scene"], propIds: ["g-prop"] };

describe("hasSceneCardBinding", () => {
  it("任一種非空就算有指定", () => {
    expect(hasSceneCardBinding({ characterIds: ["a"] })).toBe(true);
    expect(hasSceneCardBinding({ propIds: ["a"] })).toBe(true);
  });

  it("全空／全 null／未傳都算沒指定", () => {
    expect(hasSceneCardBinding({ characterIds: [], scenePresetIds: [], propIds: [] })).toBe(false);
    expect(hasSceneCardBinding({ characterIds: null, scenePresetIds: null, propIds: null })).toBe(false);
    expect(hasSceneCardBinding(null)).toBe(false);
    expect(hasSceneCardBinding(undefined)).toBe(false);
  });
});

describe("resolveSceneCards", () => {
  it("沒指定 → 沿用生成台勾選", () => {
    expect(resolveSceneCards({ id: "s1" } as never, FALLBACK)).toEqual({
      characterIds: ["g-char"],
      scenePresetIds: ["g-scene"],
      propIds: ["g-prop"],
      fromScene: false,
    });
  });

  it("有指定 → 整組以這一鏡為準；沒填的那幾種就是空", () => {
    // 紅傘特寫：只指定素材 → 角色必須是空的，不能被全域勾選硬塞一個人進畫面
    expect(resolveSceneCards({ propIds: ["p-umbrella"] }, FALLBACK)).toEqual({
      characterIds: [],
      scenePresetIds: [],
      propIds: ["p-umbrella"],
      fromScene: true,
    });
  });

  it("去重且濾掉壞值（DB 舊資料／手改 JSON 不該讓生成整個爆掉）", () => {
    const messy = { characterIds: ["a", "a", "", null as never, 3 as never, "b"] };
    expect(resolveSceneCards(messy, null).characterIds).toEqual(["a", "b"]);
  });

  it("兩邊都沒有時回三組空陣列（呼叫端不必再判 null）", () => {
    expect(resolveSceneCards(null, null)).toEqual({
      characterIds: [],
      scenePresetIds: [],
      propIds: [],
      fromScene: false,
    });
  });
});

describe("formatSceneCardNames", () => {
  it("依角色→場景→素材串成一行", () => {
    expect(formatSceneCardNames({ characters: ["安倢"], scenes: ["禪堂"], props: ["安倢的紅傘"] })).toBe(
      "安倢・禪堂・安倢的紅傘",
    );
  });

  it("空白與缺項不會留下多餘的分隔點", () => {
    expect(formatSceneCardNames({ characters: ["安倢"], props: ["  "] })).toBe("安倢");
    expect(formatSceneCardNames({})).toBe("");
  });
});
