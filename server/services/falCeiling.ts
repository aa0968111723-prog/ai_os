/**
 * Fal 帳戶「台幣等值」硬上限——方案 C：點數可花上限即時對齊 Fal 餘額。
 *
 * 政策：
 * - 1 點 = NT$1
 * - availablePointsCap ≈ floor(fal_usd_balance × live_usd_twd)
 * - 單次扣點若 points > cap → 拒絕（真金白銀，避免站內帳本允許但 Fal 已空）
 * - Fal 未設定／查詢失敗 → 不擋（fail-open），只靠既有總預算／週額度；避免上游掛掉整站無法生成
 *
 * 不改寫歷史 cost_ledger；只在守門當下讀快取餘額。
 */
import { getFalAccountBalance } from "./falBilling";
import { getUsdToTwd, usdBalanceToPointsCap } from "./fxRate";

export type FalPointsCeiling =
  | {
      ok: true;
      balanceUsd: number;
      currency: string;
      rate: number;
      rateSource: "live" | "fallback";
      pointsCap: number;
      fetchedAt: string;
      cached: boolean;
    }
  | {
      ok: false;
      code: "not_configured" | "forbidden" | "upstream_error";
      message: string;
    };

/** 讀取目前 Fal 台幣等值點數上限（合併 billing + FX 快取） */
export async function getFalPointsCeiling(opts?: { force?: boolean }): Promise<FalPointsCeiling> {
  const [billing, fx] = await Promise.all([
    getFalAccountBalance({ force: opts?.force }),
    getUsdToTwd({ force: opts?.force }),
  ]);

  if (!billing.ok) {
    return { ok: false, code: billing.code, message: billing.message };
  }

  const pointsCap = usdBalanceToPointsCap(billing.balance, fx.rate);
  return {
    ok: true,
    balanceUsd: billing.balance,
    currency: billing.currency || "USD",
    rate: fx.rate,
    rateSource: fx.source,
    pointsCap,
    fetchedAt: billing.fetchedAt,
    cached: billing.cached || fx.cached,
  };
}

/**
 * 守門用：若有有效 Fal 上限且本次 points 超過 → 回拒絕字串；否則 null。
 * fail-open：查不到餘額時不擋。
 */
export async function falCeilingReason(points: number): Promise<string | null> {
  if (points <= 0) return null;
  // E2E 假生成不打真實金流——跳過 Fal 上限，避免 CI 沒 key 全擋
  if (process.env.E2E_MOCK === "1") return null;

  const ceiling = await getFalPointsCeiling();
  if (!ceiling.ok) return null;

  if (points > ceiling.pointsCap) {
    const usd = ceiling.balanceUsd.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return (
      `Fal 帳戶餘額不足（$${usd} ${ceiling.currency} ≈ NT$${ceiling.pointsCap.toLocaleString("zh-TW")}＝${ceiling.pointsCap.toLocaleString("zh-TW")} 點；` +
      `本筆需 ${points.toLocaleString("zh-TW")} 點，匯率 US$1＝NT$${ceiling.rate}）——請先到 fal.ai 儲值`
    );
  }
  return null;
}
