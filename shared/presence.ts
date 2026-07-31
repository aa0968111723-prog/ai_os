/**
 * 上線狀態（私訊「誰在線上」）——前後端共用的單一判定。
 *
 * 為什麼是「最近活躍時刻」而不是「上線/下線事件」：
 * 事件式 presence 必須靠瀏覽器送出「下線」才會回到離線，而分頁被關掉、網路斷掉、
 * 手機睡著、伺服器重啟都不會送——結果就是一堆永遠掛在線上的幽靈。改成只記「最後一次
 * 有動作的時刻」，離線是「時間過了」自然發生的，不需要任何人負責宣告，重啟也不會遺留假上線。
 *
 * 三態而不是兩態：3 分鐘內＝真的在用（上線中）；15 分鐘內＝剛離開（顯示「N 分鐘前在線」，
 * 對「他還在嗎？值不值得等回覆」這個唯一會被問的問題，比一個冷冰冰的「離線」有用）；
 * 再久就只說離線，不回報更精確的時間——這是私訊的線上指示，不是行蹤紀錄。
 */

/** 心跳間隔要遠小於這個值，否則正在用的人會被誤判成離線（見 services/presence 的節流常數） */
export const PRESENCE_ONLINE_MS = 3 * 60_000;

/** 「剛離開」的上限；超過即單純顯示離線，且伺服器不再回報最後活躍時刻 */
export const PRESENCE_RECENT_MS = 15 * 60_000;

export type PresenceState = "online" | "recent" | "offline";

/** 可接受的時刻輸入（tRPC superjson 會還原成 Date，但測試與快取路徑可能是字串） */
export type PresenceInstant = Date | string | number | null | undefined;

function toMs(at: PresenceInstant): number | null {
  if (at == null) return null;
  const ms = at instanceof Date ? at.getTime() : typeof at === "number" ? at : new Date(at).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * 純函式：最後活躍時刻 → 三態。
 * 未來時刻（伺服器與瀏覽器時鐘有落差）一律視為上線中，不會因為時鐘快了幾秒就顯示離線。
 */
export function presenceState(lastActiveAt: PresenceInstant, now: number = Date.now()): PresenceState {
  const ms = toMs(lastActiveAt);
  if (ms === null) return "offline";
  const idle = now - ms;
  if (idle < PRESENCE_ONLINE_MS) return "online";
  if (idle < PRESENCE_RECENT_MS) return "recent";
  return "offline";
}

/** 純函式：給人看的狀態字（也用作螢幕閱讀器的替代文字——顏色不是唯一的訊息載體） */
export function presenceLabel(lastActiveAt: PresenceInstant, now: number = Date.now()): string {
  const state = presenceState(lastActiveAt, now);
  if (state === "online") return "上線中";
  if (state === "offline") return "離線";
  const ms = toMs(lastActiveAt) ?? now;
  const mins = Math.max(1, Math.round((now - ms) / 60_000));
  return `${mins} 分鐘前在線`;
}
