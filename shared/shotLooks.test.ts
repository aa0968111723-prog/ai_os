import { describe, expect, it } from "vitest";
import {
  keepLooksOwnedByCharacters,
  lookOwnerMap,
  looksChanged,
  unboundLookIds,
} from "./shotLooks";

const lianDay = "look-lian-day";
const lianNight = "look-lian-night";
const afuDefault = "look-afu";
const owners = lookOwnerMap([
  { id: lianDay, characterId: "lian" },
  { id: lianNight, characterId: "lian" },
  { id: afuDefault, characterId: "afu" },
]);

describe("keepLooksOwnedByCharacters", () => {
  it("keeps looks whose character is still on the shot", () => {
    expect(keepLooksOwnedByCharacters([lianNight, afuDefault], owners, ["lian", "afu"])).toEqual([
      lianNight,
      afuDefault,
    ]);
  });

  it("strips orphan looks when a character is removed (Shot Inspector / 分鏡表 only send characterIds)", () => {
    expect(keepLooksOwnedByCharacters([lianNight, afuDefault], owners, ["afu"])).toEqual([afuDefault]);
    expect(keepLooksOwnedByCharacters([lianNight, afuDefault], owners, [])).toBeNull();
  });

  it("dedupes and ignores unknown look ids", () => {
    expect(keepLooksOwnedByCharacters([lianDay, lianDay, "ghost"], owners, ["lian"])).toEqual([lianDay]);
  });

  it("two projects can both have 小華 — owners are id-keyed, never name-keyed", () => {
    const a = lookOwnerMap([{ id: "look-a", characterId: "hua-a" }]);
    const b = lookOwnerMap([{ id: "look-b", characterId: "hua-b" }]);
    expect(keepLooksOwnedByCharacters(["look-a"], a, ["hua-a"])).toEqual(["look-a"]);
    expect(keepLooksOwnedByCharacters(["look-a"], b, ["hua-b"])).toBeNull();
    expect(keepLooksOwnedByCharacters(["look-b"], a, ["hua-a"])).toBeNull();
  });
});

describe("unboundLookIds", () => {
  it("flags an explicit look whose character is not bound", () => {
    expect(unboundLookIds([lianNight], owners, ["afu"])).toEqual([lianNight]);
    expect(unboundLookIds([afuDefault], owners, ["afu"])).toEqual([]);
  });
});

describe("looksChanged", () => {
  it("treats null and empty as the same empty binding", () => {
    expect(looksChanged(null, null)).toBe(false);
    expect(looksChanged([], null)).toBe(false);
    expect(looksChanged([lianDay], [lianDay])).toBe(false);
    expect(looksChanged([lianDay], [lianNight])).toBe(true);
    expect(looksChanged([lianDay, afuDefault], [afuDefault, lianDay])).toBe(true);
  });
});
