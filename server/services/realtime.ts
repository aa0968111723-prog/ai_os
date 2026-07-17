/**
 * 即時協作 WebSocket（任務 D）：presence、彩色游標、編輯指示、粗粒度「有東西變了」通知。
 * 路徑 /ws?projectId=<uuid>；由 index.ts 呼叫 attachRealtime(httpServer) 掛上。
 * 協定與 client/src/realtime.tsx 嚴格對應——兩邊要一起改。
 */
import type { IncomingMessage, Server } from "node:http";
import type { Request } from "express";
import { WebSocketServer, WebSocket } from "ws";
import { and, eq, gt } from "drizzle-orm";
import { db, schema } from "../db";
import { loadAuthState, parseCookies, sha256 } from "./auth";

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
const MIN_CURSOR_MS = 40;
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
}

/** 房間：projectId → 連線集合（同一 user 開兩個分頁＝兩個 Client，presence 去重顯示一人） */
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

/** presence 用的去重名單（同 user 多連線只列一次） */
function dedupeUsers(room: Set<Client>): Array<{ userId: string; name: string; color: string }> {
  const byUser = new Map<string, { userId: string; name: string; color: string }>();
  for (const c of room) {
    if (!byUser.has(c.userId)) byUser.set(c.userId, { userId: c.userId, name: c.name, color: c.color });
  }
  return [...byUser.values()];
}

/** 每人目前 zone（同 user 多連線取最後一個非空者） */
function focusList(room: Set<Client>): Array<{ userId: string; zone: string }> {
  const byUser = new Map<string, string>();
  for (const c of room) {
    if (c.zone) byUser.set(c.userId, c.zone);
  }
  return [...byUser].map(([userId, zone]) => ({ userId, zone }));
}

function broadcast(room: Set<Client>, msg: unknown, except?: Client): void {
  const data = JSON.stringify(msg);
  for (const c of room) {
    if (c !== except && c.ws.readyState === WebSocket.OPEN) c.ws.send(data);
  }
}

/**
 * upgrade 階段驗證：session cookie → 使用者 → 專案存在且屬於使用者的組（超管放行）。
 * 任一步不合法回 null（呼叫端直接 socket.destroy()，不進 WS 握手）。
 */
async function authorize(
  req: IncomingMessage,
  projectId: string | null,
): Promise<{ projectId: string; userId: string; name: string; tokenHash: string; groupId: string } | null> {
  // 先擋非 uuid：避免拿使用者輸入去查 uuid 欄位時 pg 直接丟型別錯誤
  if (!projectId || !UUID_RE.test(projectId)) return null;
  // parseCookies 只讀 headers.cookie——upgrade 的 IncomingMessage 有同欄位，型別上以 Request 視之即可
  const token = parseCookies(req as Request)[COOKIE_NAME];
  if (!token) return null;
  const tokenHash = sha256(token);
  const [session] = await db
    .select()
    .from(schema.sessions)
    .where(and(eq(schema.sessions.tokenHash, tokenHash), gt(schema.sessions.expiresAt, new Date())));
  if (!session) return null;
  const auth = await loadAuthState(session.userId);
  if (!auth) return null;
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
  if (!project) return null;
  if (!auth.user.isSuperAdmin && !auth.groups.some((g) => g.groupId === project.groupId)) return null;
  return { projectId, userId: auth.user.id, name: auth.user.name, tokenHash, groupId: project.groupId };
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
    // 超管展開與組成員關係——不再各自查 users/groupMembers，判定口徑與 HTTP 端完全一致。
    const auth = await loadAuthState(c.userId);
    if (!auth) {
      c.ws.close(4403, "權限已變更"); // 帳號被停用或已刪除
      return;
    }
    if (auth.user.isSuperAdmin) return;
    if (!auth.groups.some((g) => g.groupId === c.groupId)) c.ws.close(4403, "權限已變更");
  } catch {
    /* DB 抖動不斷線，下一輪重驗再判 */
  }
}

function join(ws: WebSocket, ctx: { projectId: string; userId: string; name: string; tokenHash: string; groupId: string }): void {
  // 提早掛上 no-op error handler：無論是超限提早 close，或後續任何連線錯誤，都不讓它變成 unhandled
  ws.on("error", () => {
    /* close 事件會接手清理 */
  });

  const existing = rooms.get(ctx.projectId);
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
    rooms.set(ctx.projectId, room);
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
  };
  room.add(client);
  totalConnections += 1;
  userConnCount.set(ctx.userId, (userConnCount.get(ctx.userId) ?? 0) + 1);
  const theRoom = room;

  ws.on("pong", () => {
    client.missedPongs = 0;
  });

  ws.on("message", (raw) => {
    let msg: { type?: unknown; x?: unknown; y?: unknown; zone?: unknown; anchor?: unknown; ax?: unknown; ay?: unknown };
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
      // x/y 為 0..1 頁面比例；anchor 為游標所在 [data-fb] 卡片代號＋卡內比例（跨版面對位用，見 client/realtime.tsx）。
      // 全部夾制/驗證後才轉發——不信任 client（超長 anchor、超界數值一律收斂）。
      const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
      const anchor = typeof msg.anchor === "string" && msg.anchor.length <= 80 ? msg.anchor : null;
      broadcast(
        theRoom,
        {
          type: "cursor", userId: client.userId, name: client.name, color: client.color,
          x: clamp01(msg.x), y: clamp01(msg.y),
          anchor, ax: clamp01(typeof msg.ax === "number" ? msg.ax : 0), ay: clamp01(typeof msg.ay === "number" ? msg.ay : 0),
        },
        client,
      );
    } else if (msg.type === "focus" && (msg.zone === null || typeof msg.zone === "string")) {
      // zone「改變」（進入新區塊／離開）是有意義的離散事件，一律更新並廣播，不受節流丟棄——否則
      // 快速在兩個編輯區之間移動時，第二個 focus 被節流吃掉，協作者的編輯指示卡在舊區塊或整個消失。
      // 只有「同一區塊的重複 focus」才受節流（純冗餘、無新資訊）。
      const changed = client.zone !== msg.zone;
      if (!changed && now - client.lastFocusAt < MIN_FOCUS_MS) return;
      client.lastFocusAt = now;
      client.zone = msg.zone; // zone 一律更新（供 hello 帶出既有狀態）
      if (!changed && userThrottled(client.userId, "focus", now, MIN_FOCUS_MS)) return;
      broadcast(theRoom, { type: "focus", userId: client.userId, zone: msg.zone }, client);
    } else if (msg.type === "invalidate") {
      if (now - client.lastInvalidateAt < MIN_INVALIDATE_MS) return;
      client.lastInvalidateAt = now;
      if (userThrottled(client.userId, "invalidate", now, MIN_INVALIDATE_MS)) return;
      broadcast(theRoom, { type: "invalidate", userId: client.userId }, client);
    }
  });

  ws.on("close", () => {
    theRoom.delete(client);
    totalConnections -= 1;
    // 遞減該 user 連線數；歸零即清掉其廣播節流狀態，避免 userThrottle 無限膨脹
    const remaining = (userConnCount.get(client.userId) ?? 1) - 1;
    if (remaining <= 0) {
      userConnCount.delete(client.userId);
      userThrottle.delete(client.userId);
    } else {
      userConnCount.set(client.userId, remaining);
    }
    if (theRoom.size === 0) {
      rooms.delete(ctx.projectId);
    } else {
      broadcast(theRoom, { type: "presence", users: dedupeUsers(theRoom) });
    }
  });

  ws.send(
    JSON.stringify({
      type: "hello",
      self: { userId: client.userId, name: client.name, color: client.color },
      users: dedupeUsers(theRoom),
      focus: focusList(theRoom),
    }),
  );
  broadcast(theRoom, { type: "presence", users: dedupeUsers(theRoom) }, client);
}

export function attachRealtime(server: Server): void {
  // 協定內全是小訊息：4 KiB 已綽綽有餘，超過由 ws 直接斷線，不讓人灌大 payload 吃記憶體
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });

  server.on("upgrade", (req, socket, head) => {
    socket.on("error", () => {
      /* 握手前的 socket 錯誤（對方直接斷線等）不讓它變成 unhandled */
    });
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
    authorize(req, url.searchParams.get("projectId"))
      .then((ctx) => {
        if (!ctx) {
          socket.destroy();
          return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => {
          wss.emit("connection", ws, req);
          join(ws, ctx);
        });
      })
      .catch(() => socket.destroy());
  });

  // 心跳：每 30 秒 ping 一輪；連兩輪沒 pong（≒60 秒無回應）視為死連線強制斷開
  let round = 0;
  const heartbeat = setInterval(() => {
    round += 1;
    const recheck = round % 2 === 0; // 每兩輪（≒60 秒）附帶重驗權限，縮短撤權空窗
    for (const room of rooms.values()) {
      for (const c of room) {
        if (c.missedPongs >= 2) {
          c.ws.terminate(); // terminate 會觸發 close → 從房間移除並廣播 presence
          continue;
        }
        c.missedPongs += 1;
        c.ws.ping();
        if (recheck) void revalidate(c);
      }
    }
  }, 30_000);
  server.on("close", () => clearInterval(heartbeat));
}
