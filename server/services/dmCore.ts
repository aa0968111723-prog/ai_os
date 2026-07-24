/**
 * 站內私訊核心（tRPC dm router 與 MCP 私訊工具共用的單一路徑）：
 * - 可私訊對象＝「同組夥伴」（含團隊管理員展開的組）＋開發者（全站支援窗口，雙向可訊）；
 *   開發者可與所有人互訊。對象解析集中在這裡，兩個介面絕不分岔。
 * - 私密界：所有讀取一律以「本人是 sender 或 recipient」過濾——組長/管理員也看不到別人的私訊。
 * - 已讀水位：與專案留言 messageReads 同一套語意（每人對每位對話者一筆 lastReadAt）。
 */
import { and, desc, eq, gt, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db, schema } from "../db";
import type { AuthState } from "./auth";
import { pushToUsers } from "./webPush";

/** 單則私訊長度上限（與專案留言一致） */
export const DM_MAX_BODY = 2000;

/** 對話串預覽的內文截斷長度 */
export const DM_SNIPPET_CHARS = 80;

/** 純函式：兩人是否有共同組（可私訊判定的核心；開發者另有全站豁免） */
export function sharesAnyGroup(myGroupIds: readonly string[], peerGroupIds: readonly string[]): boolean {
  if (myGroupIds.length === 0 || peerGroupIds.length === 0) return false;
  const mine = new Set(myGroupIds);
  return peerGroupIds.some((id) => mine.has(id));
}

/** 純函式：對話串預覽截斷（超長補省略號；換行折成空白，預覽單行呈現） */
export function dmSnippet(body: string, max = DM_SNIPPET_CHARS): string {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

export interface DmPeer {
  userId: string;
  name: string;
  email: string;
  isSuperAdmin: boolean;
  /** 與我共同的組（顯示用，如「北區工作組・剪輯組」）；開發者對象可能為空陣列 */
  sharedGroups: string[];
}

/**
 * 可私訊對象清單：同組夥伴（我在 auth.groups 的每個組的成員）＋開發者；開發者本人＝全站。
 * 只回啟用中帳號；不含自己。所有登入者可用（與通訊錄頁「組長以上」的界不同——私訊是人人的參與出口）。
 */
export async function listDmPeers(auth: AuthState): Promise<DmPeer[]> {
  const myGroupIds = auth.groups.map((g) => g.groupId);
  const groupLabel = new Map(auth.groups.map((g) => [g.groupId, `${g.teamName}・${g.groupName}`]));

  // 我可見組的全部組籍 → 逐人聚合共同組標籤
  const memberRows = myGroupIds.length
    ? await db
        .select({ groupId: schema.groupMembers.groupId, userId: schema.groupMembers.userId })
        .from(schema.groupMembers)
        .where(inArray(schema.groupMembers.groupId, myGroupIds))
    : [];
  const sharedByUser = new Map<string, string[]>();
  for (const m of memberRows) {
    if (m.userId === auth.user.id) continue;
    const label = groupLabel.get(m.groupId);
    if (!label) continue;
    const list = sharedByUser.get(m.userId) ?? [];
    if (!list.includes(label)) list.push(label);
    sharedByUser.set(m.userId, list);
  }

  let candidates: Array<{ id: string; name: string; email: string; isSuperAdmin: boolean }>;
  if (auth.user.isSuperAdmin) {
    // 開發者：全站啟用中帳號都可私訊
    candidates = await db
      .select({ id: schema.users.id, name: schema.users.name, email: schema.users.email, isSuperAdmin: schema.users.isSuperAdmin })
      .from(schema.users)
      .where(eq(schema.users.status, "active"));
  } else {
    // 一般成員：同組夥伴＋開發者（全站支援窗口——開發者可訊我，我也要能回）
    const sharedIds = [...sharedByUser.keys()];
    const conds = [eq(schema.users.isSuperAdmin, true)];
    if (sharedIds.length) conds.push(inArray(schema.users.id, sharedIds));
    candidates = await db
      .select({ id: schema.users.id, name: schema.users.name, email: schema.users.email, isSuperAdmin: schema.users.isSuperAdmin })
      .from(schema.users)
      .where(and(eq(schema.users.status, "active"), or(...conds)));
  }

  return candidates
    .filter((u) => u.id !== auth.user.id)
    .map((u) => ({
      userId: u.id,
      name: u.name,
      email: u.email,
      isSuperAdmin: u.isSuperAdmin,
      sharedGroups: (sharedByUser.get(u.id) ?? []).sort((a, b) => a.localeCompare(b, "zh-Hant")),
    }))
    // 同組的排前面（最常聊），其次姓名——開發者若無共同組排在後段
    .sort((a, b) => (b.sharedGroups.length > 0 ? 1 : 0) - (a.sharedGroups.length > 0 ? 1 : 0) || a.name.localeCompare(b.name, "zh-Hant"));
}

/** 是否可與某對象互訊（不拋錯版；供歷史讀取的寬鬆界用） */
async function canDmPeer(auth: AuthState, peer: { id: string; isSuperAdmin: boolean }): Promise<boolean> {
  if (peer.id === auth.user.id) return false;
  if (auth.user.isSuperAdmin || peer.isSuperAdmin) return true;
  const myGroupIds = auth.groups.map((g) => g.groupId);
  if (myGroupIds.length === 0) return false;
  const [row] = await db
    .select({ id: schema.groupMembers.id })
    .from(schema.groupMembers)
    .where(and(eq(schema.groupMembers.userId, peer.id), inArray(schema.groupMembers.groupId, myGroupIds)))
    .limit(1);
  return row != null;
}

/**
 * 送訊守衛：對象存在、啟用中、且在可私訊界內（同組或任一方為開發者）。
 * 查無／不可訊一律回同一句「找不到」——不對外洩漏他組成員是否存在。
 */
export async function assertDmPeer(auth: AuthState, peerId: string) {
  const [peer] = await db.select().from(schema.users).where(eq(schema.users.id, peerId));
  if (!peer || peer.status !== "active" || !(await canDmPeer(auth, peer))) {
    throw new TRPCError({ code: "NOT_FOUND", message: "找不到這位夥伴（只能私訊同組夥伴或開發者）" });
  }
  return peer;
}

/** 送出私訊（呼叫端先驗長度；這裡守對象界） */
export async function sendDm(auth: AuthState, peerId: string, body: string) {
  const peer = await assertDmPeer(auth, peerId);
  const [msg] = await db
    .insert(schema.dmMessages)
    .values({ senderId: auth.user.id, recipientId: peer.id, body })
    .returning();
  // 跨裝置推播給收件人（fire-and-forget）：內文只帶預覽截斷（與對話串預覽同口徑）；
  // 同一發訊人以 tag 覆蓋舊通知，連發多句不洗版。點開直達聊天頁。
  void pushToUsers([peer.id], {
    title: `${auth.user.name} 傳來私訊`,
    body: dmSnippet(body),
    url: "/chat",
    tag: `dm-${auth.user.id}`,
  }).catch((err) => console.warn("[dm] 私訊推播失敗：", err instanceof Error ? err.message : err));
  return { message: msg, peer: { userId: peer.id, name: peer.name } };
}

export interface DmThread {
  peerId: string;
  peerName: string;
  peerEmail: string;
  lastBody: string;
  lastFromMe: boolean;
  lastAt: Date;
  unread: number;
}

/** 每位對話者的未讀數（對方來訊晚於我的已讀水位；無水位＝全算） */
async function unreadBySender(userId: string): Promise<Map<string, number>> {
  const rows = await db
    .select({ senderId: schema.dmMessages.senderId, count: sql<number>`count(*)::int` })
    .from(schema.dmMessages)
    .leftJoin(schema.dmReads, and(eq(schema.dmReads.userId, userId), eq(schema.dmReads.peerId, schema.dmMessages.senderId)))
    .where(and(
      eq(schema.dmMessages.recipientId, userId),
      or(isNull(schema.dmReads.lastReadAt), gt(schema.dmMessages.createdAt, schema.dmReads.lastReadAt)),
    ))
    .groupBy(schema.dmMessages.senderId);
  return new Map(rows.map((r) => [r.senderId, r.count]));
}

/** 對話串清單：與我有往來的每位對象一列（最後一句預覽＋未讀數），新到舊 */
export async function listDmThreads(auth: AuthState): Promise<DmThread[]> {
  const me = auth.user.id;
  // CTE 先把「對方是誰」算成一欄再 group by 欄名——CASE 直接放 select＋group by 會因
  // 兩處綁不同參數（$1 vs $n）被 Postgres 視為不同運算式而報錯（參數化查詢比對不了語意相等）
  const result = await db.execute<{ peer: string; last_at: string; last_body: string; last_sender: string }>(sql`
    with mine as (
      select case when ${schema.dmMessages.senderId} = ${me} then ${schema.dmMessages.recipientId} else ${schema.dmMessages.senderId} end as peer,
             ${schema.dmMessages.body} as body, ${schema.dmMessages.senderId} as sender_id, ${schema.dmMessages.createdAt} as created_at
      from ${schema.dmMessages}
      where ${or(eq(schema.dmMessages.senderId, me), eq(schema.dmMessages.recipientId, me))}
    )
    select peer,
           max(created_at)::text as last_at,
           (array_agg(body order by created_at desc))[1] as last_body,
           (array_agg(sender_id order by created_at desc))[1] as last_sender
    from mine
    group by peer
  `);
  const rows = result.rows.map((r) => ({
    peerId: r.peer,
    lastAt: r.last_at,
    lastBody: r.last_body,
    lastFromMe: r.last_sender === me,
  }));
  if (rows.length === 0) return [];

  const [users, unread] = await Promise.all([
    db
      .select({ id: schema.users.id, name: schema.users.name, email: schema.users.email })
      .from(schema.users)
      .where(inArray(schema.users.id, rows.map((r) => r.peerId))),
    unreadBySender(me),
  ]);
  const userById = new Map(users.map((u) => [u.id, u]));
  return rows
    .map((r) => {
      const u = userById.get(r.peerId);
      return {
        peerId: r.peerId,
        peerName: u?.name ?? "（已移除的帳號）",
        peerEmail: u?.email ?? "",
        lastBody: dmSnippet(r.lastBody),
        lastFromMe: r.lastFromMe,
        lastAt: new Date(r.lastAt),
        unread: unread.get(r.peerId) ?? 0,
      };
    })
    .sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime());
}

/** 未讀總數（頂欄徽章用）：對方來訊晚於各自水位的加總 */
export async function dmUnreadTotal(auth: AuthState): Promise<number> {
  const unread = await unreadBySender(auth.user.id);
  let total = 0;
  for (const n of unread.values()) total += n;
  return total;
}

export interface DmHistoryItem {
  id: string;
  fromMe: boolean;
  body: string;
  createdAt: Date;
}

/**
 * 與某對象的歷史訊息（舊到新；before 游標往前翻頁）。
 * 界比送訊寬：可私訊對象、或「曾有往來」（對方被移出組後，既有對話仍可回看）；兩者皆非＝視為不存在。
 */
export async function listDmHistory(
  auth: AuthState,
  peerId: string,
  opts: { before?: Date; limit?: number } = {},
): Promise<{ peer: { userId: string; name: string; email: string }; items: DmHistoryItem[]; hasMore: boolean }> {
  const me = auth.user.id;
  const pairCond = or(
    and(eq(schema.dmMessages.senderId, me), eq(schema.dmMessages.recipientId, peerId)),
    and(eq(schema.dmMessages.senderId, peerId), eq(schema.dmMessages.recipientId, me)),
  );
  const [peer] = await db.select().from(schema.users).where(eq(schema.users.id, peerId));
  if (!peer) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這位夥伴" });
  if (!(await canDmPeer(auth, peer))) {
    const [existing] = await db.select({ id: schema.dmMessages.id }).from(schema.dmMessages).where(pairCond).limit(1);
    if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這位夥伴（只能私訊同組夥伴或開發者）" });
  }

  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
  const conds = [pairCond];
  if (opts.before) conds.push(lt(schema.dmMessages.createdAt, opts.before));
  // 多抓一筆判斷還有沒有更舊的（hasMore），不多跑一次 count
  const rows = await db
    .select()
    .from(schema.dmMessages)
    .where(and(...conds))
    .orderBy(desc(schema.dmMessages.createdAt))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit).reverse();
  return {
    peer: { userId: peer.id, name: peer.name, email: peer.email },
    items: page.map((m) => ({ id: m.id, fromMe: m.senderId === me, body: m.body, createdAt: m.createdAt })),
    hasMore,
  };
}

/** 已讀水位上報（與 messages.markRead 同語意的 upsert；高頻、無安全意義，審計豁免見 trpc.ts） */
export async function markDmRead(auth: AuthState, peerId: string): Promise<void> {
  const updated = await db
    .update(schema.dmReads)
    .set({ lastReadAt: new Date() })
    .where(and(eq(schema.dmReads.userId, auth.user.id), eq(schema.dmReads.peerId, peerId)))
    .returning();
  if (updated.length === 0) {
    await db.insert(schema.dmReads).values({ userId: auth.user.id, peerId });
  }
}

/**
 * MCP 用的對象解析：接受 userId（uuid）或 email——外部 AI 常只知道 email。
 * 一律先過 listDmPeers 的可訊界，找不到就回 null（呼叫端給人話錯誤）。
 */
export async function resolveDmPeerRef(auth: AuthState, ref: string): Promise<DmPeer | null> {
  const peers = await listDmPeers(auth);
  const needle = ref.trim().toLowerCase();
  return (
    peers.find((p) => p.userId.toLowerCase() === needle) ??
    peers.find((p) => p.email.toLowerCase() === needle) ??
    peers.find((p) => p.name === ref.trim()) ??
    null
  );
}
