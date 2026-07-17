import { z } from "zod";
import { and, desc, eq, notInArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure, requireGroup } from "../trpc";
import { db, schema } from "../db";
import { validateMentions } from "../services/mentions";

/**
 * 筆記（需求 10）：會議紀錄等長文，掛組（可選掛專案）。
 * - 內容更新前存 text_versions 快照（kind='note'）——與知識庫同一版本機制（#29），每筆保留 20 版。
 * - 刪除：作者本人或組長以上；硬刪除（有版本快照可救急，v1 不進回收桶——見優化評估報告）。
 */
const MAX_CONTENT = 40_000;
const VERSION_KEEP = 20;

/** 更新前快照（比照 knowledge 的 snapshotKnowledge；kind='note'） */
async function snapshotNote(row: { id: string; projectId: string | null; groupId: string; title: string; content: string }, createdBy: string): Promise<void> {
  await db.insert(schema.textVersions).values({
    // text_versions.projectId 非空欄位——組層級筆記以自身 id 佔位無意義，改存 groupId 對應的「無專案」語意：
    // 這裡直接沿用 schema 要求，projectId 為 null 時以 note 所屬 group 的任一穩定值不可行，
    // 故約定：組層級筆記的版本快照 projectId 存 note 自身 id（僅作分區鍵，不參與任何 join）。
    projectId: row.projectId ?? row.id,
    groupId: row.groupId,
    kind: "note",
    refId: row.id,
    title: row.title,
    content: row.content,
    createdBy,
  });
  const keep = await db
    .select({ id: schema.textVersions.id })
    .from(schema.textVersions)
    .where(and(eq(schema.textVersions.kind, "note"), eq(schema.textVersions.refId, row.id)))
    .orderBy(desc(schema.textVersions.createdAt))
    .limit(VERSION_KEEP);
  if (keep.length >= VERSION_KEEP) {
    await db
      .delete(schema.textVersions)
      .where(and(
        eq(schema.textVersions.kind, "note"),
        eq(schema.textVersions.refId, row.id),
        notInArray(schema.textVersions.id, keep.map((k) => k.id)),
      ));
  }
}

async function getNoteChecked(auth: Parameters<typeof requireGroup>[0], id: string) {
  const [row] = await db.select().from(schema.notes).where(eq(schema.notes.id, id));
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這則筆記" });
  requireGroup(auth, row.groupId);
  return row;
}

export const notesRouter = router({
  /** 清單（摘要，不回全文省流量）；可選按專案過濾 */
  list: authedProcedure
    .input(z.object({ groupId: z.string().uuid(), projectId: z.string().uuid().optional() }))
    .query(async ({ ctx, input }) => {
      requireGroup(ctx.auth, input.groupId);
      const conds = [eq(schema.notes.groupId, input.groupId)];
      if (input.projectId) conds.push(eq(schema.notes.projectId, input.projectId));
      const rows = await db
        .select({
          id: schema.notes.id,
          projectId: schema.notes.projectId,
          title: schema.notes.title,
          content: schema.notes.content,
          updatedAt: schema.notes.updatedAt,
          createdBy: schema.notes.createdBy,
          creatorName: schema.users.name,
          sourceMessageId: schema.notes.sourceMessageId,
          mentions: schema.notes.mentions,
        })
        .from(schema.notes)
        .leftJoin(schema.users, eq(schema.users.id, schema.notes.createdBy))
        .where(and(...conds))
        .orderBy(desc(schema.notes.updatedAt))
        .limit(200);
      return rows.map((r) => ({
        id: r.id,
        projectId: r.projectId,
        title: r.title,
        chars: r.content.length,
        excerpt: r.content.slice(0, 120),
        updatedAt: r.updatedAt,
        createdBy: r.createdBy,
        creatorName: r.creatorName ?? "?",
        sourceMessageId: r.sourceMessageId,
        mentions: r.mentions,
      }));
    }),

  /** 單筆全文（編輯用） */
  get: authedProcedure.input(z.object({ id: z.string().uuid() })).query(({ ctx, input }) => getNoteChecked(ctx.auth, input.id)),

  add: authedProcedure
    .input(z.object({
      groupId: z.string().uuid(),
      projectId: z.string().uuid().optional(),
      title: z.string().min(1, "請填標題").max(120),
      content: z.string().min(1, "內容不可為空").max(MAX_CONTENT, `內容過長（上限 ${MAX_CONTENT} 字）`),
      // 由留言「轉筆記」建立時帶來源留言 id（供 Planner 反向跳回）；@提及同組成員
      sourceMessageId: z.string().uuid().optional(),
      mentions: z.array(z.string().uuid()).max(20).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      requireGroup(ctx.auth, input.groupId);
      // 掛專案時驗證專案屬於同組——否則能把筆記掛到別組專案上（跨組指涉）
      if (input.projectId) {
        const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, input.projectId));
        if (!project || project.groupId !== input.groupId) throw new TRPCError({ code: "BAD_REQUEST", message: "專案不存在或不屬於此組" });
      }
      // 來源留言必須屬於同組（擋把別組留言接到本組筆記）
      if (input.sourceMessageId) {
        const [m] = await db.select({ groupId: schema.messages.groupId }).from(schema.messages).where(eq(schema.messages.id, input.sourceMessageId));
        if (!m || m.groupId !== input.groupId) throw new TRPCError({ code: "BAD_REQUEST", message: "來源留言不屬於此組" });
      }
      const mentions = await validateMentions(input.groupId, input.mentions);
      const [row] = await db
        .insert(schema.notes)
        .values({
          groupId: input.groupId,
          projectId: input.projectId ?? null,
          title: input.title.trim(),
          content: input.content,
          createdBy: ctx.auth.user.id,
          sourceMessageId: input.sourceMessageId ?? null,
          mentions: mentions ?? null,
        })
        .returning();
      return row;
    }),

  update: authedProcedure
    .input(z.object({
      id: z.string().uuid(),
      title: z.string().min(1).max(120).optional(),
      content: z.string().min(1).max(MAX_CONTENT).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const row = await getNoteChecked(ctx.auth, input.id);
      // 內容真的改變才存版本快照（只改標題不灌版本）——與 knowledge.update 同一原則
      const contentChanges = input.content !== undefined && input.content !== row.content;
      if (contentChanges) await snapshotNote(row, ctx.auth.user.id);
      const [updated] = await db
        .update(schema.notes)
        .set({
          title: input.title?.trim() ?? row.title,
          content: input.content ?? row.content,
          updatedAt: new Date(),
        })
        .where(eq(schema.notes.id, row.id))
        .returning();
      return updated;
    }),

  /** 刪除：作者本人或組長以上（硬刪除；版本快照留存於 text_versions 供救急） */
  remove: authedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const row = await getNoteChecked(ctx.auth, input.id);
    const role = requireGroup(ctx.auth, row.groupId);
    if (row.createdBy !== ctx.auth.user.id && role === "member") {
      throw new TRPCError({ code: "FORBIDDEN", message: "只有作者本人或組長以上可以刪除筆記" });
    }
    await db.delete(schema.notes).where(eq(schema.notes.id, row.id));
    return { ok: true };
  }),
});
