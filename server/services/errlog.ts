/**
 * 錯誤環形緩衝——外接 Sentry 前的最低限度錯誤觀測。
 * 單容器記憶體態即可（重啟歸零無妨）：目的不是永久留存，而是讓管理員在
 * /api/selftest「近期錯誤」一眼看到「最近有沒有東西在壞、壞在哪」。
 * ★ 本模組不 import 任何專案模組（db/auth/…都不碰），任何地方引用都不會造成循環相依。
 */

export interface ErrEntry {
  /** 發生時間（ISO 字串） */
  at: string;
  /** 來源範圍，如 "trpc:generation.submit"、"upload"、"export" */
  scope: string;
  /** 錯誤訊息（已截 300 字） */
  message: string;
}

/** 緩衝上限：滿了丟最舊（環形） */
const MAX_ENTRIES = 50;
/** 單筆訊息長度上限：避免超長 SQL/堆疊塞爆記憶體 */
const MAX_MESSAGE_LEN = 300;

/** 舊 → 新排列；push 進尾端、滿了 shift 掉頭部 */
const buffer: ErrEntry[] = [];

/**
 * 記一筆錯誤。絕不拋錯——觀測層失敗不能反過來弄壞主流程，
 * 所以整段包 try/catch，任何意外（怪 toString 之類）都靜默吞掉。
 */
export function recordError(scope: string, err: unknown): void {
  try {
    const message = String(err instanceof Error ? err.message : err).slice(0, MAX_MESSAGE_LEN);
    buffer.push({ at: new Date().toISOString(), scope, message });
    if (buffer.length > MAX_ENTRIES) buffer.shift();
  } catch {
    // 靜默：錯誤記錄本身出錯就算了，主流程優先
  }
}

/** 全部錯誤（新到舊）——呈現「最近發生了什麼」用 */
export function listErrors(): ErrEntry[] {
  return [...buffer].reverse();
}

/** 過去 ms 毫秒內的錯誤筆數（selftest「近期錯誤」以 24 小時視窗呼叫） */
export function errorCountSince(ms: number): number {
  const cutoff = Date.now() - ms;
  return buffer.filter((e) => Date.parse(e.at) >= cutoff).length;
}
