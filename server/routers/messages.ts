import { z } from "zod";
import { and, count, desc, eq, gt, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure, requireGroup, requireLeader } from "../trpc";
import { db, schema } from "../db";
import { ASSISTANT_TRIGGER, replyAsAssistant } from "../services/messageAssistant";
import { resolveMentions } from "../services/mentions";
import { notify } from "../services/notify";
import { dmSnippet } from "../services/dmCore";

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

/** 可被留言引用的專案內物件型別 */
const REF_TYPES = ["scene", "asset", "generation", "note", "schedule"] as const;
type RefType = (typeof REF_TYPES)[number];

/** 解析引用作品的顯示資訊（標題+縮圖）；查不到（已刪等）回 null，前端顯示「已不存在」 */
async function resolveRefs(rows: Array<{ refType: string | null; refId: string | null }>) {
  const byType: Record<RefType, Set<string>> = { scene: new Set(), asset: new Set(), generation: new Set(), note: new Set(), schedule: new Set() };
  for (const r of rows) {
    if (r.refType && r.refId && r.refType in byType) byType[r.refType as RefType].add(r.refId);
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
  if (byType.note.size) {
    const notes = await db.select({ id: schema.notes.id, title: schema.notes.title })
      .from(schema.notes).where(inArray(schema.notes.id, [...byType.note]));
    for (const n of notes) map.set(`note:${n.id}`, { title: n.title, thumb: null, kind: "note" });
  }
  if (byType.schedule.size) {
    const items = await db.select({ id: schema.scheduleItems.id, title: schema.scheduleItems.title, startsAt: schema.scheduleItems.startsAt })
      .from(schema.scheduleItems).where(inArray(schema.scheduleItems.id, [...byType.schedule]));
    for (const it of items) {
      const when = new Date(it.startsAt).toLocaleDateString("zh-TW", { month: "numeric", day: "numeric" });
      map.set(`schedule:${it.id}`, { title: `${it.title}（${when}）`, thumb: null, kind: "schedule" });
    }
  }
  return map;
}

/** 引用歸屬檢查：scene/asset/generation 必須同專案；note/schedule 必須同組（可跨專案或組層級） */
async function refBelongs(refType: RefType, refId: string, projectId: string, groupId: string): Promise<boolean> {
  switch (refType) {
    case "scene":
      return (await db.select({ id: schema.scenes.id }).from(schema.scenes).where(and(eq(schema.scenes.id, refId), eq(schema.scenes.projectId, projectId)))).length > 0;
    case "asset":
      return (await db.select({ id: schema.assets.id }).from(schema.assets).where(and(eq(schema.assets.id, refId), eq(schema.assets.projectId, projectId)))).length > 0;
    case "generation":
      return (await db.select({ id: schema.generations.id }).from(schema.generations).where(and(eq(schema.generations.id, refId), eq(schema.generations.projectId, projectId)))).length > 0;
    case "note":
      return (await db.select({ id: schema.notes.id }).from(schema.notes).where(and(eq(schema.notes.id, refId), eq(schema.notes.groupId, groupId)))).length > 0;
    case "schedule":
      return (await db.select({ id: schema.scheduleItems.id }).from(schema.scheduleItems).where(and(eq(schema.scheduleItems.id, refId), eq(schema.scheduleItems.groupId, groupId)))).length > 0;
  }
}

const MESSAGE_PAGE = 50;

export const messagesRouter = router({
  list: authedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        beforeCreatedAt: z.coerce.date().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
    const project = await loadProject(input.projectId);
    requireGroup(ctx.auth, project.groupId);
    const baseWhere = and(eq(schema.messages.groupId, project.groupId), eq(schema.messages.projectId, input.projectId));
    const pageWhere = input.beforeCreatedAt
      ? and(baseWhere, lt(schema.messages.createdAt, input.beforeCreatedAt))
      : baseWhere;

    const selectShape = {
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
      voiceStatus: schema.messages.voiceStatus,
      createdAt: schema.messages.createdAt,
    };

    const pageRows = await db
      .select(selectShape)
      .from(schema.messages)
      .leftJoin(schema.users, eq(schema.messages.userId, schema.users.id))
      .where(pageWhere)
      .orderBy(desc(schema.messages.createdAt))
      .limit(MESSAGE_PAGE + 1);
    const hasMore = pageRows.length > MESSAGE_PAGE;
    const windowRows = hasMore ? pageRows.slice(0, MESSAGE_PAGE) : pageRows;

    let pinnedExtra: typeof windowRows = [];
    if (!input.beforeCreatedAt) {
      pinnedExtra = await db
        .select(selectShape)
        .from(schema.messages)
        .leftJoin(schema.users, eq(schema.messages.userId, schema.users.id))
        .where(and(baseWhere, eq(schema.messages.pinned, true)))
        .orderBy(desc(schema.messages.createdAt))
        .limit(100);
    }

    const byId = new Map<string, (typeof windowRows)[number]>();
    for (const r of [...windowRows, ...pinnedExtra]) byId.set(r.id, r);
    const ordered = [...byId.values()].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
    const ids = ordered.map((r) => r.id);

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
    const items = ordered.map((r) => ({
      ...r,
      replyTo: r.replyToId ? (replyMap.get(r.replyToId) ?? null) : null,
      reactions: reactionMap.get(r.id) ?? [],
      ref: r.refType && r.refId ? (refMap.get(`${r.refType}:${r.refId}`) ?? null) : null,
      voiceUrl: r.kind === "voice" && r.refType === "asset" && r.refId ? `/api/assets/${r.refId}/file` : null,
    }));
    return { items, hasMore };
  }),

  post: authedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        body: z.string().min(1).max(2000),
        replyToId: z.string().uuid().optional(),
        refType: z.enum(REF_TYPES).optional(),
        refId: z.string().uuid().optional(),
        mentions: z.array(z.string().uuid()).max(20).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const project = await loadProject(input.projectId);
      requireGroup(ctx.auth, project.groupId);
      let parentAuthorId: string | null = null;
      if (input.replyToId) {
        const parent = await loadMessage(input.replyToId);
        if (parent.projectId !== input.projectId) throw new TRPCError({ code: "BAD_REQUEST", message: "只能回覆本專案的留言" });
        parentAuthorId = parent.userId;
      }
      if (!!input.refType !== !!input.refId) throw new TRPCError({ code: "BAD_REQUEST", message: "引用參數不完整" });
      if (input.refType && input.refId) {
        if (!(await refBelongs(input.refType, input.refId, input.projectId, project.groupId))) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "引用的項目不在本專案／本組" });
        }
      }
      // 伺服器自己也從 body 解析一次：前端的名單是非同步載入的，打開專案立刻打字送出時
      // 它算出來的 mentions 是空的，而在此之前伺服器從頭到尾不看 body——那則 @ 就永遠消失了
      const mentions = await resolveMentions(project.groupId, input.mentions, input.body);
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
      const mentionTargets = (mentions ?? []).filter((id) => id !== ctx.auth.user.id);
      if (mentionTargets.length) {
        void notify({
          userIds: mentionTargets,
          groupId: project.groupId,
          projectId: project.id,
          kind: "mention",
          actorId: ctx.auth.user.id,
          messageId: msg.id,
          title: `${ctx.auth.user.name} 在「${project.title}」提及你`,
          body: dmSnippet(input.body),
          // mid 讓收端捲到並高亮「被提及的那一則」，而不只是打開留言面板
          url: `/p/${project.id}?focus=messages&mid=${msg.id}`,
          eventKey: `mention:${msg.id}:posted`,
        });
      }
      // 回覆要通知被回覆的人。沒有這一段的話，內建快速短語裡的「請組長過目 🙏」
      // （它不帶任何 @）**組長絕對收不到**——按了等於什麼都沒做。
      if (parentAuthorId && parentAuthorId !== ctx.auth.user.id && !mentionTargets.includes(parentAuthorId)) {
        void notify({
          userIds: [parentAuthorId],
          groupId: project.groupId,
          projectId: project.id,
          kind: "reply",
          actorId: ctx.auth.user.id,
          messageId: msg.id,
          title: `${ctx.auth.user.name} 回覆了你在「${project.title}」的留言`,
          body: dmSnippet(input.body),
          url: `/p/${project.id}?focus=messages&mid=${msg.id}`,
          eventKey: `reply:${msg.id}:posted`,
        });
      }
      if (input.body.includes(ASSISTANT_TRIGGER)) {
        void replyAsAssistant({
          projectId: input.projectId,
          groupId: project.groupId,
          askerId: ctx.auth.user.id,
          question: input.body,
        }).catch((err) => console.warn("[messages] @助手 回覆失敗：", err instanceof Error ? err.message : err));
      }
      return msg;
    }),

  postVoice: authedProcedure
    .input(z.object({ projectId: z.string().uuid(), assetId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const project = await loadProject(input.projectId);
      requireGroup(ctx.auth, project.groupId);
      const [asset] = await db
        .select()
        .from(schema.assets)
        .where(
          and(
            eq(schema.assets.id, input.assetId),
            eq(schema.assets.projectId, input.projectId),
            isNull(schema.assets.deletedAt), // M6：軟刪／回收桶素材不可當語音來源
          ),
        );
      if (!asset) throw new TRPCError({ code: "BAD_REQUEST", message: "語音檔不在本專案或已刪除" });
      if (asset.kind !== "audio") throw new TRPCError({ code: "BAD_REQUEST", message: "這不是音訊檔" });
      const [msg] = await db
        .insert(schema.messages)
        .values({
          groupId: project.groupId,
          projectId: input.projectId,
          userId: ctx.auth.user.id,
          kind: "voice",
          body: "🎙️ 語音訊息（轉錄中…）",
          refType: "asset",
          refId: input.assetId,
          voiceStatus: "pending",
        })
        .returning();
      return msg;
    }),

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
        await db
          .insert(schema.messageReactions)
          .values({ messageId: input.messageId, userId: ctx.auth.user.id, emoji: input.emoji })
          .onConflictDoNothing();
      }
      return { on: removed.length === 0 };
    }),

  /**
   * 在某一版成品的某個位置上留一則標注。
   *
   * anchorAssetId 一定要驗「真的屬於這一格」：不驗的話，任何組員都能把標注釘到別格
   * （甚至別專案）的素材上，而分鏡列的未解決數會開始出現指不到任何東西的幽靈。
   */
  postAnnotation: authedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        sceneId: z.string().uuid(),
        anchorAssetId: z.string().uuid(),
        ax: z.number().min(0).max(1),
        ay: z.number().min(0).max(1),
        tMs: z.number().int().min(0).optional(),
        body: z.string().min(1).max(2000),
        mentions: z.array(z.string().uuid()).max(20).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const project = await loadProject(input.projectId);
      requireGroup(ctx.auth, project.groupId);
      if (!(await refBelongs("scene", input.sceneId, input.projectId, project.groupId))) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "這一格不在本專案" });
      }
      // 標注釘在某一版成品上，而那一版必須真的是這一格的素材——否則標注會指向
      // 一張與這格無關的圖，換版橫幅也算不出「來自第幾版」
      const [anchor] = await db
        .select({ id: schema.assets.id })
        .from(schema.assets)
        .where(and(
          eq(schema.assets.id, input.anchorAssetId),
          eq(schema.assets.projectId, input.projectId),
          isNull(schema.assets.deletedAt),
        ));
      if (!anchor) throw new TRPCError({ code: "BAD_REQUEST", message: "找不到這一版成品（可能已在回收桶）" });
      const mentions = await resolveMentions(project.groupId, input.mentions, input.body);
      const [msg] = await db
        .insert(schema.messages)
        .values({
          groupId: project.groupId,
          projectId: input.projectId,
          userId: ctx.auth.user.id,
          kind: "annotation",
          body: input.body,
          refType: "scene",
          refId: input.sceneId,
          anchorAssetId: input.anchorAssetId,
          ax: input.ax,
          ay: input.ay,
          tMs: input.tMs ?? null,
          mentions: mentions ?? null,
        })
        .returning();
      // 標注的收件人＝被 @ 的人；沒 @ 任何人時通知組內其他成員以外的人是洗版，
      // 所以刻意只通知明確被指名的對象——「這裡要改」預設是講給某個人聽的
      const targets = (mentions ?? []).filter((id) => id !== ctx.auth.user.id);
      if (targets.length) {
        void notify({
          userIds: targets,
          groupId: project.groupId,
          projectId: project.id,
          sceneId: input.sceneId,
          kind: "annotation",
          actorId: ctx.auth.user.id,
          messageId: msg.id,
          refType: "scene",
          refId: input.sceneId,
          title: `${ctx.auth.user.name} 在「${project.title}」標注了要改的地方`,
          body: dmSnippet(input.body),
          // 深連結要把舞台切回「標注所在的那一版」，不是現用版——否則點進來看到的是別的圖
          url: `/p/${project.id}?focus=annotation&mid=${msg.id}`,
          eventKey: `annotation:${msg.id}:posted`,
        });
      }
      return msg;
    }),

  /** 某一格（或某個引用目標）的標注／討論串。走 messages_ref_idx。 */
  listByRef: authedProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      refType: z.enum(REF_TYPES),
      refId: z.string().uuid(),
      includeResolved: z.boolean().default(false),
    }))
    .query(async ({ ctx, input }) => {
      const project = await loadProject(input.projectId);
      requireGroup(ctx.auth, project.groupId);
      const conds = [
        eq(schema.messages.projectId, input.projectId),
        eq(schema.messages.refType, input.refType),
        eq(schema.messages.refId, input.refId),
      ];
      if (!input.includeResolved) conds.push(isNull(schema.messages.resolvedAt));
      return db
        .select({
          id: schema.messages.id,
          userId: schema.messages.userId,
          userName: schema.users.name,
          kind: schema.messages.kind,
          body: schema.messages.body,
          anchorAssetId: schema.messages.anchorAssetId,
          ax: schema.messages.ax,
          ay: schema.messages.ay,
          tMs: schema.messages.tMs,
          resolvedAt: schema.messages.resolvedAt,
          resolvedBy: schema.messages.resolvedBy,
          mentions: schema.messages.mentions,
          createdAt: schema.messages.createdAt,
        })
        .from(schema.messages)
        .innerJoin(schema.users, eq(schema.users.id, schema.messages.userId))
        .where(and(...conds))
        .orderBy(schema.messages.createdAt);
    }),

  /**
   * 整個專案每一格的未解決標注數，一支查完（分鏡列的「⚑ N」）。
   * 刻意不做成「每格各打一支」——十幾格就是十幾支查詢，而這個數字是每次開頁都要的。
   */
  openCountsByScene: authedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const project = await loadProject(input.projectId);
      requireGroup(ctx.auth, project.groupId);
      const rows = await db
        .select({ refId: schema.messages.refId, n: count() })
        .from(schema.messages)
        .where(and(
          eq(schema.messages.projectId, input.projectId),
          eq(schema.messages.kind, "annotation"),
          isNull(schema.messages.resolvedAt),
        ))
        .groupBy(schema.messages.refId);
      return rows.filter((r): r is { refId: string; n: number } => !!r.refId);
    }),

  /**
   * 「這版已改好」／收回。
   *
   * **requireGroup 而不是 requireLeader**：組員連自己開的討論串都不能收掉，是現況最沒道理
   * 的一條。setPinned 用 requireLeader 對「釘公告」合理，但「這件事我處理完了」不該是組長專屬。
   */
  resolveAnnotation: authedProcedure
    .input(z.object({ messageId: z.string().uuid(), resolved: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const msg = await loadMessage(input.messageId);
      requireGroup(ctx.auth, msg.groupId);
      if (msg.kind !== "annotation") throw new TRPCError({ code: "BAD_REQUEST", message: "只有標注可以標記為已改好" });
      await db
        .update(schema.messages)
        .set(input.resolved
          ? { resolvedAt: new Date(), resolvedBy: ctx.auth.user.id }
          : { resolvedAt: null, resolvedBy: null })
        .where(eq(schema.messages.id, input.messageId));
      // 提出的人要知道「他指出的事被處理掉了」，否則得自己回去看
      if (input.resolved && msg.userId !== ctx.auth.user.id && msg.projectId) {
        void notify({
          userIds: [msg.userId],
          groupId: msg.groupId,
          projectId: msg.projectId,
          sceneId: msg.refId,
          kind: "annotation_resolved",
          actorId: ctx.auth.user.id,
          messageId: msg.id,
          title: `${ctx.auth.user.name} 標記「已改好」`,
          body: dmSnippet(msg.body),
          url: `/p/${msg.projectId}?focus=annotation&mid=${msg.id}`,
          eventKey: `annotation_resolved:${msg.id}`,
        });
      }
      return { ok: true as const };
    }),

  setPinned: authedProcedure
    .input(z.object({ messageId: z.string().uuid(), pinned: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const msg = await loadMessage(input.messageId);
      requireLeader(ctx.auth, msg.groupId);
      await db.update(schema.messages).set({ pinned: input.pinned }).where(eq(schema.messages.id, input.messageId));
      return { ok: true };
    }),

  markRead: authedProcedure.input(z.object({ projectId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const project = await loadProject(input.projectId);
    requireGroup(ctx.auth, project.groupId);
    await db
      .insert(schema.messageReads)
      .values({ userId: ctx.auth.user.id, projectId: input.projectId, lastReadAt: new Date() })
      .onConflictDoUpdate({
        target: [schema.messageReads.userId, schema.messageReads.projectId],
        set: { lastReadAt: new Date() },
      });
    return { ok: true };
  }),

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
