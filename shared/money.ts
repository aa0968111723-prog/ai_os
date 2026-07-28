/**
 * 點數 ↔ 新台幣／美元換算（全站單一真相）。
 * 定案：1 點 ≈ NT$1；點數本身由模型目錄依「USD × USD_TO_TWD」校準。
 * 真實 Fal 帳單仍以 invoice USD × 當月結匯為準——此處是帳面估價，供用量明細與 CSV。
 */
import { USD_TO_TWD } from "./models";

export { USD_TO_TWD };

/** 1 點對應的新台幣（定案 1；若日後要加緩衝可改此常數） */
export const POINTS_TO_TWD = 1;

/** 完成實花點數 → 帳面新台幣（四捨五入到元） */
export function pointsToTwd(points: number): number {
  if (!Number.isFinite(points) || points <= 0) return 0;
  return Math.round(points * POINTS_TO_TWD);
}

/** 完成實花點數 → 帳面美元（對齊目錄匯率；小數兩位） */
export function pointsToUsd(points: number): number {
  if (!Number.isFinite(points) || points <= 0) return 0;
  return Math.round((points / USD_TO_TWD) * 100) / 100;
}

/** 美元 → 新台幣（目錄匯率） */
export function usdToTwd(usd: number): number {
  if (!Number.isFinite(usd) || usd <= 0) return 0;
  return Math.round(usd * USD_TO_TWD);
}

/** 顯示用：NT$1,234（zh-TW 千分位） */
export function formatTwd(amount: number): string {
  const n = Number.isFinite(amount) ? Math.round(amount) : 0;
  return `NT$${n.toLocaleString("zh-TW")}`;
}

/** 顯示用：US$12.34 */
export function formatUsd(amount: number): string {
  const n = Number.isFinite(amount) ? amount : 0;
  return `US$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** 給 API／CSV 的匯率說明字串 */
export function moneyFxNote(): string {
  return `1 點 ≈ NT$${POINTS_TO_TWD}；US$1 = NT$${USD_TO_TWD}（目錄校準；真實帳單以當月結匯為準）`;
}
