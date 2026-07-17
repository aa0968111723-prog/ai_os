import { z } from "zod";
import { and, desc, eq, gt, inArray, ne, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure } from "../trpc";
import { db, schema } from "../db";
import type { AuthState } from "../services/auth";

/**
 * 站內私訊／群組對話（通訊錄協作）。
 * 有別於 messages（掛專案的討論串）：這裡是「人與人」的私訊與臨時群組，從通訊錄發起，
 * 隊友（同團隊者）皆可用——不限組長/管理員，這才是「每個人的通訊錄」。可選關聯專案作為討論脈絡。
 *
 * 隔離兩層：
 *  1) 能不能把某人拉進對話 → 必須與我「共團隊」（sharesTeam）；對話 team_id 圈定成員池。
 *  2) 能不能讀/寫某條對話 → 必須是這條對話的成員（連開發者也不自動看得到別人私訊，隱私優先）。
 * 訊息走輪詢（與 messages 一致；前端 8 秒刷新）。
 */

const MAX_BODY = 2000;
const MAX_TITLE = 80;
const MAX_GROUP_MEMBERS = 50;

/* ── 純函式（可單元測試，不碰 DB）─────────────────── */

/** dm 配對鍵：兩人 id 排序後 "loId:hiId"，保證與順序無關、一對人唯一。自己找自己＝非法。 */
export function dmKeyFor(a: string, b: string): string {
  if (a === b) throw new TRPCError({ code: "BAD_REQUEST", message: "不能和自己開私訊" });
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

/** 我所屬的團隊（去重）——由 auth.groups 現成展開，不必再查 DB。 */
export function myTeams(auth: AuthState): Array<{ teamId: string; teamName: string }> {
  const map = new Map<string, string>();
  for (const g of auth.groups) map.set(g.teamId, g.teamName);
  return [...map].map(([teamId, teamName]) => ({ teamId, teamName }));
}

/** 我在不在某團隊（能不能以此團隊為界發起對話）。 */
export function inTeam(auth: AuthState, teamId: string): boolean {
  return auth.groups.some((g) => g.teamId === teamId);
}

/** 群組標題正規化：修剪空白；空字串在呼叫端擋（zod min(1)）。 */
export function normalizeTitle(raw: string): string {
  return raw.trim();
}

/* ── 資料存取小工具 ─────────────────────────────── */

/** 與我共團隊的隊友 userId 集合（通訊錄可邀對象）。scopeTeamId 給定則只看該團隊。 */
async function teammateIds(auth: AuthState, scopeTeamId?: string): Promise<Set<string>> {
  const teamIds = scopeTeamId ? [scopeTeamId] : myTeams(auth).map((t) => t.teamId);
  if (teamIds.length === 0) return new Set();
  // 團隊成員 = 該團隊各組的組員（groups→group_members）∪ 團隊層成員（team_members）
  const [viaGroups, viaTeam] = await Promise.all([
    db
      .select({ userId: schema.groupMembers.userId })
      .from(schema.groupMembers)
      .leftJoin(schema.groups, eq(schema.groups.id, schema.groupMembers.groupId))
      .where(inArray(schema.groups.teamId, teamIds)),
    db
      .select({ userId: schema.teamMembers.userId })
      .from(schema.teamMembers)
      .where(inArray(schema.teamMembers.teamId, teamIds)),
  ]);
  const ids = new Set<string>();
  for (const r of viaGroups) ids.add(r.userId);
  for (const r of viaTeam) ids.add(r.userId);
  return ids;
}

/** 載入對話並確認我是成員；回傳對話列與我的成員列。非成員一律 NOT_FOUND（不洩漏對話存在）。 */
async function loadConversationAsMember(userId: string, conversationId: string) {
  const [conv] = await db.select().from(schema.conversations).where(eq(schema.conversations.id, conversationId));
  if (!conv) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這則對話" });
  const [me] = await db
    .select()
    .from(schema.conversationMembers)
    .where(and(eq(schema.conversationMembers.conversationId, conversationId), eq(schema.conversationMembers.userId, userId)));
  if (!me) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這則對話" });
  return { conv, me };
}

/** @提及校驗：只能提及本對話成員（與 messages 的「只能提及同組」同精神，範圍改成對話成員）。 */
async function validateConvMentions(conversationId: string, mentions: string[] | undefined): Promise<string[] | undefined> {
  if (!mentions?.length) return undefined;
  const members = await db
    .select({ userId: schema.conversationMembers.userId })
    .from(schema.conversationMembers)
    .where(eq(schema.conversationMembers.conversationId, conversationId));
  const ids = new Set(members.map((m) => m.userId));
  for (const uid of mentions) {
    if (!ids.has(uid)) throw new TRPCError({ code: "BAD_REQUEST", message: "只能提及對話裡的成員" });
  }
  return [...new Set(mentions)];
}

/** 確認我看得到某專案（同組或開發者）——關聯專案討論時擋跨組窺探。回傳專案名。 */
async function assertProjectVisible(auth: AuthState, projectId: string): Promise<string> {
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
  if (!project) throw new TRPCError({ code: "BAD_REQUEST", message: "找不到要關聯的專案" });
  if (!auth.user.isSuperAdmin && !auth.groups.some((g) => g.groupId === project.groupId)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "你看不到這個專案，不能關聯" });
  }
  return project.title;
}

type ContactRow = { userId: string; name: string; email: string; isSuperAdmin: boolean };

export const messagingRouter = router({
  /** 我所屬的團隊（通訊錄／新對話的團隊選擇器；多團隊時前端才顯示切換）。 */
  teams: authedProcedure.query(({ ctx }) => {
    const teams = myTeams(ctx.auth);
    teams.sort((a, b) => a.teamName.localeCompare(b.teamName, "zh-Hant"));
    return { teams };
  }),

  /** 通訊錄：與我共團隊的隊友（可私訊/可拉進群組的人）。人人可用（含純組員）。 */
  contacts: authedProcedure
    .input(z.object({ teamId: z.string().uuid().optional(), q: z.string().max(80).optional() }).optional())
    .query(async ({ ctx, input }) => {
      if (input?.teamId && !inTeam(ctx.auth, input.teamId)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "你不屬於這個團隊" });
      }
      const ids = await teammateIds(ctx.auth, input?.teamId);
      ids.delete(ctx.auth.user.id); // 通訊錄不列自己
      if (ids.size === 0) return { contacts: [] as ContactRow[] };
      const users = await db
        .select({ id: schema.users.id, name: schema.users.name, email: schema.users.email, isSuperAdmin: schema.users.isSuperAdmin, status: schema.users.status })
        .from(schema.users)
        .where(inArray(schema.users.id, [...ids]));
      let contacts: ContactRow[] = users
        .filter((u) => u.status !== "disabled") // 停用帳號不列入可私訊對象
        .map((u) => ({ userId: u.id, name: u.name, email: u.email, isSuperAdmin: u.isSuperAdmin }));
      const q = input?.q?.trim().toLowerCase();
      if (q) contacts = contacts.filter((c) => c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q));
      contacts.sort((a, b) => a.name.localeCompare(b.name, "zh-Hant"));
      return { contacts };
    }),

  /** 我的對話清單：私訊＋群組，依最後訊息時間排序，帶對方名/成員、最後一則摘要、未讀數。 */
  list: authedProcedure.query(async ({ ctx }) => {
    const me = ctx.auth.user.id;
    const mine = await db
      .select({ conversationId: schema.conversationMembers.conversationId, lastReadAt: schema.conversationMembers.lastReadAt })
      .from(schema.conversationMembers)
      .where(eq(schema.conversationMembers.userId, me));
    const convIds = mine.map((m) => m.conversationId);
    if (convIds.length === 0) return { conversations: [] as ConversationSummary[] };

    const [convs, members, lastMsgs, unreadRows] = await Promise.all([
      db.select().from(schema.conversations).where(inArray(schema.conversations.id, convIds)),
      // 所有成員（顯示對方名字／群組成員數）——一次撈，前端不再逐對話查
      db
        .select({ conversationId: schema.conversationMembers.conversationId, userId: schema.conversationMembers.userId, name: schema.users.name })
        .from(schema.conversationMembers)
        .leftJoin(schema.users, eq(schema.users.id, schema.conversationMembers.userId))
        .where(inArray(schema.conversationMembers.conversationId, convIds)),
      // 每對話最後一則（distinct on）
      db
        .selectDistinctOn([schema.conversationMessages.conversationId], {
          conversationId: schema.conversationMessages.conversationId,
          body: schema.conversationMessages.body,
          userId: schema.conversationMessages.userId,
          createdAt: schema.conversationMessages.createdAt,
        })
        .from(schema.conversationMessages)
        .where(inArray(schema.conversationMessages.conversationId, convIds))
        .orderBy(schema.conversationMessages.conversationId, desc(schema.conversationMessages.createdAt)),
      // 未讀：他人在我「已讀水位之後」發的訊息數——join 我的成員列取各對話的 lastReadAt
      db
        .select({ conversationId: schema.conversationMessages.conversationId, n: sql<number>`count(*)::int` })
        .from(schema.conversationMessages)
        .innerJoin(
          schema.conversationMembers,
          and(
            eq(schema.conversationMembers.conversationId, schema.conversationMessages.conversationId),
            eq(schema.conversationMembers.userId, me),
          ),
        )
        .where(
          and(
            inArray(schema.conversationMessages.conversationId, convIds),
            ne(schema.conversationMessages.userId, me),
            gt(schema.conversationMessages.createdAt, schema.conversationMembers.lastReadAt),
          ),
        )
        .groupBy(schema.conversationMessages.conversationId),
    ]);

    const membersByConv = new Map<string, Array<{ userId: string; name: string }>>();
    for (const m of members) {
      const list = membersByConv.get(m.conversationId) ?? [];
      list.push({ userId: m.userId, name: m.name ?? "?" });
      membersByConv.set(m.conversationId, list);
    }
    const lastByConv = new Map(lastMsgs.map((l) => [l.conversationId, l]));
    const unreadByConv = new Map(unreadRows.map((u) => [u.conversationId, u.n]));
    // 專案名（關聯專案討論時顯示標籤）
    const projectIds = [...new Set(convs.map((c) => c.projectId).filter((v): v is string => !!v))];
    const projectNames = new Map<string, string>();
    if (projectIds.length) {
      const rows = await db.select({ id: schema.projects.id, name: schema.projects.title }).from(schema.projects).where(inArray(schema.projects.id, projectIds));
      for (const r of rows) projectNames.set(r.id, r.name);
    }

    const summaries: ConversationSummary[] = convs.map((c) => {
      const others = (membersByConv.get(c.id) ?? []).filter((m) => m.userId !== me);
      const last = lastByConv.get(c.id);
      return {
        id: c.id,
        kind: c.kind as "dm" | "group",
        title: c.kind === "group" ? (c.title ?? "群組對話") : (others[0]?.name ?? "（對方已不在）"),
        memberCount: (membersByConv.get(c.id) ?? []).length,
        otherNames: others.map((o) => o.name),
        projectId: c.projectId,
        projectName: c.projectId ? (projectNames.get(c.projectId) ?? null) : null,
        lastBody: last?.body.slice(0, 60) ?? null,
        lastAt: last?.createdAt ?? c.lastMessageAt,
        unread: unreadByConv.get(c.id) ?? 0,
      };
    });
    summaries.sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime());
    return { conversations: summaries };
  }),

  /** 未讀總數（頂欄徽章）：跨所有對話的未讀訊息總數＋有未讀的對話數。 */
  unreadTotal: authedProcedure.query(async ({ ctx }) => {
    const me = ctx.auth.user.id;
    const [row] = await db
      .select({
        total: sql<number>`coalesce(sum(1), 0)::int`,
        convs: sql<number>`count(distinct ${schema.conversationMessages.conversationId})::int`,
      })
      .from(schema.conversationMessages)
      .innerJoin(
        schema.conversationMembers,
        and(
          eq(schema.conversationMembers.conversationId, schema.conversationMessages.conversationId),
          eq(schema.conversationMembers.userId, me),
        ),
      )
      .where(
        and(
          ne(schema.conversationMessages.userId, me),
          gt(schema.conversationMessages.createdAt, schema.conversationMembers.lastReadAt),
        ),
      );
    return { total: Number(row?.total ?? 0), conversations: Number(row?.convs ?? 0) };
  }),

  /** 開私訊：找得到既有就回，否則建立。回 conversationId。目標須與我共團隊。 */
  openDm: authedProcedure.input(z.object({ userId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const me = ctx.auth.user.id;
    const key = dmKeyFor(me, input.userId); // 自己找自己在此擋
    // 目標必須與我共團隊（否則不能私訊陌生人）——挑一個共同團隊當對話 team_id
    const myTeamIds = new Set(myTeams(ctx.auth).map((t) => t.teamId));
    let sharedTeam: string | null = null;
    for (const teamId of myTeamIds) {
      const mates = await teammateIds(ctx.auth, teamId);
      if (mates.has(input.userId)) {
        sharedTeam = teamId;
        break;
      }
    }
    if (!sharedTeam) throw new TRPCError({ code: "FORBIDDEN", message: "只能私訊同團隊的夥伴" });

    const existing = await db.select({ id: schema.conversations.id }).from(schema.conversations).where(eq(schema.conversations.dmKey, key));
    if (existing[0]) return { conversationId: existing[0].id };

    try {
      const [conv] = await db
        .insert(schema.conversations)
        .values({ kind: "dm", dmKey: key, teamId: sharedTeam, createdBy: me })
        .returning();
      await db.insert(schema.conversationMembers).values([
        { conversationId: conv.id, userId: me },
        { conversationId: conv.id, userId: input.userId },
      ]);
      return { conversationId: conv.id };
    } catch (err) {
      // 併發：另一請求先建了同 dmKey（唯一索引 23505）——改讀既有那條
      const again = await db.select({ id: schema.conversations.id }).from(schema.conversations).where(eq(schema.conversations.dmKey, key));
      if (again[0]) return { conversationId: again[0].id };
      throw err;
    }
  }),

  /** 建群組：標題＋成員（都須與我共團隊）＋可選關聯專案。我自動成為成員。 */
  createGroup: authedProcedure
    .input(
      z.object({
        title: z.string().min(1, "請填群組名稱").max(MAX_TITLE),
        teamId: z.string().uuid(),
        memberIds: z.array(z.string().uuid()).max(MAX_GROUP_MEMBERS),
        projectId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const me = ctx.auth.user.id;
      if (!inTeam(ctx.auth, input.teamId)) throw new TRPCError({ code: "FORBIDDEN", message: "你不屬於這個團隊" });
      const mates = await teammateIds(ctx.auth, input.teamId);
      const invited = [...new Set(input.memberIds)].filter((id) => id !== me);
      for (const id of invited) {
        if (!mates.has(id)) throw new TRPCError({ code: "BAD_REQUEST", message: "只能邀請同團隊的夥伴" });
      }
      if (invited.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "群組至少要再邀一位夥伴" });
      if (input.projectId) await assertProjectVisible(ctx.auth, input.projectId);

      const [conv] = await db
        .insert(schema.conversations)
        .values({ kind: "group", title: normalizeTitle(input.title), teamId: input.teamId, projectId: input.projectId ?? null, createdBy: me })
        .returning();
      await db
        .insert(schema.conversationMembers)
        .values([me, ...invited].map((userId) => ({ conversationId: conv.id, userId })));
      return { conversationId: conv.id };
    }),

  /** 對話內容：對話 meta（含成員、關聯專案）＋訊息（最近 100 則，時間升冪）。須為成員。 */
  thread: authedProcedure.input(z.object({ conversationId: z.string().uuid() })).query(async ({ ctx, input }) => {
    const { conv } = await loadConversationAsMember(ctx.auth.user.id, input.conversationId);
    const members = await db
      .select({ userId: schema.conversationMembers.userId, name: schema.users.name })
      .from(schema.conversationMembers)
      .leftJoin(schema.users, eq(schema.users.id, schema.conversationMembers.userId))
      .where(eq(schema.conversationMembers.conversationId, conv.id));
    const rows = await db
      .select({
        id: schema.conversationMessages.id,
        body: schema.conversationMessages.body,
        userId: schema.conversationMessages.userId,
        userName: schema.users.name,
        mentions: schema.conversationMessages.mentions,
        createdAt: schema.conversationMessages.createdAt,
      })
      .from(schema.conversationMessages)
      .leftJoin(schema.users, eq(schema.users.id, schema.conversationMessages.userId))
      .where(eq(schema.conversationMessages.conversationId, conv.id))
      .orderBy(desc(schema.conversationMessages.createdAt))
      .limit(100);
    const projectName = conv.projectId ? await db.select({ name: schema.projects.title }).from(schema.projects).where(eq(schema.projects.id, conv.projectId)).then((r) => r[0]?.name ?? null) : null;
    const others = members.filter((m) => m.userId !== ctx.auth.user.id);
    return {
      conversation: {
        id: conv.id,
        kind: conv.kind as "dm" | "group",
        title: conv.kind === "group" ? (conv.title ?? "群組對話") : (others[0]?.name ?? "（對方已不在）"),
        createdBy: conv.createdBy,
        projectId: conv.projectId,
        projectName,
        members: members.map((m) => ({ userId: m.userId, name: m.name ?? "?" })),
      },
      messages: rows.reverse().map((r) => ({ ...r, userName: r.userName ?? "?" })),
    };
  }),

  /** 送訊：須為成員；觸碰 lastMessageAt。mentions 只能提及本對話成員。 */
  send: authedProcedure
    .input(z.object({ conversationId: z.string().uuid(), body: z.string().min(1).max(MAX_BODY), mentions: z.array(z.string().uuid()).max(MAX_GROUP_MEMBERS).optional() }))
    .mutation(async ({ ctx, input }) => {
      const { conv } = await loadConversationAsMember(ctx.auth.user.id, input.conversationId);
      const mentions = await validateConvMentions(conv.id, input.mentions);
      const [msg] = await db
        .insert(schema.conversationMessages)
        .values({ conversationId: conv.id, userId: ctx.auth.user.id, body: input.body, mentions: mentions ?? null })
        .returning();
      await db.update(schema.conversations).set({ lastMessageAt: new Date() }).where(eq(schema.conversations.id, conv.id));
      // 送訊當下自己也算已讀（否則自己發的會計進未讀計算的邊界）
      await db
        .update(schema.conversationMembers)
        .set({ lastReadAt: new Date() })
        .where(and(eq(schema.conversationMembers.conversationId, conv.id), eq(schema.conversationMembers.userId, ctx.auth.user.id)));
      return msg;
    }),

  /** 已讀水位：打開對話時上報（審計豁免，見 trpc.ts AUDIT_EXEMPT）。 */
  markRead: authedProcedure.input(z.object({ conversationId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    await loadConversationAsMember(ctx.auth.user.id, input.conversationId);
    await db
      .update(schema.conversationMembers)
      .set({ lastReadAt: new Date() })
      .where(and(eq(schema.conversationMembers.conversationId, input.conversationId), eq(schema.conversationMembers.userId, ctx.auth.user.id)));
    return { ok: true };
  }),

  /** 加人（群組）：新成員須與我共團隊。已在群組者靜默略過。 */
  addMembers: authedProcedure
    .input(z.object({ conversationId: z.string().uuid(), userIds: z.array(z.string().uuid()).min(1).max(MAX_GROUP_MEMBERS) }))
    .mutation(async ({ ctx, input }) => {
      const { conv } = await loadConversationAsMember(ctx.auth.user.id, input.conversationId);
      if (conv.kind !== "group") throw new TRPCError({ code: "BAD_REQUEST", message: "私訊不能加人（請改開群組）" });
      const mates = await teammateIds(ctx.auth, conv.teamId);
      const existing = new Set(
        (await db.select({ userId: schema.conversationMembers.userId }).from(schema.conversationMembers).where(eq(schema.conversationMembers.conversationId, conv.id))).map((m) => m.userId),
      );
      const toAdd: string[] = [];
      for (const id of new Set(input.userIds)) {
        if (existing.has(id)) continue;
        if (!mates.has(id)) throw new TRPCError({ code: "BAD_REQUEST", message: "只能加入同團隊的夥伴" });
        toAdd.push(id);
      }
      if (toAdd.length) {
        await db.insert(schema.conversationMembers).values(toAdd.map((userId) => ({ conversationId: conv.id, userId }))).onConflictDoNothing();
      }
      return { added: toAdd.length };
    }),

  /** 改群組名（成員皆可，內部工具從簡）。 */
  rename: authedProcedure
    .input(z.object({ conversationId: z.string().uuid(), title: z.string().min(1).max(MAX_TITLE) }))
    .mutation(async ({ ctx, input }) => {
      const { conv } = await loadConversationAsMember(ctx.auth.user.id, input.conversationId);
      if (conv.kind !== "group") throw new TRPCError({ code: "BAD_REQUEST", message: "私訊沒有群組名稱" });
      await db.update(schema.conversations).set({ title: normalizeTitle(input.title) }).where(eq(schema.conversations.id, conv.id));
      return { ok: true };
    }),

  /** 離開群組：移除我的成員列；群組空了就連訊息一起刪（不留孤兒）。私訊不可離開。 */
  leave: authedProcedure.input(z.object({ conversationId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const { conv } = await loadConversationAsMember(ctx.auth.user.id, input.conversationId);
    if (conv.kind !== "group") throw new TRPCError({ code: "BAD_REQUEST", message: "私訊不能離開（沒訊息就會自然沉底）" });
    await db
      .delete(schema.conversationMembers)
      .where(and(eq(schema.conversationMembers.conversationId, conv.id), eq(schema.conversationMembers.userId, ctx.auth.user.id)));
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.conversationMembers).where(eq(schema.conversationMembers.conversationId, conv.id));
    if (Number(n) === 0) {
      await db.delete(schema.conversationMessages).where(eq(schema.conversationMessages.conversationId, conv.id));
      await db.delete(schema.conversations).where(eq(schema.conversations.id, conv.id));
    }
    return { ok: true };
  }),
});

type ConversationSummary = {
  id: string;
  kind: "dm" | "group";
  title: string;
  memberCount: number;
  otherNames: string[];
  projectId: string | null;
  projectName: string | null;
  lastBody: string | null;
  lastAt: Date | string;
  unread: number;
};
