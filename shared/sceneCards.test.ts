/**
 * 逐鏡卡片綁定的解析規則：有綁就整組用它，沒綁才沿用生成台勾選。
 * 這條「整組」規則是關鍵——逐欄補會讓「這鏡不要人」永遠表達不出來。
 */
import { describe, expect, it } from "vitest";
import {
  CARD_CLEAR_TOKEN,
  formatCardNames,
  formatSceneCardNames,
  hasSceneCardBinding,
  parseCardLine,
  resolveCardLine,
  resolveSceneCards,
} from "./sceneCards";

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

/**
 * 文字腳本裡的卡片行。
 *
 * 這一組測試守的不是「解析得對不對」，而是**失敗時的方向**：
 * 看不懂的時候一律停在「什麼都不動」，而不是停在「存了一半」。
 * 半套用會把「我打錯一個字」變成「系統刪掉我兩個角色」，而畫面只寫著「更新 1 鏡」。
 */
describe("parseCardLine（留白與「無」是兩件事）", () => {
  it("沒寫這一行＝absent；寫了但留白＝blank——兩者都不動，但只有 blank 值得出聲", () => {
    expect(parseCardLine(undefined)).toEqual({ kind: "absent" });
    expect(parseCardLine(null)).toEqual({ kind: "absent" });
    expect(parseCardLine("")).toEqual({ kind: "blank" });
    expect(parseCardLine("   ")).toEqual({ kind: "blank" });
  });

  it("「無」才是解除——留白不是", () => {
    expect(parseCardLine(CARD_CLEAR_TOKEN)).toEqual({ kind: "clear" });
    expect(parseCardLine(" 無 ")).toEqual({ kind: "clear" });
  });

  it("輸出用「・」，讀回時頓號逗號斜線都收（手打的人不會去按全形間隔號）", () => {
    for (const text of ["安倢・師父", "安倢、師父", "安倢,師父", "安倢，師父", "安倢/師父", "安倢／師父"]) {
      expect(parseCardLine(text)).toEqual({ kind: "set", names: ["安倢", "師父"] });
    }
  });

  it("來回不失真", () => {
    const names = ["安倢", "師父"];
    expect(parseCardLine(formatCardNames(names))).toEqual({ kind: "set", names });
  });
});

describe("resolveCardLine（整行全中才套用）", () => {
  const CARDS = [
    { id: "c-anjie", names: ["安倢"] },
    { id: "c-master", names: ["師父"] },
  ];
  const opts = { max: 6, human: "角色卡", currentCount: 0 };

  it("名字全中 → 依書寫順序回 id（順序會決定提示詞的組裝順序，不能當成無序集合）", () => {
    expect(resolveCardLine("師父・安倢", CARDS, opts)).toEqual({ kind: "set", ids: ["c-master", "c-anjie"] });
  });

  it("「無」→ 空名單（這是唯一的解除方式）", () => {
    expect(resolveCardLine("無", CARDS, { ...opts, currentCount: 2 })).toEqual({ kind: "set", ids: [] });
  });

  it("其中一個名字查不到 → 整行不套用，另外兩個也不動，並講出是哪一個", () => {
    const out = resolveCardLine("安倢・小明・師父", CARDS, opts);
    expect(out.kind).toBe("keep");
    expect(out.kind === "keep" && out.warning).toContain("小明");
  });

  it("同名兩張卡 → 整行不套用，不擲骰子挑一張", () => {
    const twins = [{ id: "p1", names: ["紅傘"] }, { id: "p2", names: ["紅傘"] }];
    const out = resolveCardLine("紅傘", twins, { ...opts, human: "素材卡" });
    expect(out.kind).toBe("keep");
    expect(out.kind === "keep" && out.warning).toContain("不只一張");
  });

  it("素材卡兩種寫法都收：顯示名唯一時可用它避開撞名", () => {
    const props = [
      { id: "p1", names: ["安倢的紅傘", "紅傘"] },
      { id: "p2", names: ["師父的紅傘", "紅傘"] },
    ];
    expect(resolveCardLine("安倢的紅傘", props, { ...opts, human: "素材卡" })).toEqual({ kind: "set", ids: ["p1"] });
    expect(resolveCardLine("紅傘", props, { ...opts, human: "素材卡" }).kind).toBe("keep");
  });

  it("同一張寫兩次去重（不讓同一張卡在提示詞裡出現兩次）", () => {
    expect(resolveCardLine("安倢・安倢", CARDS, opts)).toEqual({ kind: "set", ids: ["c-anjie"] });
  });

  it("超過單鏡上限 → 整行不套用，不靜默截斷（截掉的是使用者自己選的卡）", () => {
    const out = resolveCardLine("安倢・師父", CARDS, { ...opts, max: 1 });
    expect(out.kind).toBe("keep");
    expect(out.kind === "keep" && out.warning).toContain("最多 1 張");
  });

  /**
   * 留白是這整條路最危險的一格：呼叫端只要漏傳一次名字（環境音那次的翻版），
   * 全部的卡片行就都會變成空的。所以留白一律不動，並在真的有東西會被誤清時出聲。
   */
  it("留白＝維持原值；已經綁了卡才提醒怎麼解除", () => {
    expect(resolveCardLine("", CARDS, { ...opts, currentCount: 2 })).toEqual({
      kind: "keep",
      warning: expect.stringContaining("角色卡：無"),
    });
    // 本來就沒綁卡的鏡留白是常態，警告會洗版
    expect(resolveCardLine("", CARDS, opts)).toEqual({ kind: "keep" });
    expect(resolveCardLine(undefined, CARDS, { ...opts, currentCount: 2 })).toEqual({ kind: "keep" });
  });
});
