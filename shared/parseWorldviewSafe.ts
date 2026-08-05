import { worldviewSchema, type Worldview } from "./worldview";

/**
 * 安全解析世界觀：legacy／畸形 DB 資料不得讓專案頁整頁炸掉
 *（ErrorBoundary「畫面出了點狀況」）。
 *
 * 1) 完整 safeParse
 * 2) 失敗則逐欄 salvage（字串截斷、陣列洗字串、acts 物件）
 * 3) 仍失敗 → 空預設 + console.warn
 */
export function parseWorldviewSafe(raw: unknown): Worldview {
  const result = worldviewSchema.safeParse(raw ?? {});
  if (result.success) return result.data;

  const empty = worldviewSchema.parse({});
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    console.warn("[worldview] invalid root, using defaults", result.error.issues?.slice(0, 6));
    return empty;
  }

  const o = raw as Record<string, unknown>;

  const clipStr = (v: unknown, max: number): string | undefined => {
    if (typeof v !== "string") return undefined;
    return v.slice(0, max);
  };
  const clipStrArr = (v: unknown, itemMax = 100, arrMax = 30): string[] | undefined => {
    if (!Array.isArray(v)) return undefined;
    const out: string[] = [];
    for (const item of v) {
      if (typeof item !== "string") continue;
      const s = item.trim().slice(0, itemMax);
      if (s) out.push(s);
      if (out.length >= arrMax) break;
    }
    return out;
  };

  const salvage: Record<string, unknown> = { ...empty };
  const logline = clipStr(o.logline, 500);
  if (logline !== undefined) salvage.logline = logline;
  const message = clipStr(o.message, 500);
  if (message !== undefined) salvage.message = message;
  const audience = clipStr(o.audience, 500);
  if (audience !== undefined) salvage.audience = audience;

  for (const key of ["themes", "tones", "people", "styles", "references", "taboos"] as const) {
    const arr = clipStrArr(o[key]);
    if (arr !== undefined) salvage[key] = arr;
  }

  if (o.acts && typeof o.acts === "object" && !Array.isArray(o.acts)) {
    const a = o.acts as Record<string, unknown>;
    salvage.acts = {
      hook: clipStr(a.hook, 500) ?? "",
      turn: clipStr(a.turn, 500) ?? "",
      cta: clipStr(a.cta, 500) ?? "",
    };
  }

  const salvaged = worldviewSchema.safeParse(salvage);
  if (salvaged.success) {
    console.warn(
      "[worldview] partial salvage after validation failure",
      result.error.issues?.slice(0, 8),
    );
    return salvaged.data;
  }
  console.warn("[worldview] salvage failed, using defaults", result.error.issues?.slice(0, 6));
  return empty;
}
