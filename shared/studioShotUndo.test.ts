import { describe, expect, it } from "vitest";
import {
  popShotUndo,
  preferShotUndoOverBoard,
  pushShotUndo,
  shotUndoMutation,
  type ShotUndoEntry,
} from "./studioShotUndo";

describe("studioShotUndo", () => {
  it("copy/insert push create; undo create is recycle remove, not purge", () => {
    const stack = pushShotUndo([], { kind: "create", sceneId: "new-shot" });
    const { next, entry } = popShotUndo(stack);
    expect(entry).toEqual({ kind: "create", sceneId: "new-shot" });
    expect(shotUndoMutation(entry!)).toBe("remove");
    expect(next).toEqual([]);
  });

  it("delete push restore; undo delete is scenes.restore from recycle", () => {
    const stack = pushShotUndo([], { kind: "delete", sceneId: "trashed" });
    const { entry } = popShotUndo(stack);
    expect(shotUndoMutation(entry!)).toBe("restore");
  });

  it("Ctrl+Z prefers shot-list undo over board strokes", () => {
    const empty: ShotUndoEntry[] = [];
    expect(preferShotUndoOverBoard(empty)).toBe(false);
    expect(preferShotUndoOverBoard(pushShotUndo(empty, { kind: "create", sceneId: "a" }))).toBe(true);
  });

  it("caps the stack so a mash of 複製 cannot grow forever", () => {
    let stack: ShotUndoEntry[] = [];
    for (let i = 0; i < 60; i++) {
      stack = pushShotUndo(stack, { kind: "create", sceneId: `s-${i}` }, 50);
    }
    expect(stack).toHaveLength(50);
    expect(stack[0]?.sceneId).toBe("s-10");
    expect(stack.at(-1)?.sceneId).toBe("s-59");
  });
});
