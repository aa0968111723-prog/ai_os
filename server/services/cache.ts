/**
 * 共用快取：有 Redis 就跨實例共用，沒有就退回本行程記憶體。
 *
 * 解決的問題：站上有好幾處「向外部服務問一次、快取一段時間」的資料（匯率、fal 餘額）。
 * 這些快取原本各自掛在模組變數上，於是每多開一個 replica 就多打一次外部 API，
 * 而且各實例看到的值可能不一樣（同一時間兩個人看到不同匯率）。
 *
 * 為什麼記憶體那層不能拿掉：Redis 在本專案是加速器不是真實來源。Redis 掛掉時
 * 每個請求都退化成直接打外部 API 才是真正的災難——本機快取讓降級後仍然只是「各實例各算一次」。
 *
 * 到期時間存在值裡（envelope 的 e 欄位）而不是只靠兩邊各自的 TTL：
 * 否則從 Redis 回填本機時只知道「還在」不知道「還剩多久」，短 TTL 的錯誤結果
 * 會被回填成長 TTL，變成上游修好了、某個實例還在吐 30 分鐘前的退路值。
 */
import { isRedisEnabled, redisDel, redisGet, redisSet } from "./redis";

/** 記憶體層的容量上限：超過即清掉已過期項，仍超過就淘汰最舊的（避免無界成長） */
const MEMORY_MAX_ENTRIES = 2_000;

interface Envelope<T> {
  /** value */
  v: T;
  /** expiresAt（epoch ms） */
  e: number;
}

/** 記憶體層存已序列化的字串：與 Redis 走同一種表示，避免兩層行為分岔（例如 Date 物件） */
const memory = new Map<string, string>();

function pruneMemory(now: number): void {
  if (memory.size <= MEMORY_MAX_ENTRIES) return;
  for (const [key, raw] of memory) {
    const envelope = parse<unknown>(raw);
    if (!envelope || envelope.e <= now) memory.delete(key);
  }
  // 仍超量：Map 的迭代順序＝插入順序，從頭刪就是淘汰最舊的
  while (memory.size > MEMORY_MAX_ENTRIES) {
    const oldest = memory.keys().next();
    if (oldest.done) break;
    memory.delete(oldest.value);
  }
}

function parse<T>(raw: string): Envelope<T> | null {
  try {
    const parsed = JSON.parse(raw) as Envelope<T>;
    return parsed && typeof parsed === "object" && typeof parsed.e === "number" ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * 讀快取。回 null＝沒有可用的值（不存在／已過期／Redis 不通且本機也沒有）。
 *
 * 先問本機再問 Redis：本機命中省一次網路往返，而且 Redis 抖動時仍有值可用。
 * 代價是同一實例最多會晚一個 TTL 才看到別的實例寫的新值——對「外部資料的 TTL 快取」而言可接受。
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  const now = Date.now();
  const local = memory.get(key);
  if (local !== undefined) {
    const envelope = parse<T>(local);
    if (envelope && envelope.e > now) return envelope.v;
    memory.delete(key);
  }

  if (!isRedisEnabled()) return null;
  const raw = await redisGet(`cache:${key}`);
  if (raw === null) return null;
  const envelope = parse<T>(raw);
  if (!envelope || envelope.e <= now) return null;
  // 回填本機：同一實例的後續請求就不必再往返 Redis（沿用原本的到期時間，不展延）
  memory.set(key, raw);
  pruneMemory(now);
  return envelope.v;
}

/** 寫快取（兩層都寫）。Redis 寫入失敗不影響本機快取，也不拋例外 */
export async function cacheSet(key: string, value: unknown, ttlMs: number): Promise<void> {
  const now = Date.now();
  const envelope: Envelope<unknown> = { v: value, e: now + Math.max(0, ttlMs) };
  let serialized: string;
  try {
    serialized = JSON.stringify(envelope);
  } catch {
    return; // 不可序列化的值不進快取（循環參照等）——靜默略過，快取本來就是可有可無
  }
  if (serialized === undefined) return;
  memory.set(key, serialized);
  pruneMemory(now);
  if (isRedisEnabled()) await redisSet(`cache:${key}`, serialized, ttlMs);
}

export async function cacheDelete(key: string): Promise<void> {
  memory.delete(key);
  if (isRedisEnabled()) await redisDel(`cache:${key}`);
}

/**
 * 「有就用、沒有就算」的常用組合。
 * 注意不做 single-flight：同一實例同時有兩個請求 miss 時會各算一次。
 * 需要嚴格去重的路徑請自行加上既有的 in-flight Map（見 routers/knowledge.ts）。
 */
export async function cached<T>(key: string, ttlMs: number, compute: () => Promise<T>): Promise<T> {
  const hit = await cacheGet<T>(key);
  if (hit !== null) return hit;
  const value = await compute();
  await cacheSet(key, value, ttlMs);
  return value;
}

export function resetCacheForTests(): void {
  memory.clear();
}

/** 觀測用：目前記憶體層的項數 */
export function memoryCacheSize(): number {
  return memory.size;
}
