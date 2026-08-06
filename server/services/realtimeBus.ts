/**
 * 即時協作的跨實例匯流排（Redis pub/sub）。
 *
 * 為什麼需要：services/realtime.ts 的房間是「這個行程的記憶體」。單一實例時完全正確，
 * 但一旦開到兩個 replica，負載平衡就會把同一個專案的協作者拆到不同實例上——
 * 甲在 A 實例、乙在 B 實例，兩人打開同一個專案卻**互相看不見**：沒有游標、沒有在場名單、
 * 一邊改了東西另一邊的畫面也不會刷新。這是「看起來有在運作、其實靜默失效」的那種故障。
 *
 * 做法：
 * - 短暫事件（游標／編輯指示／資料失效）發到 Redis 頻道，其他實例收到就轉發給自己房裡的人。
 * - 在場名單則交換「名冊」而不是結果：每個實例把自己房內的成員與聚焦區塊送出去，
 *   各實例各自把「本機 ∪ 各遠端」算成同一份名單。用名冊而非直接送 presence 訊息，
 *   是因為 presence 必須是完整名單——只轉發別人算好的結果會讓每個實例看到的名單互相打架。
 *
 * 沒有 Redis 時整個模組是 no-op：單實例部署行為與過去完全相同，不多一條連線也不多一次往返。
 */
import { randomUUID } from "node:crypto";
import { isRedisEnabled, redisPublish, redisSubscribe } from "./redis";

/** 本實例的識別碼：用來忽略自己發出的訊息（否則每則廣播都會回音一次） */
export const INSTANCE_ID = randomUUID();

/** 遠端名冊多久沒更新就視為失效（實例被砍掉、網路分區）。必須大於名冊重送週期（30 秒心跳）。 */
export const ROSTER_STALE_MS = 90_000;

export interface RosterUser {
  userId: string;
  name: string;
  color: string;
}

export interface RosterEntry {
  users: RosterUser[];
  focus: Array<{ userId: string; zone: string }>;
  /** 本地收到這份名冊的時刻（不信任對方時鐘：跨機時鐘偏移會讓名冊被誤判過期或永不過期） */
  receivedAt: number;
}

type BusMessage =
  | { i: string; t: "event"; d: unknown }
  | { i: string; t: "roster"; d: { users: RosterUser[]; focus: Array<{ userId: string; zone: string }> } };

/* ── 純函式（可單測，不碰 Redis） ─────────────────────────────── */

/**
 * 本機名單 ∪ 各遠端名冊 → 單一在場名單。
 * 同一個 userId 只留一筆（同一人可能同時連到兩個實例：兩台手機、電腦＋平板）。
 * 本機優先，因為本機資料一定是最新的。
 */
export function mergeRosterUsers(
  local: RosterUser[],
  remotes: Iterable<RosterEntry>,
  now: number,
): RosterUser[] {
  const byUser = new Map<string, RosterUser>();
  for (const user of local) if (!byUser.has(user.userId)) byUser.set(user.userId, user);
  for (const entry of remotes) {
    if (now - entry.receivedAt > ROSTER_STALE_MS) continue; // 過期名冊不算數
    for (const user of entry.users) if (!byUser.has(user.userId)) byUser.set(user.userId, user);
  }
  return [...byUser.values()];
}

/**
 * 聚焦區塊的合併。同一人只有一個「目前在編輯哪裡」，本機優先——
 * 使用者本人的操作一定發生在他連著的那個實例上，遠端那份必然較舊。
 */
export function mergeRosterFocus(
  local: Array<{ userId: string; zone: string }>,
  remotes: Iterable<RosterEntry>,
  now: number,
): Array<{ userId: string; zone: string }> {
  const byUser = new Map<string, string>();
  for (const item of local) byUser.set(item.userId, item.zone);
  for (const entry of remotes) {
    if (now - entry.receivedAt > ROSTER_STALE_MS) continue;
    for (const item of entry.focus) if (!byUser.has(item.userId)) byUser.set(item.userId, item.zone);
  }
  return [...byUser].map(([userId, zone]) => ({ userId, zone }));
}

/** 丟掉過期名冊；回傳是否有東西被清掉（有的話呼叫端要重算在場名單） */
export function pruneRosters(rosters: Map<string, RosterEntry>, now: number): boolean {
  let changed = false;
  for (const [instanceId, entry] of rosters) {
    if (now - entry.receivedAt > ROSTER_STALE_MS) {
      rosters.delete(instanceId);
      changed = true;
    }
  }
  return changed;
}

/* ── Redis 綁定 ───────────────────────────────────────────────── */

interface RoomBus {
  /** instanceId → 該實例回報的名冊 */
  rosters: Map<string, RosterEntry>;
  unsubscribe: (() => void) | null;
  /** 訂閱建立中：避免同一房間短時間內多人加入時重複訂閱 */
  subscribing: Promise<void> | null;
}

const buses = new Map<string, RoomBus>();

export interface BusHandlers {
  /** 收到遠端事件：轉發給本機同房的所有連線 */
  onRemoteEvent: (roomKey: string, message: unknown) => void;
  /** 遠端名冊有變（含過期清除）：重算並廣播在場名單給本機連線 */
  onRosterChange: (roomKey: string) => void;
}

let handlers: BusHandlers | null = null;

export function configureRealtimeBus(next: BusHandlers): void {
  handlers = next;
}

export function isRealtimeBusEnabled(): boolean {
  return isRedisEnabled();
}

function channelFor(roomKey: string): string {
  return `rt:${roomKey}`;
}

function busFor(roomKey: string): RoomBus {
  let bus = buses.get(roomKey);
  if (!bus) {
    bus = { rosters: new Map(), unsubscribe: null, subscribing: null };
    buses.set(roomKey, bus);
  }
  return bus;
}

/**
 * 開始接收某房間的跨實例訊息（第一個本機連線加入該房時呼叫）。
 * 重複呼叫安全：已訂閱就直接返回。
 */
export async function joinRoomBus(roomKey: string): Promise<void> {
  if (!isRedisEnabled()) return;
  const bus = busFor(roomKey);
  if (bus.unsubscribe) return;
  if (bus.subscribing) return bus.subscribing;

  bus.subscribing = (async () => {
    const unsubscribe = await redisSubscribe(channelFor(roomKey), (_channel, payload) => {
      let message: BusMessage;
      try {
        message = JSON.parse(payload) as BusMessage;
      } catch {
        return;
      }
      // 自己發的訊息會原路回來——不擋掉的話每則廣播都會在本機重播一次
      if (!message || typeof message !== "object" || message.i === INSTANCE_ID) return;
      if (message.t === "event") {
        handlers?.onRemoteEvent(roomKey, message.d);
        return;
      }
      if (message.t === "roster" && message.d && Array.isArray(message.d.users)) {
        bus.rosters.set(message.i, {
          users: message.d.users,
          focus: Array.isArray(message.d.focus) ? message.d.focus : [],
          receivedAt: Date.now(),
        });
        handlers?.onRosterChange(roomKey);
      }
    });
    bus.unsubscribe = unsubscribe;
  })();

  try {
    await bus.subscribing;
  } finally {
    bus.subscribing = null;
  }
}

/** 本機該房已無連線：退訂並丟掉遠端名冊（下次有人加入時會重新收到） */
export function leaveRoomBus(roomKey: string): void {
  const bus = buses.get(roomKey);
  if (!bus) return;
  bus.unsubscribe?.();
  buses.delete(roomKey);
}

/** 把本機的廣播轉送到其他實例 */
export function publishRoomEvent(roomKey: string, message: unknown): void {
  if (!isRedisEnabled()) return;
  const envelope: BusMessage = { i: INSTANCE_ID, t: "event", d: message };
  void redisPublish(channelFor(roomKey), JSON.stringify(envelope));
}

/** 公告本機在該房的成員名冊（加入／離開／心跳時呼叫） */
export function publishRoster(
  roomKey: string,
  users: RosterUser[],
  focus: Array<{ userId: string; zone: string }>,
): void {
  if (!isRedisEnabled()) return;
  const envelope: BusMessage = { i: INSTANCE_ID, t: "roster", d: { users, focus } };
  void redisPublish(channelFor(roomKey), JSON.stringify(envelope));
}

/** 某房目前已知的遠端名冊（給合併函式用） */
export function remoteRosters(roomKey: string): Iterable<RosterEntry> {
  return buses.get(roomKey)?.rosters.values() ?? [];
}

/**
 * 清掉所有房間的過期名冊（由 realtime 心跳每 30 秒呼叫）。
 * 回傳需要重新廣播在場名單的房間——實例被砍掉時，其他實例要能在 90 秒內把他的人從名單移除，
 * 否則畫面上會留著永遠不會消失的幽靈協作者。
 */
export function pruneAllRosters(now = Date.now()): string[] {
  const affected: string[] = [];
  for (const [roomKey, bus] of buses) {
    if (pruneRosters(bus.rosters, now)) affected.push(roomKey);
  }
  return affected;
}

/** 關機時退訂所有房間（也讓其他實例的名冊隨 TTL 自然過期） */
export function closeRealtimeBus(): void {
  for (const [, bus] of buses) bus.unsubscribe?.();
  buses.clear();
}

/** 單元測試用 */
export function resetRealtimeBusForTests(): void {
  buses.clear();
  handlers = null;
}
