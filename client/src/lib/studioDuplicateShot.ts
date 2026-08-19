/**
 * 創作室「複製這一鏡」must clone after the source and bump the visible count.
 * Live #790: ⋯ → 複製 was a silent no-op (26→26 / 7→7). Invalidate-only left
 * the React Query cache on the old list until reload.
 */

export type DuplicatableShot = {
  id: string;
  orderIndex: number;
  title?: string | null;
};

/**
 * Insert `created` immediately after `sourceId` and shift later rows.
 * A no-op implementation (return rows unchanged) fails the 7→8 regression.
 */
export function mergeDuplicatedShotIntoList<T extends DuplicatableShot>(
  rows: readonly T[],
  sourceId: string,
  created: T,
): T[] {
  if (!created?.id) return [...rows];
  if (rows.some((row) => row.id === created.id)) {
    return rows.map((row) => (row.id === created.id ? { ...row, ...created } : row));
  }
  const sourceIdx = rows.findIndex((row) => row.id === sourceId);
  const insertAt = sourceIdx >= 0 ? sourceIdx + 1 : rows.length;
  const sourceOrder = sourceIdx >= 0 ? rows[sourceIdx]!.orderIndex : (rows.at(-1)?.orderIndex ?? 0);
  const placed: T = { ...created, orderIndex: sourceOrder + 1 };
  const head = rows.slice(0, insertAt).map((row) => ({ ...row }));
  const tail = rows.slice(insertAt).map((row) => ({ ...row, orderIndex: row.orderIndex + 1 }));
  return [...head, placed, ...tail];
}

export async function runStudioDuplicateShot<T extends DuplicatableShot>(input: {
  sceneId: string;
  insertAfter: (args: { sceneId: string; duplicate: true }) => Promise<T | null | undefined>;
  mergeIntoCache: (sourceId: string, created: T) => void;
  refresh: () => Promise<void>;
}): Promise<T> {
  const created = await input.insertAfter({ sceneId: input.sceneId, duplicate: true });
  if (!created?.id) {
    throw new Error("複製這一鏡沒有寫入新列");
  }
  input.mergeIntoCache(input.sceneId, created);
  await input.refresh();
  return created;
}

/**
 * 在這之後插入一鏡: blank row AFTER the source, not FIFO ＋新增鏡 append.
 * Live #790 tooltip is only 複製、刪除 (Chrome find 「插」=0).
 */
export async function runStudioInsertShot<T extends DuplicatableShot>(input: {
  sceneId: string;
  insertAfter: (args: { sceneId: string }) => Promise<T | null | undefined>;
  mergeIntoCache: (sourceId: string, created: T) => void;
  refresh: () => Promise<void>;
}): Promise<T> {
  const created = await input.insertAfter({ sceneId: input.sceneId });
  if (!created?.id) {
    throw new Error("在這之後插入一鏡沒有寫入新列");
  }
  input.mergeIntoCache(input.sceneId, created);
  await input.refresh();
  return created;
}
