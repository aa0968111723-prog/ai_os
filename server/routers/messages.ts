import { z } from "zod";
import { and, desc, eq, gt, inArray, ne, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure, requireGroup, requireLeader } from "../trpc";
import { db, schema } from "../db";

/**
 * 站內留言（協作強化版）。隔離：以專案的 group 為準；檢視者(viewer)也能留言——
 * 留言是唯讀者唯一的參與出口，刻意不掛 assertProjectEditable。
 * 新增：回覆串(replyToId)、組長釘選(pinned)、引用專案內作品(refType/refId → 縮圖卡)、
 * @提及(mentions)、表情回應(message_reactions)、未讀水位(message_reads)。
 */

/** 表情白名單：符合弘法團隊語境的最小集合，順序即顯示順序 */
export const REACTION_EMOJI = ["🙏", "❤️", "✅", "😊"] as const;

async function loadProject(projectId: string) {
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
  if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "找不到專案" });
  return project;
}

async function loadMessage(messageId: string) {
  const [msg] = await db.select().from(schema.messages).where(eq(schema.messages.id, messageId));
  if (!msg) throw new TRPCError({ code: "NOT_FOUND", message: "找不到留言" });
  return msg;
}

/** 解析引用作品的顯示資訊（標題+縮圖）；查不到（已刪等）回 null，前端顯示「已不存在」 */
async function resolveRefs(rows: Array<{ refType: string | null; refId: string | null }>) {
  const byType = { scene: new Set<string>(), asset: new Set<string>(), generation: new Set<string>() };
  for (const r of rows) {
    if (r.refType && r.refId && r.refType in byType) byType[r.refType as keyof typeof byType].add(r.refId);
  }
  const map = new Map<string, { title: string; thumb: string | null; kind: string }>();
  if (byType.scene.size) {
    const scenes = await db.select({ id: schema.scenes.id, title: schema.scenes.title, deletedAt: schema.scenes.deletedAt })
      .from(schema.scenes).where(inArray(schema.scenes.id, [...byType.scene]));
    for (const s of scenes) if (!s.deletedAt) map.set(`scene:${s.id}`, { title: s.title, thumb: null, kind: "scene" });
  }
  if (byType.asset.size) {
    const assets = await db.select({ id: schema.assets.id, title: schema.assets.title, url: schema.assets.url, kind: schema.assets.kind, deletedAt: schema.assets.deletedAt })
      .from(schema.assets).where(inArray(schema.assets.id, [...byType.asset]));
    for (const a of assets) if (!a.deletedAt) map.set(`asset:${a.id}`, { title: a.title, thumb: a.kind === "image" ? a.url : null, kind: a.kind });
  }
  if (byType.generation.size) {
    const gens = await db.select({ id: schema.generations.id, name: schema.generations.name, prompt: schema.generations.prompt, kind: schema.generations.kind, resultUrl: schema.generations.resultUrl })
      .from(schema.generations).where(inArray(schema.generations.id, [...byType.generation]));
    for (const g of gens) {
      map.set(`generation:${g.id}`, {
        title: g.name || g.prompt.slice(0, 40),
        thumb: g.kind === "image" && g.resultUrl ? g.resultUrl : null,
        kind: g.kind,
      });
    }
  }
  return map;
}

export const messagesRouter = router({
  list: authedProcedure.input(z.object({ projectId: z.string().uuid() })).query(async ({ ctx, input }) => {
    const project = await loadProject(input.projectId);
    requireGroup(ctx.auth, project.groupId);
    const rows = await db
      .select({
        id: schema.messages.id,
        body: schema.messages.body,
        kind: schema.messages.kind,
        userId: schema.messages.userId,
        userName: schema.users.name,
        replyToId: schema.messages.replyToId,
        pinned: schema.messages.pinned,
        refType: schema.messages.refType,
        refId: schema.messages.refId,
        mentions: schema.messages.mentions,
        createdAt: schema.messages.createdAt,
      })
      .from(schema.messages)
      .leftJoin(schema.users, eq(schema.messages.userId, schema.users.id))
      .where(and(eq(schema.messages.groupId, project.groupId), eq(schema.messages.projectId, input.projectId)))
      .orderBy(desc(schema.messages.createdAt))
      .limit(50);
    const ordered = rows.reverse();
    const ids = ordered.map((r) => r.id);

    // 回覆串：被引用留言的「誰說的+前 60 字」摘要（50 筆窗外的舊留言也查得到）
    const replyIds = [...new Set(ordered.map((r) => r.replyToId).filter((v): v is string => !!v))];
    const replyMap = new Map<string, { userName: string | null; snippet: string }>();
    if (replyIds.length) {
      const parents = await db
        .select({ id: schema.messages.id, body: schema.messages.body, userName: schema.users.name })
        .from(schema.messages)
        .leftJoin(schema.users, eq(schema.messages.userId, schema.users.id))
        .where(inArray(schema.messages.id, replyIds));
      for (const p of parents) replyMap.set(p.id, { userName: p.userName, snippet: p.body.slice(0, 60) });
    }

    // 表情回應彙總：每則 × 每表情 → 數量+我按過沒
    const reactionMap = new Map<string, Array<{ emoji: string; count: number; mine: boolean }>>();
    if (ids.length) {
      const reactions = await db
        .select({ messageId: schema.messageReactions.messageId, emoji: schema.messageReactions.emoji, userId: schema.messageReactions.userId })
        .from(schema.messageReactions)
        .where(inArray(schema.messageReactions.messageId, ids));
      for (const r of reactions) {
        const list = reactionMap.get(r.messageId) ?? [];
        let cell = list.find((x) => x.emoji === r.emoji);
        if (!cell) {
          cell = { emoji: r.emoji, count: 0, mine: false };
          list.push(cell);
        }
        cell.count += 1;
        if (r.userId === ctx.auth.user.id) cell.mine = true;
        reactionMap.set(r.messageId, list);
      }
      for (const list of reactionMap.values()) {
        list.sort((a, b) => REACTION_EMOJI.indexOf(a.emoji as (typeof REACTION_EMOJI)[number]) - REACTION_EMOJI.indexOf(b.emoji as (typeof REACTION_EMOJI)[number]));
      }
    }

    const refMap = await resolveRefs(ordered);
    return ordered.map((r) => ({
      ...r,
      replyTo: r.replyToId ? (replyMap.get(r.replyToId) ?? null) : null,
      reactions: reactionMap.get(r.id) ?? [],
      ref: r.refType && r.refId ? (refMap.get(`${r.refType}:${r.refId}`) ?? null) : null,
    }));
  }),

  post: authedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        body: z.string().min(1).max(2000),
        replyToId: z.string().uuid().optional(),
        refType: z.enum(["scene", "asset", "generation"]).optional(),
        refId: z.string().uuid().optional(),
        mentions: z.array(z.string().uuid()).max(20).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const project = await loadProject(input.projectId);
      requireGroup(ctx.auth, project.groupId);
      // 回覆對象必須是同專案留言（擋跨專案/跨組引用）
      if (input.replyToId) {
        const parent = await loadMessage(input.replyToId);
        if (parent.projectId !== input.projectId) throw new TRPCError({ code: "BAD_REQUEST", message: "只能回覆本專案的留言" });
      }
      // 引用作品：refType/refId 成對，且必須屬於本專案（擋跨專案窺探）
      if (!!input.refType !== !!input.refId) throw new TRPCError({ code: "BAD_REQUEST", message: "引用參數不完整" });
      if (input.refType && input.refId) {
        const ok =
          input.refType === "scene"
            ? (await db.select({ id: schema.scenes.id }).from(schema.scenes).where(and(eq(schema.scenes.id, input.refId), eq(schema.scenes.projectId, input.projectId)))).length > 0
            : input.refType === "asset"
              ? (await db.select({ id: schema.assets.id }).from(schema.assets).where(and(eq(schema.assets.id, input.refId), eq(schema.assets.projectId, input.projectId)))).length > 0
              : (await db.select({ id: schema.generations.id }).from(schema.generations).where(and(eq(schema.generations.id, input.refId), eq(schema.generations.projectId, input.projectId)))).length > 0;
        if (!ok) throw new TRPCError({ code: "BAD_REQUEST", message: "引用的作品不在本專案" });
      }
      // @提及：只能提及同組成員（名單外的 id 一律拒絕，不靜默過濾——壞輸入要看得見）
      let mentions: string[] | undefined;
      if (input.mentions?.length) {
        const members = await db
          .select({ userId: schema.groupMembers.userId })
          .from(schema.groupMembers)
          .where(eq(schema.groupMembers.groupId, project.groupId));
        const memberIds = new Set(members.map((m) => m.userId));
        for (const uid of input.mentions) {
          if (!memberIds.has(uid)) throw new TRPCError({ code: "BAD_REQUEST", message: "只能提及同組夥伴" });
        }
        mentions = [...new Set(input.mentions)];
      }
      const [msg] = await db
        .insert(schema.messages)
        .values({
          groupId: project.groupId,
          projectId: input.projectId,
          userId: ctx.auth.user.id,
          body: input.body,
          replyToId: input.replyToId ?? null,
          refType: input.refType ?? null,
          refId: input.refId ?? null,
          mentions: mentions ?? null,
        })
        .returning();
      return msg;
    }),

  /** 表情回應開關：同人同則同表情再按一次＝收回 */
  react: authedProcedure
    .input(z.object({ messageId: z.string().uuid(), emoji: z.enum(REACTION_EMOJI) }))
    .mutation(async ({ ctx, input }) => {
      const msg = await loadMessage(input.messageId);
      requireGroup(ctx.auth, msg.groupId);
      const removed = await db
        .delete(schema.messageReactions)
        .where(and(
          eq(schema.messageReactions.messageId, input.messageId),
          eq(schema.messageReactions.userId, ctx.auth.user.id),
          eq(schema.messageReactions.emoji, input.emoji),
        ))
        .returning();
      if (removed.length === 0) {
        await db.insert(schema.messageReactions).values({ messageId: input.messageId, userId: ctx.auth.user.id, emoji: input.emoji });
      }
      return { on: removed.length === 0 };
    }),

  /** 釘選（組長以上）：重要決議固定在留言區頂部，不被日常對話洗掉 */
  setPinned: authedProcedure
    .input(z.object({ messageId: z.string().uuid(), pinned: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const msg = await loadMessage(input.messageId);
      requireLeader(ctx.auth, msg.groupId);
      await db.update(schema.messages).set({ pinned: input.pinned }).where(eq(schema.messages.id, input.messageId));
      return { ok: true };
    }),

  /** 已讀水位：打開留言區（且視窗聚焦）時上報；審計中介層對此路徑豁免（高頻、無安全意義） */
  markRead: authedProcedure.input(z.object({ projectId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const project = await loadProject(input.projectId);
    requireGroup(ctx.auth, project.groupId);
    const updated = await db
      .update(schema.messageReads)
      .set({ lastReadAt: new Date() })
      .where(and(eq(schema.messageReads.userId, ctx.auth.user.id), eq(schema.messageReads.projectId, input.projectId)))
      .returning();
    if (updated.length === 0) {
      await db.insert(schema.messageReads).values({ userId: ctx.auth.user.id, projectId: input.projectId });
    }
    return { ok: true };
  }),

  /** 未讀數+是否有人提及我：餵 TocNav「⑤交付」徽章；只算他人留言 */
  unread: authedProcedure.input(z.object({ projectId: z.string().uuid() })).query(async ({ ctx, input }) => {
    const project = await loadProject(input.projectId);
    requireGroup(ctx.auth, project.groupId);
    const [read] = await db
      .select()
      .from(schema.messageReads)
      .where(and(eq(schema.messageReads.userId, ctx.auth.user.id), eq(schema.messageReads.projectId, input.projectId)));
    const conds = [
      eq(schema.messages.projectId, input.projectId),
      ne(schema.messages.userId, ctx.auth.user.id),
      ...(read ? [gt(schema.messages.createdAt, read.lastReadAt)] : []),
    ];
    const [row] = await db
      .select({
        count: sql<number>`count(*)::int`,
        mentioned: sql<boolean>`bool_or(coalesce(${schema.messages.mentions} @> ${JSON.stringify([ctx.auth.user.id])}::jsonb, false))`,
      })
      .from(schema.messages)
      .where(and(...conds));
    return { count: Number(row?.count ?? 0), mentioned: Boolean(row?.mentioned) };
  }),
});
