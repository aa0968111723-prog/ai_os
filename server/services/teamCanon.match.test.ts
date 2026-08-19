import { describe, expect, it } from "vitest";
import { matchLocalCharacterByName } from "./teamCanon";

describe("matchLocalCharacterByName", () => {
  it("reuses the existing 小華 card instead of minting a second handle", () => {
    const existing = { id: "char-a", name: "小華" };
    expect(matchLocalCharacterByName([existing], "小華")?.id).toBe("char-a");
    expect(matchLocalCharacterByName([existing], "「小華」")?.id).toBe("char-a");
  });

  it("does not collide 小華 with 禪定龜龜", () => {
    expect(matchLocalCharacterByName([{ id: "char-a", name: "小華" }], "禪定龜龜")).toBeNull();
    expect(matchLocalCharacterByName([], "小華")).toBeNull();
  });
});
