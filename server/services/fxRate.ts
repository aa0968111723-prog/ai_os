/**
 * USD → TWD 即時匯率（點數 1 點 = NT$1 政策下，Fal USD 餘額換算成可花點數的來源）。
 * - 優先：frankfurter.app（ECB 公開中間價，免金鑰）
 * - 失敗：退回 shared/models 的 USD_TO_TWD（目錄校準常數 31）
 * - 快取 30 分鐘，避免每次扣點打外部
 */
import { USD_TO_TWD } from "../../shared/models";
import { proxyFetch } from "./http";

export const FX_CACHE_TTL_MS = 30 * 60_000;

export type FxRateResult = {
  rate: number;
  source: "live" | "fallback";
  fetchedAt: string; // ISO
  cached: boolean;
};

type CacheEntry = {
  result: Omit<FxRateResult, "cached">;
  expiresAt: number;
};

let cache: CacheEntry | null = null;

/** 單元測試用 */
export function resetFxRateCacheForTests(): void {
  cache = null;
}

function clampRate(n: number): number | null {
  // 合理區間：避免髒資料把點數上限洗成 0 或天文數字（近年 USD/TWD 約 27–35）
  if (!Number.isFinite(n) || n < 20 || n > 45) return null;
  return Math.round(n * 1000) / 1000;
}

async function fetchLiveUsdTwd(): Promise<number | null> {
  try {
    // frankfurter：ECB 中間價；TWD 若缺則試 exchangerate.host 相容路徑
    const res = await proxyFetch("https://api.frankfurter.app/latest?from=USD&to=TWD", {
      headers: { Accept: "application/json" },
      timeoutMs: 8_000,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { rates?: { TWD?: number } };
    const rate = data?.rates?.TWD;
    return typeof rate === "number" ? clampRate(rate) : null;
  } catch (err) {
    console.warn("[fxRate] live fetch failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * 取得 USD→TWD 匯率。
 * force=true 略過快取（管理頁手動重整用）。
 */
export async function getUsdToTwd(opts?: { force?: boolean }): Promise<FxRateResult> {
  const now = Date.now();
  if (!opts?.force && cache && cache.expiresAt > now) {
    return { ...cache.result, cached: true };
  }

  const live = await fetchLiveUsdTwd();
  if (live != null) {
    const result: Omit<FxRateResult, "cached"> = {
      rate: live,
      source: "live",
      fetchedAt: new Date().toISOString(),
    };
    cache = { result, expiresAt: now + FX_CACHE_TTL_MS };
    return { ...result, cached: false };
  }

  const result: Omit<FxRateResult, "cached"> = {
    rate: USD_TO_TWD,
    source: "fallback",
    fetchedAt: new Date().toISOString(),
  };
  // 失敗也短快取 5 分鐘，避免上游掛掉時每次扣點狂打
  cache = { result, expiresAt: now + 5 * 60_000 };
  return { ...result, cached: false };
}

/** Fal USD 餘額 → 可花點數上限（1 點 = NT$1，無條件捨去避免超花） */
export function usdBalanceToPointsCap(balanceUsd: number, rate: number): number {
  if (!Number.isFinite(balanceUsd) || balanceUsd <= 0) return 0;
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  return Math.max(0, Math.floor(balanceUsd * rate));
}
