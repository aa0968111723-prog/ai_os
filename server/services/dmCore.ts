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
import { listVisibleTables, resolveTableAccess } from "./databaseAcl";
import { listPresence } from "./presence";
import { pushToUsers } from "./webPush";
import { publicAvatarUrl } from "./userAvatar";

/** 單則私訊長度上限（與專案留言一致） */
export const DM_MAX_BODY = 2000;

/** 對話串預覽的內文截斷長度 */
export const DM_SNIPPET_CHARS = 80;

/** 可被私訊「標注」的物件型別（與 schema.dmMessages.refType enum 同步） */
export const DM_REF_TYPES = ["project", "database", "schedule", "note"] as const;
export type DmRefType = (typeof DM_REF_TYPES)[number];

/** 標注卡的顯示標籤（前端渲染與對話串預覽共用） */
export const DM_REF_LABEL: Record<DmRefType, string> = { project: "專案", database: "資料庫", schedule: "排程", note: "筆記" };

/**
 * 純函式：算出對話串最後一句的預覽字。有內文＝截斷內文；只有附件／標注時給對應佔位字。
 * 附件與標注的私訊可能 body 為空——預覽不能空白，否則清單看起來像壞掉。
 */
export function dmThreadPreview(input: { body: string; hasAttachment: boolean; refType: string | null }): string {
  const flat = input.body.replace(/\s+/g, " ").trim();
  if (flat) return dmSnippet(input.body);
  if (input.hasAttachment) return "📎 附件";
  if (input.refType && input.refType in DM_REF_LABEL) return `🔗 ${DM_REF_LABEL[input.refType as DmRefType]}`;
  return "";
}

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
  avatarUrl: string | null;
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

  let candidates: Array<{ id: string; name: string; email: string; avatarUrl: string | null; isSuperAdmin: boolean }>;
  if (auth.user.isSuperAdmin) {
    // 開發者：全站啟用中帳號都可私訊
    candidates = await db
      .select({
        id: schema.users.id,
        name: schema.users.name,
        email: schema.users.email,
        avatarUrl: schema.users.avatarUrl,
        isSuperAdmin: schema.users.isSuperAdmin,
      })
      .from(schema.users)
      .where(eq(schema.users.status, "active"));
  } else {
    // 一般成員：同組夥伴＋開發者＋團隊管理員雙向（與 canDmPeer 一致——修 R5-DM-01：原本清單漏了團隊管理員，
    // 導致「收得到/回得了、卻無法主動發起」的半殘。補上（2）我所屬團隊的團隊管理員、（3）我管團隊底下的成員）。
    const extraIds = new Set<string>();
    const myTeamIds = [...new Set(auth.groups.map((g) => g.teamId))];
    if (myTeamIds.length) {
      const admins = await db
        .select({ userId: schema.teamMembers.userId })
        .from(schema.teamMembers)
        .where(and(eq(schema.teamMembers.role, "admin"), inArray(schema.teamMembers.teamId, myTeamIds)));
      for (const a of admins) if (a.userId !== auth.user.id) extraIds.add(a.userId);
    }
    if (auth.adminTeamIds.length) {
      const tmembers = await db
        .select({ userId: schema.teamMembers.userId })
        .from(schema.teamMembers)
        .where(inArray(schema.teamMembers.teamId, auth.adminTeamIds));
      for (const a of tmembers) if (a.userId !== auth.user.id) extraIds.add(a.userId);
      const groupsInMyTeams = await db
        .select({ id: schema.groups.id })
        .from(schema.groups)
        .where(inArray(schema.groups.teamId, auth.adminTeamIds));
      if (groupsInMyTeams.length) {
        const gmembers = await db
          .select({ userId: schema.groupMembers.userId })
          .from(schema.groupMembers)
          .where(inArray(schema.groupMembers.groupId, groupsInMyTeams.map((g) => g.id)));
        for (const a of gmembers) if (a.userId !== auth.user.id) extraIds.add(a.userId);
      }
    }
    const allowedIds = [...new Set([...sharedByUser.keys(), ...extraIds])];
    const conds = [eq(schema.users.isSuperAdmin, true)];
    if (allowedIds.length) conds.push(inArray(schema.users.id, allowedIds));
    candidates = await db
      .select({
        id: schema.users.id,
        name: schema.users.name,
        email: schema.users.email,
        avatarUrl: schema.users.avatarUrl,
        isSuperAdmin: schema.users.isSuperAdmin,
      })
      .from(schema.users)
      .where(and(eq(schema.users.status, "active"), or(...conds)));
  }

  return candidates
    .filter((u) => u.id !== auth.user.id)
    .map((u) => ({
      userId: u.id,
      name: u.name,
      email: u.email,
      avatarUrl: publicAvatarUrl(u.id, u.avatarUrl),
      isSuperAdmin: u.isSuperAdmin,
      sharedGroups: (sharedByUser.get(u.id) ?? []).sort((a, b) => a.localeCompare(b, "zh-Hant")),
    }))
    // 同組的排前面（最常聊），其次姓名——開發者若無共同組排在後段
    .sort((a, b) => (b.sharedGroups.length > 0 ? 1 : 0) - (a.sharedGroups.length > 0 ? 1 : 0) || a.name.localeCompare(b.name, "zh-Hant"));
}

export interface DmPeerPresence {
  userId: string;
  /** 顯示名——頂欄「誰在線」不必再打 peers 才能念得出名字 */
  name: string;
  /**
   * 最後活躍時刻——只有「剛離開窗」內才有值，更久以前一律 null（線上指示，不是行蹤紀錄）。
   * 只送時刻、不送判好的狀態字：三態由 shared/presence 在畫面上算，判定規則永遠只有一份。
   */
  lastActiveAt: Date | null;
}

/**
 * 可私訊對象的線上狀態（聊天頁與頂欄「誰在線」輪詢用）。
 *
 * 界＝listDmPeers 的同一份可訊界，不另寫一套判定：看得到誰在線上，等於看得到誰可以私訊，
 * 不會因為多了這個指示就把「他組有誰、誰在上班」外流給無關的人。
 * 回「全部可訊對象」而不是只回在線的人——前端才分得出「離線」與「不在可訊界（不顯示指示）」。
 * name 一併帶回：頂欄清單不必再為了顯示名打 peers。
 */
export async function listDmPresence(auth: AuthState, now: Date = new Date()): Promise<DmPeerPresence[]> {
  const peers = await listDmPeers(auth);
  const seen = await listPresence(peers.map((p) => p.userId), now);
  return peers.map((p) => ({
    userId: p.userId,
    name: p.name,
    lastActiveAt: seen.get(p.userId) ?? null,
  }));
}

/** 是否可與某對象互訊（不拋錯版；供歷史讀取的寬鬆界用） */
async function canDmPeer(auth: AuthState, peer: { id: string; isSuperAdmin: boolean }): Promise<boolean> {
  if (peer.id === auth.user.id) return false;
  if (auth.user.isSuperAdmin || peer.isSuperAdmin) return true;
  const myGroupIds = auth.groups.map((g) => g.groupId);
  // (1) 同組夥伴
  if (myGroupIds.length > 0) {
    const [row] = await db
      .select({ id: schema.groupMembers.id })
      .from(schema.groupMembers)
      .where(and(eq(schema.groupMembers.userId, peer.id), inArray(schema.groupMembers.groupId, myGroupIds)))
      .limit(1);
    if (row != null) return true;
  }
  // 修 R3-DM-01：團隊管理員常只在 team_members(role=admin)、未掛 group_members，舊版只查同組會讓組員收得到
  // 卻回不了團隊管理員的私訊（單向串）。補雙向可訊界：
  // (2) peer 是「我所屬團隊」的團隊管理員
  const myTeamIds = [...new Set(auth.groups.map((g) => g.teamId))];
  if (myTeamIds.length > 0) {
    const [peerAdmin] = await db
      .select({ id: schema.teamMembers.id })
      .from(schema.teamMembers)
      .where(and(eq(schema.teamMembers.userId, peer.id), eq(schema.teamMembers.role, "admin"), inArray(schema.teamMembers.teamId, myTeamIds)))
      .limit(1);
    if (peerAdmin != null) return true;
  }
  // (3) 我是「peer 所屬團隊」的團隊管理員（peer 的組所屬團隊，或 peer 直接掛在我管的團隊）
  if (auth.adminTeamIds.length > 0) {
    const [peerTeamDirect] = await db
      .select({ id: schema.teamMembers.id })
      .from(schema.teamMembers)
      .where(and(eq(schema.teamMembers.userId, peer.id), inArray(schema.teamMembers.teamId, auth.adminTeamIds)))
      .limit(1);
    if (peerTeamDirect != null) return true;
    const peerGroups = await db
      .select({ groupId: schema.groupMembers.groupId })
      .from(schema.groupMembers)
      .where(eq(schema.groupMembers.userId, peer.id));
    if (peerGroups.length > 0) {
      const [g] = await db
        .select({ id: schema.groups.id })
        .from(schema.groups)
        .where(and(inArray(schema.groups.id, peerGroups.map((r) => r.groupId)), inArray(schema.groups.teamId, auth.adminTeamIds)))
        .limit(1);
      if (g != null) return true;
    }
  }
  return false;
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

/**
 * 標注守衛：以「發訊者本人權限」驗證可存取被標注的物件，查無／不可存取一律拋錯。
 * 卡片只是指標——對方點擊時各目標頁自行做存取守衛，所以這裡只擋「發訊者標注自己看不到的東西」。
 */
export async function assertDmRef(auth: AuthState, refType: DmRefType, refId: string): Promise<void> {
  const myGroupIds = auth.groups.map((g) => g.groupId);
  const deny = () => new TRPCError({ code: "BAD_REQUEST", message: "找不到可標注的項目（只能標注你看得到的專案／資料庫／排程／筆記）" });
  if (refType === "project") {
    const [p] = await db.select({ groupId: schema.projects.groupId }).from(schema.projects).where(eq(schema.projects.id, refId));
    if (!p || !(auth.user.isSuperAdmin || myGroupIds.includes(p.groupId))) throw deny();
    return;
  }
  if (refType === "note") {
    const [n] = await db.select({ groupId: schema.notes.groupId }).from(schema.notes).where(eq(schema.notes.id, refId));
    if (!n || !(auth.user.isSuperAdmin || myGroupIds.includes(n.groupId))) throw deny();
    return;
  }
  if (refType === "schedule") {
    const [s] = await db.select({ groupId: schema.scheduleItems.groupId }).from(schema.scheduleItems).where(eq(schema.scheduleItems.id, refId));
    if (!s || !(auth.user.isSuperAdmin || myGroupIds.includes(s.groupId))) throw deny();
    return;
  }
  // database：四層範圍以 databaseAcl 判可讀（開發者也看不到別人的個人庫，與網頁一致）
  const [t] = await db.select().from(schema.dataTables).where(and(eq(schema.dataTables.id, refId), isNull(schema.dataTables.deletedAt)));
  if (!t || !resolveTableAccess(auth, t).canRead) throw deny();
}

/**
 * 附件守衛：附件必須存在、屬於本人、且尚未綁定其他訊息（一附件一訊息，擋盜用他人附件）。
 * 回傳附件列供 sendDm 綁定 messageId。
 */
export async function assertDmAttachment(auth: AuthState, attachmentId: string) {
  const [att] = await db.select().from(schema.dmAttachments).where(eq(schema.dmAttachments.id, attachmentId));
  if (!att || att.ownerId !== auth.user.id) throw new TRPCError({ code: "BAD_REQUEST", message: "找不到這個附件（或不是你上傳的）" });
  if (att.messageId) throw new TRPCError({ code: "BAD_REQUEST", message: "這個附件已附在其他訊息上" });
  return att;
}

export interface DmSendOptions {
  /** AI 代理回覆以此標記（'assistant'）；一般訊息省略＝'text' */
  kind?: "text" | "assistant";
  refType?: DmRefType;
  refId?: string;
  attachmentId?: string;
}

/**
 * 送出私訊（呼叫端先驗長度；這裡守對象界＋標注／附件歸屬）。
 * body 可為空，但「空 body 又無附件無標注」不成訊息（呼叫端與這裡雙擋）。
 */
export async function sendDm(auth: AuthState, peerId: string, body: string, opts: DmSendOptions = {}) {
  const peer = await assertDmPeer(auth, peerId);
  if (!!opts.refType !== !!opts.refId) throw new TRPCError({ code: "BAD_REQUEST", message: "標注參數不完整" });
  if (opts.refType && opts.refId) await assertDmRef(auth, opts.refType, opts.refId);
  const att = opts.attachmentId ? await assertDmAttachment(auth, opts.attachmentId) : null;
  if (!body.trim() && !att && !opts.refType) throw new TRPCError({ code: "BAD_REQUEST", message: "訊息不可為空" });

  const [msg] = await db
    .insert(schema.dmMessages)
    .values({
      senderId: auth.user.id,
      recipientId: peer.id,
      body,
      kind: opts.kind ?? "text",
      refType: opts.refType ?? null,
      refId: opts.refId ?? null,
      attachmentId: att?.id ?? null,
    })
    .returning();
  // 綁定附件到這則訊息（一附件一訊息；綁定後對方才讀得到檔案）
  if (att) await db.update(schema.dmAttachments).set({ messageId: msg.id }).where(eq(schema.dmAttachments.id, att.id));
  // 跨裝置推播給收件人（fire-and-forget）：內文帶預覽（純附件／標注訊息以佔位字，與對話串預覽同口徑）；
  // 同一發訊人以 tag 覆蓋舊通知，連發多句不洗版。點開直達聊天頁。
  void pushToUsers([peer.id], {
    title: `${auth.user.name} 傳來私訊`,
    body: dmThreadPreview({ body, hasAttachment: !!att, refType: opts.refType ?? null }),
    // 收件人點開應直達與「發訊者」的對話（peer＝發訊者本人）
    url: `/chat/${auth.user.id}`,
    tag: `dm-${auth.user.id}`,
  }).catch((err) => console.warn("[dm] 私訊推播失敗：", err instanceof Error ? err.message : err));
  return { message: msg, peer: { userId: peer.id, name: peer.name } };
}

/** 可被標注的物件清單（私訊「標注」picker 的資料源；集中在伺服器做存取範圍過濾） */
export interface DmMentionables {
  projects: Array<{ id: string; title: string }>;
  databases: Array<{ id: string; name: string }>;
  schedules: Array<{ id: string; title: string; startsAt: Date }>;
  notes: Array<{ id: string; title: string }>;
}

export async function listDmMentionables(auth: AuthState): Promise<DmMentionables> {
  const groupIds = auth.groups.map((g) => g.groupId);
  const [projects, tables, schedules, notes] = await Promise.all([
    groupIds.length
      ? db.select({ id: schema.projects.id, title: schema.projects.title })
          .from(schema.projects)
          .where(and(inArray(schema.projects.groupId, groupIds), sql`${schema.projects.status} <> 'archived'`))
          .orderBy(desc(schema.projects.updatedAt)).limit(50)
      : Promise.resolve([] as Array<{ id: string; title: string }>),
    listVisibleTablesLite(auth),
    groupIds.length
      ? db.select({ id: schema.scheduleItems.id, title: schema.scheduleItems.title, startsAt: schema.scheduleItems.startsAt })
          .from(schema.scheduleItems)
          .where(inArray(schema.scheduleItems.groupId, groupIds))
          .orderBy(desc(schema.scheduleItems.startsAt)).limit(50)
      : Promise.resolve([] as Array<{ id: string; title: string; startsAt: Date }>),
    groupIds.length
      ? db.select({ id: schema.notes.id, title: schema.notes.title })
          .from(schema.notes)
          .where(inArray(schema.notes.groupId, groupIds))
          .orderBy(desc(schema.notes.updatedAt)).limit(50)
      : Promise.resolve([] as Array<{ id: string; title: string }>),
  ]);
  return { projects, databases: tables, schedules, notes };
}

/** 資料庫清單（僅 id/name，供 picker）——沿用 databaseAcl 的四層可見範圍，避免與 listVisibleTables 邏輯分岔 */
async function listVisibleTablesLite(auth: AuthState): Promise<Array<{ id: string; name: string }>> {
  const tables = await listVisibleTables(auth);
  return tables.slice(0, 50).map((t) => ({ id: t.id, name: t.name }));
}

export interface DmRefInfo {
  refType: DmRefType;
  refId: string;
  title: string;
  /**
   * 前端導頁（必須是 App 實際存在的路徑）：
   * - project → `/p/:id`（不是 /project/…，後者沒有路由）
   * - database → `/databases?open=:id`
   * - schedule/note → `/planner?focus=schedule-:id` / `note-:id`（Planner 掛載時高亮該列）
   */
  route: string;
}

/** 純函式：依型別＋id 組出標注卡可點的前端路徑（單元測試鎖住，防路由又寫錯）。 */
export function dmRefRoute(refType: DmRefType, refId: string): string {
  if (refType === "project") return `/p/${refId}`;
  if (refType === "database") return `/databases?open=${encodeURIComponent(refId)}`;
  if (refType === "schedule") return `/planner?focus=${encodeURIComponent(`schedule-${refId}`)}`;
  return `/planner?focus=${encodeURIComponent(`note-${refId}`)}`;
}

/**
 * 批次解析標注卡的顯示標題（查不到＝已刪，回 title「已不存在」讓前端顯示灰卡）。
 * 標題對「收發雙方」都顯示——這是「標注／分享指標」的用意；能不能真的打開由目標頁自守。
 */
export async function resolveDmRefs(rows: Array<{ refType: string | null; refId: string | null }>): Promise<Map<string, DmRefInfo>> {
  const byType: Record<DmRefType, Set<string>> = { project: new Set(), database: new Set(), schedule: new Set(), note: new Set() };
  for (const r of rows) if (r.refType && r.refId && r.refType in byType) byType[r.refType as DmRefType].add(r.refId);
  const map = new Map<string, DmRefInfo>();
  const put = (type: DmRefType, id: string, title: string) =>
    map.set(`${type}:${id}`, { refType: type, refId: id, title, route: dmRefRoute(type, id) });
  if (byType.project.size) {
    const rowsP = await db.select({ id: schema.projects.id, title: schema.projects.title }).from(schema.projects).where(inArray(schema.projects.id, [...byType.project]));
    for (const p of rowsP) put("project", p.id, p.title);
  }
  if (byType.database.size) {
    const rowsD = await db.select({ id: schema.dataTables.id, name: schema.dataTables.name, deletedAt: schema.dataTables.deletedAt }).from(schema.dataTables).where(inArray(schema.dataTables.id, [...byType.database]));
    for (const d of rowsD) if (!d.deletedAt) put("database", d.id, d.name);
  }
  if (byType.schedule.size) {
    const rowsS = await db.select({ id: schema.scheduleItems.id, title: schema.scheduleItems.title, startsAt: schema.scheduleItems.startsAt }).from(schema.scheduleItems).where(inArray(schema.scheduleItems.id, [...byType.schedule]));
    for (const s of rowsS) {
      const when = new Date(s.startsAt).toLocaleDateString("zh-TW", { month: "numeric", day: "numeric" });
      put("schedule", s.id, `${s.title}（${when}）`);
    }
  }
  if (byType.note.size) {
    const rowsN = await db.select({ id: schema.notes.id, title: schema.notes.title }).from(schema.notes).where(inArray(schema.notes.id, [...byType.note]));
    for (const n of rowsN) put("note", n.id, n.title);
  }
  return map;
}

export interface DmAttachmentInfo {
  id: string;
  kind: string;
  title: string;
  mime: string;
  sizeBytes: number;
  /** 檔案服務網址（同源、需登入且為收發雙方之一） */
  url: string;
}

/** 批次解析附件顯示資訊（給歷史訊息渲染縮圖／播放器／下載連結） */
export async function resolveDmAttachments(ids: string[]): Promise<Map<string, DmAttachmentInfo>> {
  const uniq = [...new Set(ids)];
  if (!uniq.length) return new Map();
  const rows = await db.select().from(schema.dmAttachments).where(inArray(schema.dmAttachments.id, uniq));
  return new Map(rows.map((a) => [a.id, { id: a.id, kind: a.kind, title: a.title, mime: a.mime, sizeBytes: a.sizeBytes, url: `/api/dm/attachments/${a.id}/file` }]));
}

export interface DmThread {
  peerId: string;
  peerName: string;
  peerEmail: string;
  peerAvatarUrl: string | null;
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
  // 附件／標注訊息的 body 可能為空，一併帶出 last_attach／last_ref 以合成不空白的預覽字。
  const result = await db.execute<{ peer: string; last_at: string; last_body: string; last_sender: string; last_attach: string | null; last_ref: string | null }>(sql`
    with mine as (
      select case when ${schema.dmMessages.senderId} = ${me} then ${schema.dmMessages.recipientId} else ${schema.dmMessages.senderId} end as peer,
             ${schema.dmMessages.body} as body, ${schema.dmMessages.senderId} as sender_id, ${schema.dmMessages.createdAt} as created_at,
             ${schema.dmMessages.attachmentId} as attachment_id, ${schema.dmMessages.refType} as ref_type
      from ${schema.dmMessages}
      where ${or(eq(schema.dmMessages.senderId, me), eq(schema.dmMessages.recipientId, me))}
    )
    select peer,
           max(created_at)::text as last_at,
           (array_agg(body order by created_at desc))[1] as last_body,
           (array_agg(sender_id order by created_at desc))[1] as last_sender,
           (array_agg(attachment_id order by created_at desc))[1] as last_attach,
           (array_agg(ref_type order by created_at desc))[1] as last_ref
    from mine
    group by peer
  `);
  const rows = result.rows.map((r) => ({
    peerId: r.peer,
    lastAt: r.last_at,
    lastBody: dmThreadPreview({ body: r.last_body, hasAttachment: !!r.last_attach, refType: r.last_ref }),
    lastFromMe: r.last_sender === me,
  }));
  if (rows.length === 0) return [];

  const [users, unread] = await Promise.all([
    db
      .select({ id: schema.users.id, name: schema.users.name, email: schema.users.email, avatarUrl: schema.users.avatarUrl })
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
        peerAvatarUrl: u ? publicAvatarUrl(u.id, u.avatarUrl) : null,
        lastBody: r.lastBody, // 已在 rows 映射時經 dmThreadPreview（含截斷／附件標注佔位）
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
  /** 'text'＝一般、'assistant'＝AI 代理回覆（前端渲染成 AI 氣泡） */
  kind: string;
  ref: DmRefInfo | null;
  attachment: DmAttachmentInfo | null;
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
): Promise<{ peer: { userId: string; name: string; email: string; avatarUrl: string | null }; items: DmHistoryItem[]; hasMore: boolean }> {
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
  // 批次解析這一頁的標注卡與附件（各一次查詢，無 N+1）
  const [refMap, attMap] = await Promise.all([
    resolveDmRefs(page),
    resolveDmAttachments(page.map((m) => m.attachmentId).filter((v): v is string => !!v)),
  ]);
  return {
    peer: { userId: peer.id, name: peer.name, email: peer.email, avatarUrl: publicAvatarUrl(peer.id, peer.avatarUrl) },
    items: page.map((m) => ({
      id: m.id,
      fromMe: m.senderId === me,
      body: m.body,
      kind: m.kind,
      ref: m.refType && m.refId ? (refMap.get(`${m.refType}:${m.refId}`) ?? { refType: m.refType as DmRefType, refId: m.refId, title: "已不存在", route: "" }) : null,
      attachment: m.attachmentId ? (attMap.get(m.attachmentId) ?? null) : null,
      createdAt: m.createdAt,
    })),
    hasMore,
  };
}

/** 已讀水位上報（與 messages.markRead 同語意的 upsert；高頻、無安全意義，審計豁免見 trpc.ts） */
export async function markDmRead(auth: AuthState, peerId: string): Promise<void> {
  // 修 R2-CONC-01/R2-02：原「update→0 則 insert」在併發首次標記下兩者都讀到 0、雙雙 insert，
  // 產生同 (user,peer) 重複已讀列；unreadBySender 的 LEFT JOIN 對重複列扇出，未讀數被永久成倍放大。
  // 依賴 dm_reads(user_id,peer_id) 唯一索引（ensure.ts 手寫遷移）＋ onConflictDoUpdate 原子 upsert 根治。
  await db
    .insert(schema.dmReads)
    .values({ userId: auth.user.id, peerId, lastReadAt: new Date() })
    .onConflictDoUpdate({
      target: [schema.dmReads.userId, schema.dmReads.peerId],
      set: { lastReadAt: new Date() },
    });
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
