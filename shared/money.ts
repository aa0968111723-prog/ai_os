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
/** 各輸出種類可接受的計價單位（normalizePriceUnit 的輸出）；不在此列＝佔位值或解析誤配。 */
const KIND_UNITS: Record<string, readonly string[]> = {
  video: ["second", "sec", "s", "minute", "min", "video"],
  image: ["image", "img", "megapixel", "mp", "pixel", "4megapixel", "8megapixel", "kilopixel"],
  audio: ["second", "sec", "s", "minute", "min", "character", "1000characters"],
};

/**
 * Fal 回傳的計價單位是否與模型輸出種類語意相容。
 * 不相容（例：影片模型回傳 token／image）＝佔位值或把別的模型價格誤配過來，
 * 估點與 live 同步都應退回靜態官方實價（realPricePoints 機械解析 cost 字串），
 * 避免把官方實價蓋成 $1/token→32180 點、$0.03/image→1 點 這類佔位點數。
 * text 等種類計價單位多樣（LLM token／STT 秒／vision 圖），不擋。
 */
export function unitPlausibleForKind(unit: string | null | undefined, kind?: string): boolean {
  if (!kind) return true;
  const allowed = KIND_UNITS[kind];
  if (!allowed) return true;
  return allowed.includes((unit ?? "").trim().toLowerCase());
}

export function usdUnitToPoints(
  priceUsd: number,
  unit: string,
  opts?: {
    videoSeconds?: number;
    v2vMinutes?: number;
    promptChars?: number;
    kindHint?: string;
    usdToTwdRate?: number;
  },
): number {
  if (!Number.isFinite(priceUsd) || priceUsd < 0) return 1;
  const videoSeconds = opts?.videoSeconds ?? DEFAULT_VIDEO_SECONDS_FOR_POINTS;
  const v2vMinutes = opts?.v2vMinutes ?? DEFAULT_V2V_MINUTES_FOR_POINTS;
  const u = unit.trim().toLowerCase();
  let mul = 1;
  if (u === "second" || u === "sec" || u === "s") mul = videoSeconds;
  else if (u === "minute" || u === "min") {
    mul = (opts?.kindHint ?? "").includes("video") ? v2vMinutes : 1;
  } else if (u === "character") mul = opts?.promptChars ?? 1000;
  else if (u === "1000characters") mul = (opts?.promptChars ?? 1000) / 1000;
  else if (u === "token") mul = 1000;
  const rate = opts?.usdToTwdRate ?? USD_TO_TWD;
  return Math.max(1, Math.round(priceUsd * mul * rate));
}
