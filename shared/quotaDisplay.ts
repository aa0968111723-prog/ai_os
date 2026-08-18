/**
 * Header「剩」must be the tightest scoped wallet, never an unscoped
 * global leftover painted while quota.my refetch races.
 *
 * quota.my without groupId returns member/group remaining as null and
 * totalRemaining = 站內總預算 − usedTotal (e.g. 4,708). Math.min of
 * that object looks like 剩 4,708 until the grouped refetch lands.
 */

export type QuotaMyView = {
  groupId?: string | null;
  memberBudgetRemaining: number | null;
  groupBudgetRemaining: number | null;
  totalRemaining: number | null;
};

export function tightRemainingPoints(data: QuotaMyView): number | null {
  const caps = [data.memberBudgetRemaining, data.groupBudgetRemaining, data.totalRemaining].filter(
    (value): value is number => value != null,
  );
  return caps.length > 0 ? Math.min(...caps) : null;
}

/**
 * Only accept a payload minted for the group the badge asked for.
 * Unscoped / mismatched rows keep the last good remaining (no 4,708 flash).
 */
export function scopedTightRemaining(
  data: QuotaMyView | undefined,
  requestedGroupId: string | undefined,
  previous: number | null = null,
): number | null {
  if (!requestedGroupId) return previous;
  if (!data || data.groupId !== requestedGroupId) return previous;
  return tightRemainingPoints(data);
}
