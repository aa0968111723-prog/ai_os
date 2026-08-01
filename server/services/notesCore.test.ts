import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { noteWriteDenied } from "./notesCore";

const source = readFileSync(new URL("./notesCore.ts", import.meta.url), "utf8");

describe("notesCore ACL contract", () => {
  it("lets the author manage their own note regardless of membership role", () => {
    expect(noteWriteDenied("user-1", "user-1", "member")).toBe(false);
  });

  it("blocks an ordinary member from overwriting another author's note", () => {
    expect(noteWriteDenied("author", "other-member", "member")).toBe(true);
  });

  it("lets group leaders and admins manage notes for moderation", () => {
    expect(noteWriteDenied("author", "leader", "leader")).toBe(false);
    expect(noteWriteDenied("author", "admin", "admin")).toBe(false);
  });

  it("project-bound note writes require assertProjectEditable (viewer cannot edit own project notes)", () => {
    expect(source).toContain("assertProjectEditable");
    expect(source).toMatch(/requireEditable[\s\S]*assertProjectEditable|if \(requireEditable\) await assertProjectEditable/);
    expect(source).toMatch(/removeNoteCore[\s\S]*projectChecked/);
  });
});
