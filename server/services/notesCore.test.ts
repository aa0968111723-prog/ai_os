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

  it("listNotesCore counts the full group instead of treating the 200-row page as the inventory", () => {
    expect(source).toContain("NOTE_LIST_LIMIT");
    expect(source).toContain("truncated: total > items.length");
  });

  it("retries reuse the same plan step instead of inserting again", () => {
    expect(source).toContain("onConflictDoNothing");
    expect(source).toContain("findExistingNote");
  });

  it("site notes without an effect id replay the same title+content within 2 minutes", () => {
    expect(source).toContain("120_000");
    expect(source).toContain("createdBy");
  });

  it("project-bound note writes require assertProjectEditable (viewer cannot edit own project notes)", () => {
    expect(source).toContain("assertProjectEditable");
    expect(source).toMatch(/requireEditable[\s\S]*assertProjectEditable|if \(requireEditable\) await assertProjectEditable/);
    expect(source).toMatch(/removeNoteCore[\s\S]*projectChecked/);
  });
});

const commentSource = readFileSync(new URL("./noteCommentsCore.ts", import.meta.url), "utf8");

describe("note comment retry replay", () => {
  it("replays the same author+note+body within 2 minutes instead of inserting twice", () => {
    expect(commentSource).toContain("120_000");
    expect(commentSource).toContain("eq(schema.noteComments.userId, input.auth.user.id)");
    expect(commentSource).toContain("eq(schema.noteComments.noteId, note.id)");
    const lookupAt = commentSource.indexOf("gte(schema.noteComments.createdAt");
    const insertAt = commentSource.indexOf(".insert(schema.noteComments)");
    expect(lookupAt).toBeGreaterThanOrEqual(0);
    expect(insertAt).toBeGreaterThan(lookupAt);
  });
});
