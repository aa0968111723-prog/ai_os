/**
 * Header「剩」and generate confirm must show the tight scoped wallet
 * (member / group / Fal cap). Never paint 站內總預算 leftover
 * (live ~4,708) as the wallet — that leftover is a platform ceiling,
 * not the member's remaining, and generate must not look like it
 * spends from that pool.
 *
 * #790 stopped min-ing Fal into totalRemaining (correct for that
 * field: leftover is cost-ledger only). The header still min'd
 * leftover when member/group were null, so live stuck at 剩 4,705
 * and billed 4705→4704. Restore Fal in the display min; keep
 * leftover out unless a real scoped cap exists and leftover is tighter.
 */

export type QuotaMyView = {
  groupId?: string | null;
  memberBudgetRemaining: number | null;
  groupBudgetRemaining: number | null;
  totalRemaining: number | null;
  falPointsCap?: number | null;
  weeklyQuota?: number | null;
  weeklyUsed?: number | null;
  dailyQuota?: number | null;
  dailyUsed?: number | null;
};

/** Live leftover is 4700-family. Scoped wallets are ~320. Never persist leftover as last-good. */
export const SITE_LEFTOVER_FAMILY_MIN = 2000;

export function isSiteLeftoverScale(value: number | null | undefined): boolean {
  return value != null && Number.isFinite(value) && value >= SITE_LEFTOVER_FAMILY_MIN;
}

function weeklyRemainingPoints(data: QuotaMyView): number | null {
  if (data.weeklyQuota == null) return null;
  return Math.max(0, data.weeklyQuota - (data.weeklyUsed ?? 0));
}

export function scopedWalletCaps(data: QuotaMyView): number[] {
  // Leftover-scale Fal (~4704) is the same 站內總預算 leftover, not the ~320 wallet.
  // Live after #790: 剩 4,704・週已用 7 — weekly remaining is the scoped family.
  const fal = isSiteLeftoverScale(data.falPointsCap) ? null : (data.falPointsCap ?? null);
  return [data.memberBudgetRemaining, data.groupBudgetRemaining, weeklyRemainingPoints(data), fal].filter(
    (value): value is number => value != null && !isSiteLeftoverScale(value),
  );
}

export function hasScopedWallet(data: QuotaMyView): boolean {
  return scopedWalletCaps(data).length > 0;
}

export function tightRemainingPoints(data: QuotaMyView): number | null {
  const scoped = scopedWalletCaps(data);
  // Leftover-only (member/group/Fal all null) is the 4,708 flash — not a wallet.
  if (scoped.length === 0) return null;
  const leftover = data.totalRemaining;
  return leftover != null ? Math.min(...scoped, leftover) : Math.min(...scoped);
}

/**
 * Only accept a payload minted for the group the badge asked for.
 * Unscoped / leftover-only / mismatched rows keep the last scoped
 * remaining. Never adopt leftover-scale as last-good.
 */
export function scopedTightRemaining(
  data: QuotaMyView | undefined,
  requestedGroupId: string | undefined,
  previous: number | null = null,
): number | null {
  const lastGood = isSiteLeftoverScale(previous) ? null : previous;
  if (!requestedGroupId) return lastGood;
  if (!data || data.groupId !== requestedGroupId) return lastGood;
  const next = tightRemainingPoints(data);
  if (next == null) {
    // Matching row with no scoped caps: leftover-only keeps last scoped
    // wallet; truly unlimited (no leftover either) clears to 不限.
    if (data.totalRemaining != null) return lastGood;
    return null;
  }
  if (isSiteLeftoverScale(next) && !hasScopedWallet(data)) return lastGood;
  return next;
}

export function scopedWalletRemainingLabel(
  data: QuotaMyView | undefined,
  requestedGroupId: string | undefined,
  previous: number | null = null,
): string {
  const remaining = scopedTightRemaining(data, requestedGroupId, previous);
  const parts = [
    remaining != null ? `目前剩 ${remaining.toLocaleString()} 點` : "額度不限",
    data?.weeklyQuota != null ? `本週 ${data.weeklyUsed}/${data.weeklyQuota}` : "",
    data?.dailyQuota != null ? `今日 ${data.dailyUsed}/${data.dailyQuota}` : "",
  ].filter(Boolean);
  return parts.join("・");
}

export const SCOPED_REMAINING_STORAGE_PREFIX = "aios.quota.scopedRemaining.";

export function readPersistedScopedRemaining(
  groupId: string,
  storage?: Pick<Storage, "getItem"> | null,
): number | null {
  if (!groupId || !storage) return null;
  const raw = storage.getItem(`${SCOPED_REMAINING_STORAGE_PREFIX}${groupId}`);
  if (raw == null || raw === "") return null;
  try {
    const parsed = JSON.parse(raw) as { remaining?: unknown; scoped?: unknown };
    if (parsed && typeof parsed === "object" && parsed.scoped === true && typeof parsed.remaining === "number") {
      return isSiteLeftoverScale(parsed.remaining) ? null : parsed.remaining;
    }
  } catch {
    // Legacy writes were a bare number. Keep ~320-family; drop 4708-scale poison.
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || isSiteLeftoverScale(value)) return null;
  return value;
}

export function writePersistedScopedRemaining(
  groupId: string,
  remaining: number | null,
  storage?: Pick<Storage, "setItem" | "removeItem"> | null,
): void {
  if (!groupId || !storage) return;
  const key = `${SCOPED_REMAINING_STORAGE_PREFIX}${groupId}`;
  if (remaining == null || isSiteLeftoverScale(remaining)) {
    storage.removeItem(key);
    return;
  }
  storage.setItem(key, JSON.stringify({ remaining, scoped: true }));
}
