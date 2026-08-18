import { describe, expect, it } from "vitest";
import {
  PENDING_CHARACTER_APPEARANCE,
  extractCharacterNames,
  proposeAddCharacterActions,
} from "./assistantCharacterPropose";
import { XIAOHUA_LOCKED_APPEARANCE } from "./characterIdentityLock";

describe("proposeAddCharacterActions", () => {
  it("「新增角色 小華」emits one add_character confirm card", () => {
    expect(proposeAddCharacterActions("新增角色 小華")).toEqual([
      { type: "add_character", name: "小華", appearance: XIAOHUA_LOCKED_APPEARANCE },
    ]);
  });

  it("turns「幫我新增角色 小華、媽媽、禪定龜龜」into 3 confirm cards", () => {
    const actions = proposeAddCharacterActions("幫我新增角色 小華、媽媽、禪定龜龜");
    expect(actions).toEqual([
      { type: "add_character", name: "小華", appearance: XIAOHUA_LOCKED_APPEARANCE },
      { type: "add_character", name: "媽媽", appearance: PENDING_CHARACTER_APPEARANCE },
      { type: "add_character", name: "禪定龜龜", appearance: PENDING_CHARACTER_APPEARANCE },
    ]);
  });

  it("does not invent cards for a non-character write", () => {
    expect(proposeAddCharacterActions("幫我開一個新專案 小華短片")).toEqual([]);
    expect(proposeAddCharacterActions("今天天氣如何")).toEqual([]);
  });

  it("extracts names around colons and full-width commas, caps at 6", () => {
    expect(extractCharacterNames("建立角色：阿明，阿花")).toEqual(["阿明", "阿花"]);
    const many = proposeAddCharacterActions("新增角色 一、二、三、四、五、六、七");
    expect(many).toHaveLength(6);
    expect(many.every((row) => row.appearance === PENDING_CHARACTER_APPEARANCE)).toBe(true);
  });
});
