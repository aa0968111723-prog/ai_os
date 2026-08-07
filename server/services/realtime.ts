/**
 * 即時協作 WebSocket（任務 D）：presence、彩色游標、編輯指示、粗粒度「有東西變了」通知。
 * 路徑 /ws?projectId=<uuid> 或 /ws?groupId=<uuid>；由 index.ts 呼叫 attachRealtime(httpServer) 掛上。
 * 專案房（p:）保留高精度錨點／游標；組房（g:）讓全組成員在 Launchpad 等頁互相看到 presence 與游標。
 * 協定與 client/src/realtime.tsx 嚴格對應——兩邊要一起改。
 *
 * 多實例：房間是本行程的記憶體，所以設了 REDIS_URL 時會透過 services/realtimeBus 把事件與
 * 在場名冊同步到其他 replica（否則同一專案的協作者被分流到不同實例就會互相看不見）。
 * 沒有 Redis 時 bus 全是 no-op，行為與單機時完全相同。
 */
import type { IncomingMessage, Server } from "node:http";
import type { Request } from "express";
import { WebSocketServer, WebSocket } from "ws";
import { and, eq, gt } from "drizzle-orm";
import { db, schema } from "../db";
import { loadAuthState, parseCookies, sha256 } from "./auth";
import { sessionGate } from "./sessionPolicy";
import { isShuttingDown, onShutdown } from "./shutdown";
import {
  closeRealtimeBus,
  configureRealtimeBus,
  isRealtimeBusEnabled,
  joinRoomBus,
  leaveRoomBus,
  mergeRosterFocus,
  mergeRosterUsers,
  publishRoomEvent,
  publishRoster,
  pruneAllRosters,
  remoteRosters,
} from "./realtimeBus";

/** 與 services/auth 的 session cookie 同名（auth 未匯出常數，改名要兩邊同步） */
const COOKIE_NAME = "aidos_session";

/** 8 色暖色盤：同一 userId 永遠拿到同一色（跨連線、跨重啟都穩定） */
const PALETTE = ["#c2613f", "#6e8b62", "#b58a3e", "#7a6ea8", "#3f7fa8", "#a85a7e", "#5f8d4e", "#a8703f"];
function colorFor(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 伺服器端每連線節流下限（ms）：client 自己也節流，但不能信任 client，超頻訊息直接丟棄 */
const MIN_CURSOR_MS = 24;
const MIN_FOCUS_MS = 150;
const MIN_INVALIDATE_MS = 400;

/** #7 連線數上限：同一 user 單房最多 4 條、單房最多 60 條、全域最多 500 條——超出即握手後 close(4429)，
 *  防單點多開放大 fanout／吃滿記憶體（DoS 面）。數字保守，正常協作遠低於此。 */
const MAX_PER_USER_PER_ROOM = 4;
const MAX_ROOM_CONNECTIONS = 60;
const MAX_TOTAL_CONNECTIONS = 500;

interface Client {
  ws: WebSocket;
  userId: string;
  name: string;
  color: string;
  /** join 當下的 session 雜湊與專案所屬組：心跳重驗用（登出/被移出組後最慢約 60 秒斷線） */
  tokenHash: string;
  groupId: string;
  /** 目前聚焦的編輯區塊（伺服器記住：新加入者的 hello 才帶得出既有狀態） */
  zone: string | null;
  /** 連續未回 pong 的次數；兩次沒回就斷線 */
  missedPongs: number;
  /** 伺服器端節流時間戳（見 MIN_*_MS） */
  lastCursorAt: number;
  lastFocusAt: number;
  lastInvalidateAt: number;
  /**
   * 被節流擋下的最後一則 invalidate，等節流窗過了補送。
   *
   * 舊版兩層檢查都是直接 `return` 丟棄，沒有補送——而 invalidate 不是游標那種
   * 「下一幀會再來一次」的連續訊號，它是離散事件。只要某一次改動剛好落在被吃掉的
   * 那 400ms 裡，對方的世界觀／素材庫可以**整場都停在半小時前**，而畫面上毫無異狀。
   */
  pendingInvalidate: { payload: Record<string, unknown>; timer: NodeJS.Timeout } | null;
}

/** 房間：roomKey（p:projectId 或 g:groupId）→ 連線集合（同一 user 開兩個分頁＝兩個 Client，presence 去重顯示一人） */
const rooms = new Map<string, Set<Client>>();

/** #7 全域連線總數（join +1／close -1）：全域上限檢查 O(1)，不必每次遍歷所有房間累加 */
let totalConnections = 0;
/** 每 user 目前連線數：歸零時順手清掉其廣播節流狀態，避免 userThrottle 隨時間無限膨脹 */
const userConnCount = new Map<string, number>();

/**
 * #7 每-user 廣播節流（跨同一 user 的多條連線聚合）：
 * 單分頁使用者與原行為完全一致——其單一連線本就受同頻率的 per-connection 節流限制，這層永不額外命中；
 * 只有同一人多開（多分頁）時，才把被放大的 fanout 收斂成每 user 一份，避免單人灌爆整房廣播。
 */
const userThrottle = new Map<string, { cursor: number; focus: number; invalidate: number }>();
function userThrottled(userId: string, kind: "cursor" | "focus" | "invalidate", now: number, minMs: number): boolean {
  let t = userThrottle.get(userId);
  if (!t) {
    t = { cursor: 0, focus: 0, invalidate: 0 };
    userThrottle.set(userId, t);
  }
  if (now - t[kind] < minMs) return true;
  t[kind] = now;
  return false;
}

/**
 * #20 Origin 白名單：只放行設定的對外網域與 localhost，擋跨站 WebSocket 劫持（SameSite=Lax 之外的縱深防禦）。
 * 白名單來源（平台中立，可多網域並存，讓「自訂網域＋平台網域」都連得上、不被誤擋）：
 *   1. APP_URL 的網域（既有）
 *   2. PUBLIC_DOMAIN——平台注入的公開網域；相容舊的 RAILWAY_PUBLIC_DOMAIN 後備（未設 PUBLIC_DOMAIN 時沿用）
 *   3. ALLOWED_ORIGINS——逗號分隔的額外網域清單（自訂網域、CDN 等）
 * APP_URL 未設＝開發環境，一律放行；Origin 標頭缺席（非瀏覽器客戶端）不擋——瀏覽器發起的跨站攻擊必帶 Origin。
 * 以「網域（hostname）」比對而非完整 origin：容忍反代造成的埠／scheme 差異，不誤擋正常連線。
 * 不設 PUBLIC_DOMAIN/ALLOWED_ORIGINS 時，行為與原本（APP_URL＋RAILWAY_PUBLIC_DOMAIN 後備）完全一致。
 */
function originAllowed(origin: string | undefined): boolean {
  if (!origin) return true;
  const appUrl = process.env.APP_URL?.trim();
  if (!appUrl) return true;
  let host: string;
  try {
    host = new URL(origin).hostname;
  } catch {
    return false; // Origin 非合法 URL：直接擋
  }
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") return true;
  const allowed = new Set<string>();
  // 把「可能帶 scheme／埠／路徑」的值統一正規化成 hostname 後加白名單；壞值逐一 try-catch 忽略，不影響其他來源。
  const addHost = (raw: string | undefined): void => {
    const v = raw?.trim();
    if (!v) return;
    try {
      allowed.add(new URL(/^https?:\/\//.test(v) ? v : `https://${v}`).hostname);
    } catch {
      /* 壞值：忽略此一項 */
    }
  };
  addHost(appUrl);
  // 平台注入的公開網域（PUBLIC_DOMAIN 優先，退回既有 RAILWAY_PUBLIC_DOMAIN）：APP_URL 設成自訂網域時不誤擋平台網域
  addHost(process.env.PUBLIC_DOMAIN || process.env.RAILWAY_PUBLIC_DOMAIN);
  // ALLOWED_ORIGINS：逗號分隔的多網域白名單，讓自訂網域＋平台網域＋CDN 並存時 WS 都不被擋
  for (const item of (process.env.ALLOWED_ORIGINS ?? "").split(",")) addHost(item);
  return allowed.has(host);
}

/** presence 用的去重名單（同 user 多連線只列一次）——僅本機房內 */
function localUsers(room: Set<Client>): Array<{ userId: string; name: string; color: string }> {
  const byUser = new Map<string, { userId: string; name: string; color: string }>();
  for (const c of room) {
    if (!byUser.has(c.userId)) byUser.set(c.userId, { userId: c.userId, name: c.name, color: c.color });
  }
  return [...byUser.values()];
}

/** 每人目前 zone（同 user 多連線取最後一個非空者）——僅本機房內 */
function localFocus(room: Set<Client>): Array<{ userId: string; zone: string }> {
  const byUser = new Map<string, string>();
  for (const c of room) {
    if (c.zone) byUser.set(c.userId, c.zone);
  }
  return [...byUser].map(([userId, zone]) => ({ userId, zone }));
}

/** 對外的在場名單＝本機 ∪ 其他實例回報的名冊（單機模式下就等於本機名單） */
function dedupeUsers(roomKey: string, room: Set<Client>): Array<{ userId: string; name: string; color: string }> {
  const local = localUsers(room);
  if (!isRealtimeBusEnabled()) return local;
  return mergeRosterUsers(local, remoteRosters(roomKey), Date.now());
}

function focusList(roomKey: string, room: Set<Client>): Array<{ userId: string; zone: string }> {
  const local = localFocus(room);
  if (!isRealtimeBusEnabled()) return local;
  return mergeRosterFocus(local, remoteRosters(roomKey), Date.now());
}

/** 只送給本機連線（收到跨實例訊息時用：來源連線不在這台機器上，沒有 except 可言） */
function sendLocal(room: Set<Client>, msg: unknown, except?: Client): void {
  const data = JSON.stringify(msg);
  for (const c of room) {
    if (c !== except && c.ws.readyState === WebSocket.OPEN) c.ws.send(data);
  }
}

/** 送給本機連線並同步到其他實例 */
function broadcast(roomKey: string, room: Set<Client>, msg: unknown, except?: Client): void {
  sendLocal(room, msg, except);
  publishRoomEvent(roomKey, msg);
}

/**
 * invalidate 的 scope 驗證：只收白名單 kind ＋ uuid 形狀的 id。
 *
 * 沒有這道守衛的話，scope 會變成一個「任何登入者都能塞任意字串進別人瀏覽器」的洞——
 * 接收端拿它去查表、拼 query key、甚至當 DOM 選擇器用，都是實打實的注入面。
 * 與 cursor 的 anchor 同一條原則：不信任 client，逐欄夾制後才轉發。
 */
const INVALIDATE_SCOPE_KINDS = new Set(["scene", "worldview", "asset", "card", "annotation", "knowledge"]);
function readInvalidateScope(raw: unknown): { kind: string; id: string | null } | null {
  if (!raw || typeof raw !== "object") return null;
  const kind = (raw as { kind?: unknown }).kind;
  if (typeof kind !== "string" || !INVALIDATE_SCOPE_KINDS.has(kind)) return null;
  const id = (raw as { id?: unknown }).id;
  return { kind, id: typeof id === "string" && UUID_RE.test(id) ? id : null };
}

/** 伺服器發起的推播節流（每專案）：代理一次 tick 會連寫多筆事件，不節流會對同房重複轟炸 */
const serverPushThrottle = new Map<string, number>();
const SERVER_PUSH_MIN_MS = 800;

/**
 * 伺服器端事件推播（C1 操演推播的最小形）：代理每步推進時喚醒專案房間裡的所有客戶端。
 *
 * 訊息帶兩層：
 * - `invalidate`：客戶端**既有**的處理路徑（realtime.tsx 收到就重取 react-query 快取）——
 *   代理進度從 4-8 秒輪詢變成即時，前端零改動。
 * - `agent-step`：帶 runId/stepId/eventKey 的具名事件。現在沒有客戶端消費它（未知
 *   type 會被 else-if 鏈安靜忽略），是留給操演 HUD（C3）的接點——屆時前端能知道
 *   「哪一步剛發生什麼」而不只是「有東西變了」，伺服器不必再改。
 *
 * 房間不存在也照樣發跨實例匯流排：使用者可能連在另一個 replica 上。
 * 節流是每專案 800ms 領先緣——漏掉的尾巴由 AgentCard 保留的輪詢兜底。
 */
export function notifyAgentProgress(
  projectId: string,
  step: { runId: string; stepId?: string | null; eventKey: string },
): void {
  const now = Date.now();
  const last = serverPushThrottle.get(projectId) ?? 0;
  if (now - last < SERVER_PUSH_MIN_MS) return;
  serverPushThrottle.set(projectId, now);
  const roomKey = `p:${projectId}`;
  const room = rooms.get(roomKey) ?? new Set<Client>();
  broadcast(roomKey, room, { type: "agent-step", runId: step.runId, stepId: step.stepId ?? null, eventKey: step.eventKey });
  broadcast(roomKey, room, { type: "invalidate" });
}

/**
 * 伺服器端對某專案房間廣播一則帶 scope 的 invalidate。
 *
 * 為什麼需要它：在此之前 invalidate **只有客戶端會發**——背景 runner 改完 DB 從不發訊號。
 * 於是「組長按下生成、把畫面留給組員看」時，成品落地那一刻組員端沒有任何即時訊息，
 * 只能等分鏡列 10s／單格工作室 20s／生成紀錄 45s 的輪詢慢慢追上。
 *
 * 部署前提（已確認）：現行部署是單一行程（railway.toml 的 startCommand 是單一 start.sh，
 * 環境變數清單沒有 PROCESS_ROLE，未設即 `all`），所以本機房間廣播就涵蓋所有連線者。
 * `broadcast` 同時發跨實例匯流排，將來開到多 replica 或拆 web/worker 時只要設了
 * REDIS_URL 就自動涵蓋；沒設 Redis 的多實例部署則會退化成「只有同實例的人收得到」，
 * 而不是壞掉——各查詢仍有輪詢兜底。
 */
export function publishToProject(
  projectId: string,
  scope: { kind: string; id?: string | null },
  label?: string,
): void {
  const roomKey = `p:${projectId}`;
  const room = rooms.get(roomKey) ?? new Set<Client>();
  const payload: Record<string, unknown> = { type: "invalidate", scope: { kind: scope.kind, id: scope.id ?? null } };
  if (label) payload.label = label;
  broadcast(roomKey, room, payload);
}

/**
 * 讀出「這個組現在有誰在線、各自在哪個專案／區塊」——協作首頁與協作中心的資料來源。
 *
 * 為什麼從記憶體讀而不是查表：presence 本來就是 ephemeral 的，把每一次 cursor／focus
 * 都寫進 DB 只會製造一張永遠在寫、永遠沒人查歷史的表（而且多實例下還要處理清理）。
 * 這裡直接投影現有的房間結構，跨實例的部分沿用 realtimeBus 的名冊——與畫面上看到的
 * 在場名單是同一個真相，不會出現「首頁說 3 人在線、專案頁只看得到 2 個」。
 *
 * 回傳只含 userId／name／色票／所在專案／zone：**不含游標座標、不落任何歷史**。
 * Presence 是「現在誰在哪」，不是行蹤紀錄。
 */
export interface CollaborationPresence {
  userId: string;
  name: string;
  color: string;
  /** 目前在哪些專案房（同一人多分頁可能同時在兩個專案） */
  projectIds: string[];
  /** 目前聚焦的編輯區塊（多分頁時取任一個非空者） */
  zone: string | null;
}

export function groupPresence(groupId: string, projectIds: string[]): CollaborationPresence[] {
  const byUser = new Map<string, CollaborationPresence>();
  const consider = (roomKey: string, projectId: string | null) => {
    const room = rooms.get(roomKey);
    if (!room) return;
    for (const c of room) {
      // 房間本身已由 authorize 保證同組，這裡再擋一次跨組滲漏（防未來改動時失守）
      if (c.groupId !== groupId) continue;
      const entry = byUser.get(c.userId) ?? { userId: c.userId, name: c.name, color: c.color, projectIds: [], zone: null };
      if (projectId && !entry.projectIds.includes(projectId)) entry.projectIds.push(projectId);
      if (c.zone && !entry.zone) entry.zone = c.zone;
      byUser.set(c.userId, entry);
    }
  };
  consider(`g:${groupId}`, null);
  for (const projectId of projectIds) consider(`p:${projectId}`, projectId);
  return [...byUser.values()];
}

/** 在場名單有變：本機重播一次（presence 是完整名單，不能只送差異） */
function broadcastPresence(roomKey: string, room: Set<Client>, except?: Client): void {
  sendLocal(room, { type: "presence", users: dedupeUsers(roomKey, room) }, except);
}

/** 把本機名冊公告出去，讓其他實例把我們這邊的人算進他們的在場名單 */
function announceRoster(roomKey: string, room: Set<Client>): void {
  publishRoster(roomKey, localUsers(room), localFocus(room));
}

// 跨實例訊息的處理：遠端事件轉發給本機同房連線；遠端名冊有變就重算在場名單。
configureRealtimeBus({
  onRemoteEvent: (roomKey, message) => {
    const room = rooms.get(roomKey);
    if (room) sendLocal(room, message);
  },
  onRosterChange: (roomKey) => {
    const room = rooms.get(roomKey);
    if (room) broadcastPresence(roomKey, room);
  },
});

/**
 * upgrade 階段驗證：session cookie → 使用者 → 專案存在且屬於使用者的組（或純 groupId 成員）。
 * 任一步不合法回 null（呼叫端直接 socket.destroy()，不進 WS 握手）。
 */
async function authorize(
  req: IncomingMessage,
  projectId: string | null,
  groupId: string | null,
): Promise<{ roomKey: string; userId: string; name: string; tokenHash: string; groupId: string } | null> {
  const token = parseCookies(req as Request)[COOKIE_NAME];
  if (!token) return null;
  const tokenHash = sha256(token);
  const [session] = await db
    .select()
    .from(schema.sessions)
    .where(and(eq(schema.sessions.tokenHash, tokenHash), gt(schema.sessions.expiresAt, new Date())));
  if (!session) return null;
  const auth = await loadAuthState(session.userId);
  if (sessionGate(auth) !== null || !auth) return null;

  if (projectId) {
    if (!UUID_RE.test(projectId)) return null;
    const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
    if (!project) return null;
    if (!auth.user.isSuperAdmin && !auth.groups.some((g) => g.groupId === project.groupId)) return null;
    return { roomKey: `p:${projectId}`, userId: auth.user.id, name: auth.user.name, tokenHash, groupId: project.groupId };
  }
  if (groupId) {
    if (!UUID_RE.test(groupId)) return null;
    if (!auth.user.isSuperAdmin && !auth.groups.some((g) => g.groupId === groupId)) return null;
    return { roomKey: `g:${groupId}`, userId: auth.user.id, name: auth.user.name, tokenHash, groupId };
  }
  return null;
}

/**
 * 心跳附帶的輕量重驗：WS 是長連線，join 後登出、session 過期或被移出組不會自動反映，
 * 這裡補上撤權空窗。查詢失敗（DB 抖動）視為「無法判定」不斷線，只在明確查到不符時關閉。
 */
async function revalidate(c: Client): Promise<void> {
  try {
    const [session] = await db
      .select({ userId: schema.sessions.userId })
      .from(schema.sessions)
      .where(and(eq(schema.sessions.tokenHash, c.tokenHash), gt(schema.sessions.expiresAt, new Date())));
    if (!session) {
      c.ws.close(4403, "權限已變更");
      return;
    }
    // #21 復用單一權限判定：loadAuthState 內含「users.status 非 active → 回 null」（被停用帳號即斷線）、
    // 開發者展開與組成員關係——不再各自查 users/groupMembers，判定口徑與 HTTP 端完全一致。
    const auth = await loadAuthState(c.userId);
    if (sessionGate(auth) !== null || !auth) {
      c.ws.close(4403, "權限已變更"); // 帳號被停用或已刪除
      return;
    }
    if (auth.user.isSuperAdmin) return;
    if (!auth.groups.some((g) => g.groupId === c.groupId)) c.ws.close(4403, "權限已變更");
  } catch {
    /* DB 抖動不斷線，下一輪重驗再判 */
  }
}

function join(ws: WebSocket, ctx: { roomKey: string; userId: string; name: string; tokenHash: string; groupId: string }): void {
  // 提早掛上 no-op error handler：無論是超限提早 close，或後續任何連線錯誤，都不讓它變成 unhandled
  ws.on("error", () => {
    /* close 事件會接手清理 */
  });

  const existing = rooms.get(ctx.roomKey);
  // #7 上限檢查（加入房間前）：全域 → 單房 → 同一 user 單房，任一超限即握手後 close(4429) 不入房。
  let sameUser = 0;
  if (existing) for (const c of existing) if (c.userId === ctx.userId) sameUser++;
  if (
    totalConnections >= MAX_TOTAL_CONNECTIONS ||
    (existing !== undefined && existing.size >= MAX_ROOM_CONNECTIONS) ||
    sameUser >= MAX_PER_USER_PER_ROOM
  ) {
    ws.close(4429, "連線數過多");
    return;
  }

  let room = existing;
  if (!room) {
    room = new Set();
    rooms.set(ctx.roomKey, room);
  }
  const client: Client = {
    ws,
    userId: ctx.userId,
    name: ctx.name,
    color: colorFor(ctx.userId),
    tokenHash: ctx.tokenHash,
    groupId: ctx.groupId,
    zone: null,
    missedPongs: 0,
    lastCursorAt: 0,
    lastFocusAt: 0,
    lastInvalidateAt: 0,
    pendingInvalidate: null,
  };
  room.add(client);
  totalConnections += 1;
  userConnCount.set(ctx.userId, (userConnCount.get(ctx.userId) ?? 0) + 1);
  const theRoom = room;
  const roomKey = ctx.roomKey;
  // 第一個本機連線進房時才訂閱該房的跨實例頻道（沒人在的房間不佔訂閱）。
  // 訂閱是非同步的，但不擋住 join：訂閱完成前的遠端事件會漏接幾十毫秒，
  // 而 presence 由名冊週期性重送收斂，不會留下永久不一致。
  void joinRoomBus(roomKey).then(() => announceRoster(roomKey, theRoom));

  ws.on("pong", () => {
    client.missedPongs = 0;
  });

  ws.on("message", (raw) => {
    let msg: { type?: unknown; x?: unknown; y?: unknown; zone?: unknown; anchor?: unknown; ax?: unknown; ay?: unknown; vy?: unknown; vx?: unknown; ci?: unknown; scope?: unknown; label?: unknown };
    try {
      const text = String(raw);
      if (text.length > 2048) return; // 協定內全是小訊息，超長一律視為異常丟棄
      msg = JSON.parse(text);
    } catch {
      return;
    }
    const now = Date.now();
    // 每則廣播先過 per-connection 節流（保留原有防護），再過 per-user 聚合（#7：擋同人多開的 fanout 放大）。
    if (msg.type === "cursor" && typeof msg.x === "number" && typeof msg.y === "number" && Number.isFinite(msg.x) && Number.isFinite(msg.y)) {
      if (now - client.lastCursorAt < MIN_CURSOR_MS) return;
      client.lastCursorAt = now;
      if (userThrottled(client.userId, "cursor", now, MIN_CURSOR_MS)) return;
      // x/y 頁面比例；anchor #id/data-fb；ax/ay 卡內比例；vy/vx 視窗比例；ci 表單 caret 比例（見 client/realtime.tsx）。
      // 全部夾制/驗證後才轉發——不信任 client（超長 anchor、超界數值一律收斂）。
      const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
      const anchor = typeof msg.anchor === "string" && msg.anchor.length <= 80 ? msg.anchor : null;
      const payload: Record<string, unknown> = {
        type: "cursor", userId: client.userId, name: client.name, color: client.color,
        x: clamp01(msg.x), y: clamp01(msg.y),
        anchor, ax: clamp01(typeof msg.ax === "number" ? msg.ax : 0), ay: clamp01(typeof msg.ay === "number" ? msg.ay : 0),
        vy: clamp01(typeof msg.vy === "number" ? msg.vy : 0.42),
        vx: clamp01(typeof msg.vx === "number" ? msg.vx : 0.5),
      };
      if (typeof msg.ci === "number" && Number.isFinite(msg.ci)) payload.ci = clamp01(msg.ci);
      broadcast(roomKey, theRoom, payload, client);
    } else if (msg.type === "focus" && (msg.zone === null || typeof msg.zone === "string")) {
      // zone「改變」（進入新區塊／離開）是有意義的離散事件，一律更新並廣播，不受節流丟棄——否則
      // 快速在兩個編輯區之間移動時，第二個 focus 被節流吃掉，協作者的編輯指示卡在舊區塊或整個消失。
      // 只有「同一區塊的重複 focus」才受節流（純冗餘、無新資訊）。
      const changed = client.zone !== msg.zone;
      if (!changed && now - client.lastFocusAt < MIN_FOCUS_MS) return;
      client.lastFocusAt = now;
      client.zone = msg.zone; // zone 一律更新（供 hello 帶出既有狀態）
      if (!changed && userThrottled(client.userId, "focus", now, MIN_FOCUS_MS)) return;
      broadcast(roomKey, theRoom, { type: "focus", userId: client.userId, zone: msg.zone }, client);
      // zone 也是名冊的一部分（新加入者的 hello 要帶得出既有聚焦），變更時同步給其他實例
      announceRoster(roomKey, theRoom);
    } else if (msg.type === "invalidate") {
      // scope／label 是 optional：沒帶就是舊行為（全域失效）。新舊客戶端可混跑。
      // 一律逐欄驗證後才轉發——不信任 client，與 cursor 同一條原則。
      const scope = readInvalidateScope(msg.scope);
      const label = typeof msg.label === "string" && msg.label.length <= 40 ? msg.label : null;
      const payload: Record<string, unknown> = { type: "invalidate", userId: client.userId, name: client.name };
      if (scope) payload.scope = scope;
      if (label) payload.label = label;

      const throttled =
        now - client.lastInvalidateAt < MIN_INVALIDATE_MS ||
        userThrottled(client.userId, "invalidate", now, MIN_INVALIDATE_MS);
      if (throttled) {
        // **補送而不是丟棄。** invalidate 是離散事件，不像游標下一幀會再來一次——
        // 丟掉的那一則就是永遠不會發生的一次刷新。只留最後一則（同一波連續改動裡，
        // 最後那則的 scope 才是使用者最終看到的狀態）。
        if (client.pendingInvalidate) clearTimeout(client.pendingInvalidate.timer);
        const timer = setTimeout(() => {
          const c = client;
          c.pendingInvalidate = null;
          if (c.ws.readyState !== WebSocket.OPEN) return;
          const stillThere = rooms.get(roomKey);
          if (!stillThere) return;
          c.lastInvalidateAt = Date.now();
          broadcast(roomKey, stillThere, payload, c);
        }, MIN_INVALIDATE_MS);
        // 定時器不該讓行程活著等一則刷新
        timer.unref?.();
        client.pendingInvalidate = { payload, timer };
        return;
      }
      client.lastInvalidateAt = now;
      broadcast(roomKey, theRoom, payload, client);
    }
  });

  ws.on("close", () => {
    theRoom.delete(client);
    totalConnections -= 1;
    // 尚未補送的 invalidate：連線都沒了，那則刷新沒有意義。
    // 定時器內雖已擋 readyState !== OPEN，但那是最後一道防線——留著它會讓已斷線的 Client
    // 物件被 timer 多活 400ms，而斷線風暴時這種殘留會一路累積。
    if (client.pendingInvalidate) {
      clearTimeout(client.pendingInvalidate.timer);
      client.pendingInvalidate = null;
    }
    // 遞減該 user 連線數；歸零即清掉其廣播節流狀態，避免 userThrottle 無限膨脹
    const remaining = (userConnCount.get(client.userId) ?? 1) - 1;
    if (remaining <= 0) {
      userConnCount.delete(client.userId);
      userThrottle.delete(client.userId);
    } else {
      userConnCount.set(client.userId, remaining);
    }
    if (theRoom.size === 0) {
      rooms.delete(roomKey);
      // 送一份空名冊再退訂：其他實例立刻把我們這邊的人移除，
      // 不必等 90 秒 TTL 過期才讓幽靈協作者從畫面上消失。
      announceRoster(roomKey, theRoom);
      leaveRoomBus(roomKey);
    } else {
      broadcastPresence(roomKey, theRoom);
      announceRoster(roomKey, theRoom);
    }
  });

  ws.send(
    JSON.stringify({
      type: "hello",
      self: { userId: client.userId, name: client.name, color: client.color },
      users: dedupeUsers(roomKey, theRoom),
      focus: focusList(roomKey, theRoom),
    }),
  );
  broadcastPresence(roomKey, theRoom, client);
}

export function attachRealtime(server: Server): void {
  // 協定內全是小訊息：4 KiB 已綽綽有餘，超過由 ws 直接斷線，不讓人灌大 payload 吃記憶體
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });

  const handleUpgrade = (req: IncomingMessage, socket: import("node:stream").Duplex, head: Buffer) => {
    socket.on("error", () => {
      /* 握手前的 socket 錯誤（對方直接斷線等）不讓它變成 unhandled */
    });
    if (isShuttingDown()) {
      socket.destroy();
      return;
    }
    let url: URL;
    try {
      url = new URL(req.url ?? "/", "http://internal");
    } catch {
      socket.destroy();
      return;
    }
    if (url.pathname !== "/ws") {
      // 本服務只有 /ws 一種 upgrade；其他路徑不接、也不能放著不管（會吊死連線）
      socket.destroy();
      return;
    }
    // #20 Origin 白名單：非白名單來源（跨站 WebSocket 劫持）握手前即斷，不進 DB 查詢
    if (!originAllowed(req.headers.origin)) {
      socket.destroy();
      return;
    }
    authorize(req, url.searchParams.get("projectId"), url.searchParams.get("groupId"))
      .then((ctx) => {
        if (!ctx || isShuttingDown()) {
          socket.destroy();
          return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => {
          wss.emit("connection", ws, req);
          join(ws, ctx);
        });
      })
      .catch(() => socket.destroy());
  };
  server.on("upgrade", handleUpgrade);

  // 心跳：每 30 秒 ping 一輪；連兩輪沒 pong（≒60 秒無回應）視為死連線強制斷開
  let round = 0;
  const heartbeat = setInterval(() => {
    round += 1;
    const recheck = round % 2 === 0; // 每兩輪（≒60 秒）附帶重驗權限，縮短撤權空窗
    for (const [roomKey, room] of rooms) {
      for (const c of room) {
        if (c.missedPongs >= 2) {
          c.ws.terminate(); // terminate 會觸發 close → 從房間移除並廣播 presence
          continue;
        }
        c.missedPongs += 1;
        c.ws.ping();
        if (recheck) void revalidate(c);
      }
      // 名冊每輪重送：實例重啟或訂閱短暫斷線後，其他實例最慢 30 秒就重新看到我們的人。
      announceRoster(roomKey, room);
    }
    // 清掉已消失實例的名冊，並把受影響房間的在場名單重播一次，
    // 否則某個 replica 被砍掉後，畫面上會留著永遠不會離開的幽靈協作者。
    for (const roomKey of pruneAllRosters()) {
      const room = rooms.get(roomKey);
      if (room) broadcastPresence(roomKey, room);
    }
  }, 30_000);
  server.on("close", () => clearInterval(heartbeat));
  onShutdown(() => {
    server.removeListener("upgrade", handleUpgrade);
    clearInterval(heartbeat);
    // 先送空名冊再退訂：其他實例立刻把本實例的人從在場名單移除，
    // 不必等 90 秒 TTL——滾動部署時「剛下線那台的人還掛在名單上」很容易被誤讀成系統故障。
    for (const roomKey of rooms.keys()) publishRoster(roomKey, [], []);
    closeRealtimeBus();
    return new Promise<void>((resolve) => {
      let settled = false;
      let forceTimer: NodeJS.Timeout | undefined;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (forceTimer) clearTimeout(forceTimer);
        resolve();
      };
      // WebSockets are upgraded sockets and are not covered by
      // httpServer.closeAllConnections(). Send a restart close code first,
      // then terminate peers that do not complete the handshake promptly.
      forceTimer = setTimeout(() => {
        for (const client of wss.clients) client.terminate();
        finish();
      }, 1_000);
      try {
        wss.close(finish);
        for (const client of wss.clients) {
          if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) {
            client.close(1001, "server shutting down");
          }
        }
      } catch {
        for (const client of wss.clients) client.terminate();
        finish();
      }
    });
  });
}
