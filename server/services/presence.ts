/**
 * 線上狀態（私訊「誰在線上」）的寫入與讀取。
 *
 * 心跳來源不是另外一支 API，而是「所有登入後的 tRPC 呼叫」（見 trpc.ts authedProcedure）：
 * App 開著就會固定輪詢未讀徽章／對話串，那些請求本身就是「人還在」最誠實的證據，
 * 不必為了 presence 再多發一種請求。代價是每個請求都可能寫一次 DB——所以這裡自帶節流。
 *
 * 判定（3 分鐘上線窗／15 分鐘剛離開窗）集中在 shared/presence.ts，前後端同一份規則。
 */
import { and, gte, inArray } from "drizzle-orm";
import { db, schema } from "../db";
import { PRESENCE_RECENT_MS } from "../../shared/presence";

/**
 * 每程序、每人的心跳寫入下限。
 * 必須明顯小於 PRESENCE_ONLINE_MS，否則正在用的人會在兩次寫入之間掉出上線窗；
 * 又不能太小，否則每個開著分頁的人都在灌 UPDATE。45 秒＝上線窗的 1/4。
 */
export const PRESENCE_TOUCH_MIN_MS = 45_000;

/** 節流表的容量上限：超過就清掉過期項（同時上線人數遠低於此，正常永不觸發） */
const TOUCH_MAP_MAX = 5_000;

/** userId → 本程序最近一次寫入時刻（毫秒）。多 replica 各有一份，只是各自少寫幾次，不影響正確性。 */
const lastWriteAt = new Map<string, number>();

/** 純函式：這次呼叫該不該真的寫庫（沒寫過、或距上次已超過節流下限） */
export function shouldWritePresence(previousWriteAt: number | undefined, now: number): boolean {
  if (previousWriteAt === undefined) return true;
  // 時鐘回撥（NTP 校正）會讓差值變負數——視為「該寫」，總比卡住整段時間不更新好
  return now - previousWriteAt >= PRESENCE_TOUCH_MIN_MS || now < previousWriteAt;
}

function pruneTouchMap(now: number): void {
  if (lastWriteAt.size <= TOUCH_MAP_MAX) return;
  for (const [userId, at] of lastWriteAt) {
    if (now - at >= PRESENCE_RECENT_MS) lastWriteAt.delete(userId);
  }
}

/**
 * 心跳：標記此人「現在還在」。不擋請求（fire-and-forget）、失敗不影響回應——
 * 線上指示壞掉只是少一個綠點，不該讓任何一支 API 因此變慢或失敗。
 */
export function touchPresence(userId: string, now: number = Date.now()): void {
  if (!shouldWritePresence(lastWriteAt.get(userId), now)) return;
  lastWriteAt.set(userId, now);
  pruneTouchMap(now);
  const at = new Date(now);
  void db
    .insert(schema.userPresence)
    .values({ userId, lastActiveAt: at })
    .onConflictDoUpdate({ target: schema.userPresence.userId, set: { lastActiveAt: at } })
    .catch((err) => {
      // 寫失敗就把節流紀錄退掉，讓下一個請求立刻重試，而不是靜靜地離線 45 秒
      lastWriteAt.delete(userId);
      console.warn("[presence] 心跳寫入失敗：", err instanceof Error ? err.message : err);
    });
}

/**
 * 讀取一群人的最後活躍時刻。
 * 只回「剛離開窗內」的列——更久以前的活躍時刻對線上指示沒有用途，也不該外流成行蹤紀錄。
 * 查無列＝離線（呼叫端以 shared/presence 的 presenceState 判定，不在這裡回傳字串狀態）。
 */
export async function listPresence(userIds: readonly string[], now: Date = new Date()): Promise<Map<string, Date>> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return new Map();
  const cutoff = new Date(now.getTime() - PRESENCE_RECENT_MS);
  const rows = await db
    .select({ userId: schema.userPresence.userId, lastActiveAt: schema.userPresence.lastActiveAt })
    .from(schema.userPresence)
    .where(and(inArray(schema.userPresence.userId, ids), gte(schema.userPresence.lastActiveAt, cutoff)));
  return new Map(rows.map((r) => [r.userId, r.lastActiveAt]));
}

/** 測試用：清掉本程序的節流狀態（正式路徑不呼叫） */
export function resetPresenceThrottleForTests(): void {
  lastWriteAt.clear();
}
