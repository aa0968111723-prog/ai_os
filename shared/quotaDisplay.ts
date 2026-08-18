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
  const next = tightRemainingPoints(data);
  // Studio close can remount the badge and briefly mint a scoped-looking
  // row with member/group caps missing — only totalRemaining＝站內總預算剩
  // (e.g. 4,708). Keep the last tighter wallet until caps come back.
  const globalOnly = data.memberBudgetRemaining == null && data.groupBudgetRemaining == null;
  if (previous != null && next != null && globalOnly && next > previous) return previous;
  return next;
}

export const SCOPED_REMAINING_STORAGE_PREFIX = "aios.quota.scopedRemaining.";

export function readPersistedScopedRemaining(
  groupId: string,
  storage?: Pick<Storage, "getItem"> | null,
): number | null {
  if (!groupId || !storage) return null;
  const raw = storage.getItem(`${SCOPED_REMAINING_STORAGE_PREFIX}${groupId}`);
  if (raw == null || raw === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export function writePersistedScopedRemaining(
  groupId: string,
  remaining: number | null,
  storage?: Pick<Storage, "setItem" | "removeItem"> | null,
): void {
  if (!groupId || !storage) return;
  const key = `${SCOPED_REMAINING_STORAGE_PREFIX}${groupId}`;
  if (remaining == null) {
    storage.removeItem(key);
    return;
  }
  storage.setItem(key, String(remaining));
}
