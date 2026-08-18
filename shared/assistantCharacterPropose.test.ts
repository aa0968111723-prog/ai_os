import { describe, expect, it } from "vitest";
import {
  PENDING_CHARACTER_APPEARANCE,
  addCharacterConfirmLabel,
  collectAddCharacterProposals,
  dropMisroutedCharacterDatabaseActions,
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

  it("emits a confirm card when a same-name 小華 card already exists as 年輕男性", () => {
    const existing = [{ name: "小華", appearance: "年輕男性" }];
    const actions = proposeAddCharacterActions("新增角色 小華 粉橘短髮女孩、大二化工", existing);
    expect(actions).toEqual([
      { type: "add_character", name: "小華", appearance: XIAOHUA_LOCKED_APPEARANCE },
    ]);
    expect(actions[0]!.appearance).toContain("粉橘短髮女孩");
    expect(actions[0]!.appearance).not.toContain("年輕男性");
    expect(addCharacterConfirmLabel("小華", XIAOHUA_LOCKED_APPEARANCE, existing[0])).toBe(
      `更新角色「小華」外觀：年輕男性 → ${XIAOHUA_LOCKED_APPEARANCE}`,
    );
  });

  it("emits 小華 confirm when the ask is an appearance rewrite, not 新增角色", () => {
    const actions = proposeAddCharacterActions("把小華改成粉橘短髮女孩、大二化工，不要年輕男性");
    expect(actions).toEqual([
      { type: "add_character", name: "小華", appearance: XIAOHUA_LOCKED_APPEARANCE },
    ]);
  });

  it("emits confirm when same-name 小華 is 年輕男性 and the ask only names her look", () => {
    const existing = [{ name: "小華", appearance: "年輕男性" }];
    const actions = proposeAddCharacterActions("小華是女生，不要年輕男性", existing);
    expect(actions).toEqual([
      { type: "add_character", name: "小華", appearance: XIAOHUA_LOCKED_APPEARANCE },
    ]);
    expect(addCharacterConfirmLabel("小華", XIAOHUA_LOCKED_APPEARANCE, existing[0])).toContain("更新角色「小華」外觀");
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

  it("merges model actions=[] + existing 年輕男性 into a locked confirm card", () => {
    const merged = collectAddCharacterProposals(
      "新增角色 小華：粉橘短髮女孩、大二化工",
      [],
      [{ name: "小華", appearance: "年輕男性" }],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]).toEqual({
      type: "add_character",
      name: "小華",
      appearance: XIAOHUA_LOCKED_APPEARANCE,
    });
  });

  it("keeps a confirm card even when the model already returned other actions", () => {
    const merged = collectAddCharacterProposals(
      "新增角色 小華 粉橘短髮女孩",
      [{ type: "plan_agent", name: undefined }],
      [{ name: "小華", appearance: "年輕男性" }],
    );
    expect(merged).toEqual([
      { type: "add_character", name: "小華", appearance: XIAOHUA_LOCKED_APPEARANCE },
    ]);
  });

  it("parses live「新增角色「小華」粉橘…／白帽T」as name 小華, not the look blob", () => {
    const live = "新增角色「小華」粉橘短髮女孩／白帽T／大二化工";
    expect(extractCharacterNames(live)).toEqual(["小華"]);
    const existing = [{ name: "小華", appearance: "年輕男性" }];
    const actions = proposeAddCharacterActions(live, existing);
    expect(actions).toEqual([
      { type: "add_character", name: "小華", appearance: XIAOHUA_LOCKED_APPEARANCE },
    ]);
    expect(addCharacterConfirmLabel("小華", XIAOHUA_LOCKED_APPEARANCE, existing[0])).toContain("更新角色「小華」外觀");
    expect(addCharacterConfirmLabel("小華", XIAOHUA_LOCKED_APPEARANCE, existing[0])).toContain("年輕男性");
  });

  it("drops 素材清單 add_database_row when the ask is 新增角色", () => {
    const kept = dropMisroutedCharacterDatabaseActions(
      "新增角色「小華」粉橘短髮女孩／白帽T／大二化工",
      [
        { type: "add_database_row", tableName: "素材清單" },
        { type: "add_character", name: "小華" },
        { type: "create_scene", title: "校門口" },
      ],
    );
    expect(kept.map((row) => row.type)).toEqual(["add_character", "create_scene"]);
    expect(kept.some((row) => row.type === "add_database_row")).toBe(false);
  });

  it("locks 年輕男性 from the model to 粉橘短髮女孩", () => {
    const merged = collectAddCharacterProposals(
      "新增角色 小華",
      [{ type: "add_character", name: "小華", appearance: "年輕男性" }],
      [],
    );
    expect(merged[0]!.appearance).toBe(XIAOHUA_LOCKED_APPEARANCE);
  });
});
