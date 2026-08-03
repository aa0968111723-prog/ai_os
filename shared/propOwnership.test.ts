/**
 * 素材設定卡歸屬的純規則：誰會被自動帶入、順序、上限誰先被丟。
 * 這支規則同時被專案頁預覽與伺服器注入使用——分岔就會「畫面說 3 張、實際注入 2 張」。
 */
import { describe, expect, it } from "vitest";
import {
  carriedPropIdsFor,
  countExtraCarriedProps,
  formatPropDisplayName,
  mergePropIdsWithCarried,
} from "./propOwnership";

const UMBRELLA = { id: "p-umbrella", ownerKind: "character" as const, ownerId: "char-anjie" };
const BEADS = { id: "p-beads", ownerKind: "character" as const, ownerId: "char-anjie" };
const ALTAR = { id: "p-altar", ownerKind: "scene" as const, ownerId: "scene-zen" };
const BANNER = { id: "p-banner", ownerKind: null, ownerId: null };
const ALL = [UMBRELLA, BEADS, ALTAR, BANNER];

describe("carriedPropIdsFor（勾主人 → 自動帶入它的物件）", () => {
  it("勾角色就帶出他的隨身物品，獨立物件不會被帶進來", () => {
    expect(carriedPropIdsFor(ALL, { characterIds: ["char-anjie"] })).toEqual(["p-umbrella", "p-beads"]);
  });

  it("勾場景帶出場上物件", () => {
    expect(carriedPropIdsFor(ALL, { scenePresetIds: ["scene-zen"] })).toEqual(["p-altar"]);
  });

  it("角色排在場景前面（上限吃緊時先保住人身上的東西）", () => {
    expect(carriedPropIdsFor(ALL, { characterIds: ["char-anjie"], scenePresetIds: ["scene-zen"] })).toEqual([
      "p-umbrella",
      "p-beads",
      "p-altar",
    ]);
  });

  it("同一張卡不會因為主人被勾兩次而重複", () => {
    expect(carriedPropIdsFor(ALL, { characterIds: ["char-anjie", "char-anjie"] })).toEqual([
      "p-umbrella",
      "p-beads",
    ]);
  });

  it("沒勾主人、或主人名下沒東西時回空陣列", () => {
    expect(carriedPropIdsFor(ALL, {})).toEqual([]);
    expect(carriedPropIdsFor(ALL, { characterIds: ["char-nobody"] })).toEqual([]);
    // 角色卡與場景卡的 id 不會互撞：同一個 id 但 kind 不同就不算主人
    expect(carriedPropIdsFor(ALL, { scenePresetIds: ["char-anjie"] })).toEqual([]);
  });
});

describe("mergePropIdsWithCarried（明確勾選優先，截到上限）", () => {
  it("明確勾選排前面，自動帶入接在後面", () => {
    expect(mergePropIdsWithCarried(["p-banner"], ["p-umbrella"], 4)).toEqual(["p-banner", "p-umbrella"]);
  });

  it("已經手動勾過的不會重複算一次", () => {
    expect(mergePropIdsWithCarried(["p-umbrella"], ["p-umbrella", "p-beads"], 4)).toEqual([
      "p-umbrella",
      "p-beads",
    ]);
  });

  it("超過上限時被丟掉的是自動帶入的，不是使用者親手勾的", () => {
    const explicit = ["a", "b", "c", "d"];
    expect(mergePropIdsWithCarried(explicit, ["p-umbrella"], 4)).toEqual(explicit);
  });

  it("上限為 0 時什麼都不帶（不會回傳半張卡）", () => {
    expect(mergePropIdsWithCarried(["a"], ["b"], 0)).toEqual([]);
  });
});

describe("countExtraCarriedProps（UI 顯示「多帶了幾張」）", () => {
  it("只算真的被多帶進來的那幾張", () => {
    expect(countExtraCarriedProps([], ["p-umbrella", "p-beads"], 4)).toBe(2);
    expect(countExtraCarriedProps(["p-umbrella"], ["p-umbrella", "p-beads"], 4)).toBe(1);
  });

  it("上限被明確勾選佔滿時是 0（畫面不會宣稱帶了實際上沒帶的）", () => {
    expect(countExtraCarriedProps(["a", "b", "c", "d"], ["p-umbrella"], 4)).toBe(0);
  });
});

describe("formatPropDisplayName", () => {
  it("有主人就寫成「主人的物件」", () => {
    expect(formatPropDisplayName("紅傘", "安倢")).toBe("安倢的紅傘");
  });

  it("沒主人（含空白、null）就用原名", () => {
    expect(formatPropDisplayName("主視覺牌", null)).toBe("主視覺牌");
    expect(formatPropDisplayName("主視覺牌", "  ")).toBe("主視覺牌");
    expect(formatPropDisplayName("主視覺牌")).toBe("主視覺牌");
  });
});
