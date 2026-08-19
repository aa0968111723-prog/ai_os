import { describe, expect, it } from "vitest";
import { assertOptionalReferenceImage, resolveHonoredCharacterSheet } from "./referenceAsset";

describe("assertOptionalReferenceImage", () => {
  it("empty / blank sheet skips assert and does not 500", async () => {
    await expect(assertOptionalReferenceImage(undefined, "g", "p")).resolves.toBeUndefined();
    await expect(assertOptionalReferenceImage("", "g", "p")).resolves.toBeUndefined();
    await expect(assertOptionalReferenceImage("   ", "g", "p")).resolves.toBeUndefined();
  });
});

describe("resolveHonoredCharacterSheet", () => {
  it("已選 0/6 skips without hitting assert", async () => {
    await expect(
      resolveHonoredCharacterSheet({ projectId: "p", groupId: "g", characterIds: [] }),
    ).resolves.toBeUndefined();
    await expect(
      resolveHonoredCharacterSheet({ projectId: "p", groupId: "g" }),
    ).resolves.toBeUndefined();
  });
});
