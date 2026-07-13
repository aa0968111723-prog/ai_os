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
    const [user] = await db.select({ isSuperAdmin: schema.users.isSuperAdmin }).from(schema.users).where(eq(schema.users.id, c.userId));
    if (user?.isSuperAdmin) return;
    const [membership] = await db
      .select({ id: schema.groupMembers.id })
      .from(schema.groupMembers)
      .where(and(eq(schema.groupMembers.groupId, c.groupId), eq(schema.groupMembers.userId, c.userId)));
    if (!membership) c.ws.close(4403, "權限已變更");
  } catch {
    /* DB 抖動不斷線，下一輪重驗再判 */
  }
}

function join(ws: WebSocket, ctx: { projectId: string; userId: string; name: string; tokenHash: string; groupId: string }): void {
  let room = rooms.get(ctx.projectId);
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
  const theRoom = room;

  ws.on("pong", () => {
    client.missedPongs = 0;
  });
  ws.on("error", () => {
    /* close 事件會接手清理 */
  });

  ws.on("message", (raw) => {
    let msg: { type?: unknown; x?: unknown; y?: unknown; zone?: unknown };
    try {
      const text = String(raw);
      if (text.length > 2048) return; // 協定內全是小訊息，超長一律視為異常丟棄
      msg = JSON.parse(text);
    } catch {
      return;
    }
    const now = Date.now();
    if (msg.type === "cursor" && typeof msg.x === "number" && typeof msg.y === "number" && Number.isFinite(msg.x) && Number.isFinite(msg.y)) {
      if (now - client.lastCursorAt < MIN_CURSOR_MS) return;
      client.lastCursorAt = now;
      broadcast(theRoom, { type: "cursor", userId: client.userId, name: client.name, color: client.color, x: msg.x, y: msg.y }, client);
    } else if (msg.type === "focus" && (msg.zone === null || typeof msg.zone === "string")) {
      if (now - client.lastFocusAt < MIN_FOCUS_MS) return;
      client.lastFocusAt = now;
      client.zone = msg.zone;
      broadcast(theRoom, { type: "focus", userId: client.userId, zone: msg.zone }, client);
    } else if (msg.type === "invalidate") {
      if (now - client.lastInvalidateAt < MIN_INVALIDATE_MS) return;
      client.lastInvalidateAt = now;
      broadcast(theRoom, { type: "invalidate", userId: client.userId }, client);
    }
  });

  ws.on("close", () => {
    theRoom.delete(client);
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
