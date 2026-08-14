import { describe, expect, it } from "vitest";
import { findMentionSpans, resolveMentionAgainstCatalog } from "../../shared/projectCreativeContext";
import { aliasesFromNotes } from "./storyEntityBinding";

describe("story entity binding policy", () => {
  it("treats a proposal as non-mutating until confirm", () => {
    const catalog = [
      { kind: "character" as const, id: "a", rev: 1, name: "安倢" },
      { kind: "character" as const, id: "b", rev: 1, name: "安倢" },
    ];
    const [mention] = findMentionSpans("安倢走進雨裡。", catalog);
    const resolved = resolveMentionAgainstCatalog(mention!, catalog);
    expect(resolved.auto).toBeNull();
    expect(resolved.candidates).toHaveLength(2);
  });

  it("reads 又名 from notes as an alias without copying the character", () => {
    expect(aliasesFromNotes("這角色又名安姐，是導師。")).toEqual(["安姐"]);
  });
});
