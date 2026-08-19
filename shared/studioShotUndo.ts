/**
 * 動畫創作室分鏡列 Ctrl+Z：只還原 複製 / 在這之後插入 / 刪除（進回收桶）。
 *
 * Undo 複製／插入＝把新列軟刪進回收桶（scenes.remove），不是 purge。
 * Undo 刪除＝scenes.restore。白板筆畫 undo 仍走 useBoardSession；分鏡堆疊優先。
 */

export type ShotUndoEntry =
  | { kind: "create"; sceneId: string }
  | { kind: "delete"; sceneId: string };

export const SHOT_UNDO_MAX = 50;

export function pushShotUndo(
  stack: readonly ShotUndoEntry[],
  entry: ShotUndoEntry,
  max = SHOT_UNDO_MAX,
): ShotUndoEntry[] {
  if (!entry.sceneId) return [...stack];
  return [...stack, entry].slice(-max);
}

export function popShotUndo(stack: readonly ShotUndoEntry[]): {
  next: ShotUndoEntry[];
  entry: ShotUndoEntry | null;
} {
  if (stack.length === 0) return { next: [], entry: null };
  return { next: stack.slice(0, -1), entry: stack[stack.length - 1]! };
}

/** Undo create = recycle. Undo delete = restore. Never purge. */
export function shotUndoMutation(entry: ShotUndoEntry): "remove" | "restore" {
  return entry.kind === "create" ? "remove" : "restore";
}

export function preferShotUndoOverBoard(stack: readonly ShotUndoEntry[]): boolean {
  return stack.length > 0;
}
