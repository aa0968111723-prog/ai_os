/**
 * Restore-from-trash: put the shot back at its original orderIndex.
 * If that slot is free, no shift. If occupied, shift later actives up
 * (same back-to-front walk as insertAfter) so we never write a duplicate.
 */
export function restoreOrderPlan(input: {
  originalOrderIndex: number;
  activeOrderIndexes: number[];
}): { orderIndex: number; shiftFrom: number | null } {
  const original = input.originalOrderIndex;
  const taken = input.activeOrderIndexes.includes(original);
  return {
    orderIndex: original,
    shiftFrom: taken ? original : null,
  };
}
