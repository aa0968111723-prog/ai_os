import { describe, expect, it } from "vitest";
import { noteWriteDenied } from "./notesCore";

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
});
