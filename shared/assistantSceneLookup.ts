/**
 * Assistant sceneNo must follow the same numbering as Animation Studio / 分鏡中心:
 * sort by orderIndex, then display number = rank + 1.
 *
 * Never index an unsorted (or hole-confused) array with scenes[sceneNo - 1].
 * Soft-delete leaves gaps in orderIndex; the display number stays compact.
 */
export function findSceneByDisplayNo<T extends { orderIndex: number }>(
  scenes: readonly T[],
  sceneNo: number,
): T | undefined {
  if (!Number.isInteger(sceneNo) || sceneNo < 1) return undefined;
  const sorted = [...scenes].sort((a, b) => a.orderIndex - b.orderIndex);
  return sorted[sceneNo - 1];
}

/** Display shot number for a row (1-based, compact after orderIndex sort). */
export function displayShotNo<T extends { id: string; orderIndex: number }>(
  scenes: readonly T[],
  sceneId: string,
): number | undefined {
  const sorted = [...scenes].sort((a, b) => a.orderIndex - b.orderIndex);
  const i = sorted.findIndex((s) => s.id === sceneId);
  return i >= 0 ? i + 1 : undefined;
}
