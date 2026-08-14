import { describe, expect, it } from "vitest";
import { buildCharacterSlots } from "./characterSlots";

const characters = [
  { id: "luffy", rev: 3, name: "魯夫", referenceAssetId: "asset-luffy" },
  { id: "nami", rev: 1, name: "娜美", referenceAssetId: null },
];

describe("character slots", () => {
  it("assigns looks, owned props and canon linkage per character", () => {
    const { slots, issues } = buildCharacterSlots({
      characters,
      looks: [{ id: "look-red", rev: 2, characterId: "luffy", referenceAssetId: "asset-look" }],
      props: [
        { id: "map", ownerKind: "character", ownerId: "nami" },
        { id: "hat", ownerKind: "character", ownerId: "luffy" },
        { id: "bench", ownerKind: "scene", ownerId: "beach" },
      ],
      canonPins: [{ localEntityId: "luffy", canonId: "canon-1", pinnedVersionId: "v7" }],
    });
    expect(issues).toEqual([]);
    expect(slots).toHaveLength(2);
    const luffy = slots.find((slot) => slot.characterId === "luffy")!;
    expect(luffy.lookId).toBe("look-red");
    expect(luffy.identityReferenceAssetId).toBe("asset-luffy");
    expect(luffy.lookReferenceAssetId).toBe("asset-look");
    expect(luffy.ownedPropIds).toEqual(["hat"]);
    expect(luffy.canonId).toBe("canon-1");
    expect(luffy.canonVersionId).toBe("v7");
    const nami = slots.find((slot) => slot.characterId === "nami")!;
    expect(nami.ownedPropIds).toEqual(["map"]);
    expect(nami.canonId).toBeNull();
  });

  it("reports duplicate look bindings and orphan looks instead of silently mixing", () => {
    const { issues } = buildCharacterSlots({
      characters,
      looks: [
        { id: "look-a", rev: 1, characterId: "luffy" },
        { id: "look-b", rev: 1, characterId: "luffy" },
        { id: "look-c", rev: 1, characterId: "zoro" },
      ],
      props: [],
    });
    expect(issues.map((row) => row.code)).toEqual(
      expect.arrayContaining(["duplicate_look_binding", "look_without_character"]),
    );
  });

  it("flags props whose character owner is missing from the shot", () => {
    const { issues } = buildCharacterSlots({
      characters,
      looks: [],
      props: [{ id: "sword", ownerKind: "character", ownerId: "zoro" }],
    });
    expect(issues.map((row) => row.code)).toContain("wrong_prop_owner");
  });
});
