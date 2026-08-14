import { describe, expect, it } from "vitest";
import { choicePresent, projectChoiceChange } from "./visualCreativeSemantics";

describe("visual creative natural project-choice semantics", () => {
  it("replaces only the same character's look and preserves other characters", () => {
    const owners = new Map([["look-a-old", "char-a"], ["look-b", "char-b"]]);
    expect(projectChoiceChange({
      shot: { characterIds: ["char-a", "char-b"], lookIds: ["look-a-old", "look-b"] },
      choice: { family: "look", id: "look-a-new", ownerCharacterId: "char-a" },
      lookOwnerById: owners,
    })).toMatchObject({ operation: "replace", value: ["look-b", "look-a-new"], compatible: true });
  });

  it("replaces a single-environment scene instead of appending", () => {
    expect(projectChoiceChange({ shot: { scenePresetIds: ["beach", "street"] }, choice: { family: "scene", id: "temple" } }))
      .toMatchObject({ operation: "replace", value: ["temple"] });
  });

  it("adds then explicitly removes characters and props", () => {
    expect(projectChoiceChange({ shot: { characterIds: ["a"] }, choice: { family: "character", id: "b" } }))
      .toMatchObject({ operation: "add", value: ["a", "b"] });
    expect(projectChoiceChange({ shot: { propIds: ["umbrella"] }, choice: { family: "prop", id: "umbrella" }, removeEverywhere: true }))
      .toMatchObject({ operation: "remove", value: [] });
  });

  it("keeps an existing value in a mixed batch so the click unifies instead of inverting", () => {
    const choice = { family: "character" as const, id: "nami" };
    const already = { characterIds: ["nami"] };
    expect(choicePresent(already, choice)).toBe(true);
    expect(projectChoiceChange({ shot: already, choice, removeEverywhere: false })).toMatchObject({ operation: "keep", changed: false });
  });

  it("rejects a look when its owner is not bound to the shot", () => {
    expect(projectChoiceChange({
      shot: { characterIds: ["other"] },
      choice: { family: "look", id: "look-nami", ownerCharacterId: "nami" },
    })).toMatchObject({ compatible: false, reason: "missing-character" });
  });
});


/**
 * #725 P1-12：移除角色後，它的 Look 孤兒留在該鏡。
 *
 * 原始 finding：顯示為現況、生成時被忽略、任何 UI 都刪不掉，而且角色一回來就復活。
 */
describe("#725 P1-12 移除角色要一併帶走它的 Look", () => {
  const lookOwnerById = new Map([["look-a1", "char-a"], ["look-a2", "char-a"], ["look-b1", "char-b"]]);

  it("移除角色時回報該角色的孤兒 Look", () => {
    const change = projectChoiceChange({
      shot: { characterIds: ["char-a", "char-b"], lookIds: ["look-a1", "look-b1"] },
      choice: { family: "character", id: "char-a" },
      lookOwnerById,
      removeEverywhere: true,
    });
    expect(change.operation).toBe("remove");
    expect(change.value).toEqual(["char-b"]);
    expect(change.orphanedLookIds).toEqual(["look-a1"]);
  });

  it("同一角色有多套 Look 時全部回報", () => {
    const change = projectChoiceChange({
      shot: { characterIds: ["char-a"], lookIds: ["look-a1", "look-a2"] },
      choice: { family: "character", id: "char-a" },
      lookOwnerById,
      removeEverywhere: true,
    });
    expect(change.orphanedLookIds).toEqual(["look-a1", "look-a2"]);
  });

  it("該角色沒有 Look 就不回報（不製造空更新）", () => {
    const change = projectChoiceChange({
      shot: { characterIds: ["char-a", "char-b"], lookIds: ["look-b1"] },
      choice: { family: "character", id: "char-a" },
      lookOwnerById,
      removeEverywhere: true,
    });
    expect(change.orphanedLookIds).toBeUndefined();
  });

  it("移除道具不會動到 Look", () => {
    const change = projectChoiceChange({
      shot: { propIds: ["prop-1"], lookIds: ["look-a1"] },
      choice: { family: "prop", id: "prop-1" },
      lookOwnerById,
      removeEverywhere: true,
    });
    expect(change.orphanedLookIds).toBeUndefined();
  });
});
