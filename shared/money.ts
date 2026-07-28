/**
 * 點數 ↔ 新台幣／美元換算（全站單一真相）。
 * 定案：1 點 ≈ NT$1；點數由模型目錄依 USD × USD_TO_TWD 校準。
 */
import { USD_TO_TWD } from "./models";
export { USD_TO_TWD };
export const POINTS_TO_TWD = 1;
export const DEFAULT_VIDEO_SECONDS_FOR_POINTS = 5;
export const DEFAULT_V2V_MINUTES_FOR_POINTS = 1;
export function pointsToTwd(points: number): number {
  if (!Number.isFinite(points) || points <= 0) return 0;
  return Math.round(points * POINTS_TO_TWD);
}
export function pointsToUsd(points: number): number {
  if (!Number.isFinite(points) || points <= 0) return 0;
  return Math.round((points / USD_TO_TWD) * 100) / 100;
}
export function usdToTwd(usd: number): number {
  if (!Number.isFinite(usd) || usd <= 0) return 0;
  return Math.round(usd * USD_TO_TWD);
}
export function formatTwd(amount: number): string {
  const n = Number.isFinite(amount) ? Math.round(amount) : 0;
  return `NT$${n.toLocaleString("zh-TW")}`;
}
export function formatUsd(amount: number): string {
  const n = Number.isFinite(amount) ? amount : 0;
  return `US$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
export function moneyFxNote(): string {
  return `1 點 ≈ NT$${POINTS_TO_TWD}；US$1 = NT$${USD_TO_TWD}（目錄校準；真實帳單以當月結匯為準）`;
}
export function usdUnitToPoints(
  priceUsd: number,
  unit: string,
  opts?: { videoSeconds?: number; v2vMinutes?: number; kindHint?: string },
): number {
  if (!Number.isFinite(priceUsd) || priceUsd < 0) return 1;
  const videoSeconds = opts?.videoSeconds ?? DEFAULT_VIDEO_SECONDS_FOR_POINTS;
  const v2vMinutes = opts?.v2vMinutes ?? DEFAULT_V2V_MINUTES_FOR_POINTS;
  const u = unit.trim().toLowerCase();
  let mul = 1;
  if (u === "second" || u === "sec" || u === "s") mul = videoSeconds;
  else if (u === "minute" || u === "min") {
    mul = (opts?.kindHint ?? "").includes("video") ? v2vMinutes : 1;
  } else if (u === "token") mul = 1000;
  return Math.max(1, Math.round(priceUsd * mul * USD_TO_TWD));
}
