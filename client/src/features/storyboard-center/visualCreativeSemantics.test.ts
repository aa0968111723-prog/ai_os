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
