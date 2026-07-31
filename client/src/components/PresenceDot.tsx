import { presenceLabel, presenceState, type PresenceInstant, type PresenceState } from "@shared/presence";

/**
 * 線上指示（私訊「誰在線上」）。
 *
 * 三個刻意的決定：
 * 1. 離線不畫點——「有沒有點」本身就是訊息，色盲者不必靠綠／琥珀的色差來分辨。
 * 2. 上線是實心點、剛離開是空心環：形狀也不同，同樣不把顏色當唯一載體。
 * 3. 帶 role="img"＋aria-label：螢幕閱讀器會唸出「上線中」「7 分鐘前在線」，
 *    而不是把一個純裝飾的 span 唸成空白（或整個略過）。
 */
export function PresenceDot({ lastActiveAt, now }: { lastActiveAt: PresenceInstant; now?: number }) {
  const at = now ?? Date.now();
  const state: PresenceState = presenceState(lastActiveAt, at);
  if (state === "offline") return null;
  const label = presenceLabel(lastActiveAt, at);
  return <span className={`presence-dot ${state}`} role="img" aria-label={label} title={label} />;
}

/**
 * 文字版狀態（對話標頭用）：離線也照顯示——標頭有空間，且「對方離線」正是決定
 * 「現在敲他還是等等再說」的資訊，不該只能從「沒有綠點」反推。
 */
export function PresenceText({ lastActiveAt, now }: { lastActiveAt: PresenceInstant; now?: number }) {
  const at = now ?? Date.now();
  const state = presenceState(lastActiveAt, at);
  return <span className={`presence-text ${state}`}>{presenceLabel(lastActiveAt, at)}</span>;
}
