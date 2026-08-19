/**
 * Story 共編的文件傳輸層（/ws-doc；計畫 §19-20）。
 *
 * 與既有 /ws 刻意分開：/ws 繼續跑 presence／cursor／focus／invalidate／view／present
 * 的小訊息（maxPayload 4KB），/ws-doc 專跑 Yjs 文件同步——兩者的訊息大小、頻率、
 * 生命週期完全不同，塞進同一條連線只會讓文件更新去排游標封包的隊。
 *
 * 協定（JSON；Y update 以 base64 內嵌——不引入 y-protocols 的二進位協定，
 * 少一個依賴、且與既有 /ws 的「JSON 訊息」除錯工具鏈一致）：
 *   server → client（join 時）  {type:"sync",  u:<base64 full state>}
 *   client → server             {type:"update", u:<base64 incremental>}
 *   server → 其他 client        {type:"update", u:<base64 incremental>}
 *   client ↔ server             {type:"awareness", a:{cursor,selectionEnd}}（帶 userId/name/color 轉發）
 *
 * 持久化（快照即壓實）：防抖 1.5s 後把 encodeStateAsUpdate 的完整快照 upsert 進
 * collab_documents——每次寫入都是壓實後的最新狀態，沒有 update log 要清。
 * 同一節拍把 Y.Text 內容 materialize 回 stories.content（走 applyWithRevision，
 * **帶 expectedRev**，衝突不覆蓋、也不把衝突快照落盤）——story parser／AI／
 * export／版本歷史／搜尋全部繼續工作，Story-first 管線一寸都不動。
 *
 * Authentication 完全重用 /ws 的那一套（authorizeRealtimeConn：session cookie →
 * 使用者 → 專案屬於使用者的組）——沒有第二套帳號或 token。
 */
import { Buffer } from "node:buffer";
import type { IncomingMessage, Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import * as Y from "yjs";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { parseDocKey } from "../../shared/textSync";
import { authorizeRealtimeConn } from "./realtime";
import { applyWithRevision, isRevisionConflictError } from "./revisionGuard";
import { isShuttingDown, onShutdown } from "./shutdown";

export const COLLAB_DOC_PATH = "/ws-doc";

/** Y.Doc 裡的正文欄位名——client 綁定端與 materialize 都認這個名字，兩邊要一起改 */
export const STORY_TEXT_KEY = "content";

/** 單一文件房的連線上限：故事共編是 3-8 人的場景，20 已是寬鬆天花板 */
const MAX_DOC_CONNECTIONS = 20;
/** 防抖落盤（快照＋materialize）的延遲 */
const PERSIST_DEBOUNCE_MS = 1500;
/**
 * 文件訊息上限：完整快照與長故事的增量都可能到百 KB 級——
 * 4MB 是 STORY_MAX_CHARS（20 萬字 ≈ 600KB UTF-8 ≈ 800KB base64）的寬鬆上限。
 */
const MAX_DOC_PAYLOAD = 4 * 1024 * 1024;

interface DocConn {
  ws: WebSocket;
  userId: string;
  name: string;
  color: string;
}

interface DocRoom {
  doc: Y.Doc;
  conns: Set<DocConn>;
  projectId: string;
  groupId: string;
  /** 最後一位改動者：materialize 回 stories 時記 updatedBy */
  lastEditor: string | null;
  persistTimer: NodeJS.Timeout | null;
  /** 落盤進行中時又有新改動：完成後再排一輪，不遺漏最後一筆 */
  dirty: boolean;
  persisting: boolean;
  /** 進行中的落盤：flushStoryDocNow 要等它結束，不能讀到半套 stories.content */
  persistInFlight: Promise<{ conflict: boolean }> | null;
  /**
   * 上次成功 materialize 進 stories.content 的 rev／正文。
   * persist 必須帶這組 expectedRev——否則 Yjs 落盤會把 Tab B 的 blur 存檔靜默蓋掉。
   * 進房時從現有 stories 列種初值。
   */
  lastMaterializedRev?: number;
  lastMaterializedContent?: string;
}

const docRooms = new Map<string, DocRoom>();

/** 8 色盤與 /ws 完全同一套（同一 userId 同一色）——awareness 的顏色不另起爐灶 */
const PALETTE = ["#c2613f", "#6e8b62", "#b58a3e", "#7a6ea8", "#3f7fa8", "#a85a7e", "#5f8d4e", "#a8703f"];
function colorFor(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

/* ── 持久化（獨立函式：pg 測試直接打，不必開 WebSocket） ─────────── */

function replaceStoryText(doc: Y.Doc, next: string): void {
  const t = doc.getText(STORY_TEXT_KEY);
  const cur = t.toString();
  if (cur === next) return;
  if (cur.length) t.delete(0, cur.length);
  if (next) t.insert(0, next);
}

async function persistStorySnapshot(projectId: string, groupId: string, doc: Y.Doc): Promise<void> {
  const snapshot = Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64");
  await db
    .insert(schema.collabDocuments)
    .values({ groupId, projectId, kind: "story", refId: projectId, snapshot, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [schema.collabDocuments.kind, schema.collabDocuments.refId],
      set: { snapshot, updatedAt: new Date() },
    });
}

/**
 * 載入（或初始化）某專案的故事 Y.Doc。
 * 有快照就還原快照；沒有就從 stories.content 種初值——既有專案第一次開共編時，
 * 夥伴看到的必須是現在的故事，不是一片空白。
 *
 * 快照與 stories.content 分叉時（典型：Yjs materialize 撞上另一分頁的 blur 存檔），
 * **以 SQL 為準**。若照快照開房，下一輪 persist 會帶著 SQL 的新 rev 把 blur 蓋回
 * 衝突快照——延遲的 last-write-wins。
 */
export async function loadStoryDoc(projectId: string): Promise<Y.Doc> {
  const doc = new Y.Doc();
  const [row] = await db
    .select()
    .from(schema.collabDocuments)
    .where(sql`${schema.collabDocuments.kind} = 'story' and ${schema.collabDocuments.refId} = ${projectId}`);
  if (row) {
    try {
      Y.applyUpdate(doc, Buffer.from(row.snapshot, "base64"));
    } catch (err) {
      // 壞快照：寧可退回 stories.content 重種，也不要讓整個共編開不起來
      console.warn("[collabDoc] 快照還原失敗，改由 stories.content 重種：", err instanceof Error ? err.message : err);
    }
  }
  const [story] = await db.select().from(schema.stories).where(eq(schema.stories.projectId, projectId));
  // 有 stories 列且與快照分叉：以 SQL 為準（blur／OCC 贏家）。沒有 stories 列才留快照。
  if (story && story.content !== doc.getText(STORY_TEXT_KEY).toString()) {
    replaceStoryText(doc, story.content);
  }
  return doc;
}

export type PersistStoryDocResult = {
  materialized: boolean;
  conflict: boolean;
  rev: number | null;
  content: string;
};

/**
 * 快照落盤＋materialize 回 stories.content。
 *
 * materialize **必須**帶 expectedRev（房間的 lastMaterializedRev）。
 * 省略時若改用剛讀到的 `existing.rev` 做 CAS，會在 OCC `story.save`
 * 之後「讀到新 rev → 條件寫入成功」把已存正文靜默蓋掉。
 * 內容有變且沒帶 expectedRev：當衝突拒絕，不覆蓋、不落衝突快照。
 * 衝突時也不丟錯讓 flushRoom 用新 rev 重試（那是延遲 LWW）。
 */
export async function persistStoryDoc(
  projectId: string,
  groupId: string,
  doc: Y.Doc,
  editorId: string | null,
  opts?: { expectedRev?: number; baselineContent?: string },
): Promise<PersistStoryDocResult> {
  const text = doc.getText(STORY_TEXT_KEY).toString();

  const [existing] = await db.select().from(schema.stories).where(eq(schema.stories.projectId, projectId));
  if (!existing) {
    const [row] = await db.insert(schema.stories).values({ projectId, groupId, content: text, updatedBy: editorId }).returning();
    await persistStorySnapshot(projectId, groupId, doc);
    return { materialized: true, conflict: false, rev: row.rev, content: row.content };
  }
  if (existing.content === text) {
    // 正文沒變：仍壓實快照（CRDT metadata），不動 stories.rev
    await persistStorySnapshot(projectId, groupId, doc);
    return { materialized: false, conflict: false, rev: existing.rev, content: existing.content };
  }
  if (opts?.expectedRev === undefined) {
    // 省略 expectedRev 若改用 existing.rev，OCC story.save 之後會靜默 LWW。
    console.warn("[collabDoc] persistStoryDoc omitted expectedRev — refuse silent LWW over stories.content");
    return { materialized: false, conflict: true, rev: existing.rev, content: existing.content };
  }
  try {
    const { row } = await applyWithRevision({
      entity: "story",
      table: schema.stories,
      idColumn: schema.stories.id,
      revColumn: schema.stories.rev,
      row: existing,
      patch: { content: text },
      bookkeeping: { updatedBy: editorId ?? existing.updatedBy, updatedAt: new Date() },
      expectedRev: opts.expectedRev,
      baseline: { content: opts.baselineContent ?? existing.content },
      reload: async () => {
        const [fresh] = await db.select().from(schema.stories).where(eq(schema.stories.id, existing.id));
        return fresh;
      },
      updatedByField: "updatedBy",
      updatedAtField: "updatedAt",
    });
    await persistStorySnapshot(projectId, groupId, doc);
    return { materialized: true, conflict: false, rev: row.rev, content: row.content };
  } catch (err) {
    if (isRevisionConflictError(err)) {
      console.warn("[collabDoc] materialize 撞到故事 rev 衝突，不覆蓋 stories.content、不落衝突快照");
      return { materialized: false, conflict: true, rev: existing.rev, content: existing.content };
    }
    throw err;
  }
}

/* ── 房間管理 ─────────────────────────────────────────── */

function schedulePersist(docKey: string, room: DocRoom): void {
  room.dirty = true;
  if (room.persistTimer) return;
  room.persistTimer = setTimeout(() => {
    room.persistTimer = null;
    void flushRoom(docKey, room);
  }, PERSIST_DEBOUNCE_MS);
  room.persistTimer.unref?.();
}

/**
 * Force the live Y.Doc (if any) onto stories.content now.
 * One-click generation must not start from a stale materialized snapshot
 * while the debounce timer is still waiting.
 */
export async function flushStoryDocNow(projectId: string): Promise<{
  content: string;
  rev: number | null;
  liveRoom: boolean;
  conflict: boolean;
}> {
  const docKey = `story:${projectId}`;
  const room = docRooms.get(docKey);
  let conflict = false;
  if (room) {
    if (room.persistTimer) {
      clearTimeout(room.persistTimer);
      room.persistTimer = null;
    }
    const flushed = await flushRoom(docKey, room);
    conflict = flushed.conflict;
  }
  const [story] = await db.select().from(schema.stories).where(eq(schema.stories.projectId, projectId));
  return {
    content: story?.content ?? (room ? room.doc.getText(STORY_TEXT_KEY).toString() : ""),
    rev: story?.rev ?? null,
    liveRoom: Boolean(room),
    conflict,
  };
}

async function flushRoom(docKey: string, room: DocRoom): Promise<{ conflict: boolean }> {
  if (room.persistInFlight) {
    const inFlight = await room.persistInFlight;
    if (!room.dirty) return inFlight;
  }
  room.persisting = true;
  room.dirty = false;
  const work = (async (): Promise<{ conflict: boolean }> => {
    try {
      const result = await persistStoryDoc(room.projectId, room.groupId, room.doc, room.lastEditor, {
        expectedRev: room.lastMaterializedRev,
        baselineContent: room.lastMaterializedContent,
      });
      if (result.conflict) {
        // 不重試：用新 rev 再寫就變成延遲的 last-write-wins，會蓋掉 Tab B 剛存進去的字。
        console.warn("[collabDoc] stories.content 與共編文件衝突，保留已存正文、不重試 materialize");
        return { conflict: true };
      }
      if (typeof result.rev === "number") room.lastMaterializedRev = result.rev;
      room.lastMaterializedContent = result.content;
      return { conflict: false };
    } catch (err) {
      room.dirty = true; // 失敗不吞：留旗等下一輪（或下一筆改動）再試
      console.warn("[collabDoc] 落盤失敗（稍後重試）：", err instanceof Error ? err.message : err);
      return { conflict: false };
    } finally {
      room.persisting = false;
      room.persistInFlight = null;
      if (room.dirty && room.conns.size > 0) schedulePersist(docKey, room);
    }
  })();
  room.persistInFlight = work;
  return work;
}

function sendJson(ws: WebSocket, msg: unknown): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

async function joinDoc(ws: WebSocket, docKey: string, projectId: string, ctx: { userId: string; name: string; groupId: string }): Promise<void> {
  ws.on("error", () => {
    /* close 會接手清理 */
  });

  let room = docRooms.get(docKey);
  if (!room) {
    // 第一個人進房：載入（或初始化）文件。載入期間的併發 join 靠 Map 的同步寫入擋住——
    // 先佔位（同步 set）再非同步載入，第二個人拿到同一個 room 物件等 doc 就緒。
    const doc = await loadStoryDoc(projectId);
    // 載入期間可能已有另一個 join 佔了位：以先佔位者為準，本次載入丟棄
    room = docRooms.get(docKey);
    if (!room) {
      const [story] = await db.select().from(schema.stories).where(eq(schema.stories.projectId, projectId));
      room = {
        doc,
        conns: new Set(),
        projectId,
        groupId: ctx.groupId,
        lastEditor: null,
        persistTimer: null,
        dirty: false,
        persisting: false,
        persistInFlight: null,
        lastMaterializedRev: story?.rev,
        lastMaterializedContent: story?.content ?? doc.getText(STORY_TEXT_KEY).toString(),
      };
      docRooms.set(docKey, room);
    }
  }
  if (room.conns.size >= MAX_DOC_CONNECTIONS) {
    ws.close(4429, "共編人數已達上限");
    return;
  }

  const conn: DocConn = { ws, userId: ctx.userId, name: ctx.name, color: colorFor(ctx.userId) };
  room.conns.add(conn);
  const theRoom = room;

  // join 即完整同步：晚進來的人拿到的是全文快照，不必重放歷史
  sendJson(ws, { type: "sync", u: Buffer.from(Y.encodeStateAsUpdate(theRoom.doc)).toString("base64") });

  ws.on("message", (raw) => {
    let msg: { type?: unknown; u?: unknown; a?: unknown };
    try {
      const text = String(raw);
      if (text.length > MAX_DOC_PAYLOAD) return;
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (msg.type === "update" && typeof msg.u === "string") {
      let update: Uint8Array;
      try {
        update = Buffer.from(msg.u, "base64");
        Y.applyUpdate(theRoom.doc, update);
      } catch (err) {
        // 壞 update 丟棄：一則畸形封包不可以炸掉整個房的文件
        console.warn("[collabDoc] 丟棄壞 update：", err instanceof Error ? err.message : err);
        return;
      }
      theRoom.lastEditor = conn.userId;
      const out = JSON.stringify({ type: "update", u: msg.u });
      for (const c of theRoom.conns) {
        if (c !== conn && c.ws.readyState === WebSocket.OPEN) c.ws.send(out);
      }
      schedulePersist(docKey, theRoom);
    } else if (msg.type === "awareness" && msg.a && typeof msg.a === "object") {
      // 逐欄夾制後帶身分轉發（caret 索引是數字、名字顏色由伺服器蓋章——不信任 client 自報身分）
      const a = msg.a as { cursor?: unknown; selectionEnd?: unknown; typing?: unknown };
      const clean: Record<string, unknown> = {
        userId: conn.userId,
        name: conn.name,
        color: conn.color,
      };
      if (typeof a.cursor === "number" && Number.isFinite(a.cursor)) clean.cursor = Math.max(0, Math.floor(a.cursor));
      if (typeof a.selectionEnd === "number" && Number.isFinite(a.selectionEnd)) clean.selectionEnd = Math.max(0, Math.floor(a.selectionEnd));
      if (typeof a.typing === "boolean") clean.typing = a.typing;
      const out = JSON.stringify({ type: "awareness", a: clean });
      for (const c of theRoom.conns) {
        if (c !== conn && c.ws.readyState === WebSocket.OPEN) c.ws.send(out);
      }
    }
  });

  ws.on("close", () => {
    theRoom.conns.delete(conn);
    // 離場廣播：對方的 caret 要消失，不能掛在畫面上變幽靈
    const out = JSON.stringify({ type: "awareness", a: { userId: conn.userId, name: conn.name, color: conn.color, gone: true } });
    for (const c of theRoom.conns) {
      if (c.ws.readyState === WebSocket.OPEN) c.ws.send(out);
    }
    if (theRoom.conns.size === 0) {
      // 最後一個人離開：立即落盤後釋放房間（不等防抖）——記憶體裡的文件不過夜
      if (theRoom.persistTimer) {
        clearTimeout(theRoom.persistTimer);
        theRoom.persistTimer = null;
      }
      void flushRoom(docKey, theRoom).finally(() => {
        if (theRoom.conns.size === 0) docRooms.delete(docKey);
      });
    }
  });
}

export function attachCollabDoc(server: Server): void {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_DOC_PAYLOAD });

  const handleUpgrade = (req: IncomingMessage, socket: import("node:stream").Duplex, head: Buffer) => {
    socket.on("error", () => {
      /* 握手前的 socket 錯誤不讓它變成 unhandled */
    });
    if (isShuttingDown()) return; // realtime 的 handler 會 destroy 未知路徑；這裡只管自己的
    let url: URL;
    try {
      url = new URL(req.url ?? "/", "http://internal");
    } catch {
      return;
    }
    if (url.pathname !== COLLAB_DOC_PATH) return; // 不是我們的路徑：交給其他 handler
    const parsed = parseDocKey(url.searchParams.get("doc"));
    if (!parsed) {
      socket.destroy();
      return;
    }
    // Auth 與 /ws 同一套：session cookie → 使用者 → 專案屬於使用者的組
    authorizeRealtimeConn(req, parsed.refId, null)
      .then((ctx) => {
        if (!ctx || isShuttingDown()) {
          socket.destroy();
          return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => {
          wss.emit("connection", ws, req);
          void joinDoc(ws, `${parsed.kind}:${parsed.refId}`, parsed.refId, ctx);
        });
      })
      .catch(() => socket.destroy());
  };
  server.on("upgrade", handleUpgrade);

  onShutdown(async () => {
    server.removeListener("upgrade", handleUpgrade);
    // 關機前把每個房間都落盤——記憶體裡未 flush 的內容不可以跟著行程一起消失
    const flushes: Promise<{ conflict: boolean }>[] = [];
    for (const [docKey, room] of docRooms) {
      if (room.persistTimer) {
        clearTimeout(room.persistTimer);
        room.persistTimer = null;
      }
      flushes.push(flushRoom(docKey, room));
      for (const c of room.conns) {
        try {
          c.ws.close(1001, "server shutting down");
        } catch {
          /* 已斷線 */
        }
      }
    }
    await Promise.allSettled(flushes);
  });
}
