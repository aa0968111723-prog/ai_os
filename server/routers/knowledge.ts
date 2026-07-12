import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure, requireGroup } from "../trpc";
import { db, schema } from "../db";

export const KNOWLEDGE_KINDS = [
  { id: "transcript", label: "師父開示稿" },
  { id: "testimony", label: "見證故事" },
  { id: "script", label: "腳本" },
  { id: "note", label: "其他筆記" },
] as const;

/** 單筆知識內容上限（避免超長逐字稿撐爆 DB／注入；夠放一篇開示或短腳本） */
const MAX_CONTENT = 40_000;
/** 注入 AI 導演時的總字數上限（LLM 上下文成本控制；超過只取前幾份＋截斷） */
const INJECT_BUDGET = 8_000;

/**
 * 把專案知識庫組成一段可注入 LLM 的上下文（給 director.suggest 等重用）。
 * 依建立時間由新到舊取，總量到 INJECT_BUDGET 為止；回空字串代表沒有知識。
 */
export async function buildKnowledgeContext(projectId: string): Promise<string> {
  const rows = await db
    .select()
    .from(schema.knowledge)
    .where(eq(schema.knowledge.projectId, projectId))
    .orderBy(desc(schema.knowledge.createdAt));
  if (rows.length === 0) return "";
  const labelOf = (k: string) => KNOWLEDGE_KINDS.find((x) => x.id === k)?.label ?? k;
  const parts: string[] = [];
  let budget = INJECT_BUDGET;
  for (const r of rows) {
    if (budget <= 0) break;
    const slice = r.content.slice(0, budget);
    parts.push(`【${labelOf(r.kind)}｜${r.title}】\n${slice}${r.content.length > slice.length ? "…(截斷)" : ""}`);
    budget -= slice.length;
  }
  return parts.join("\n\n");
}

export const knowledgeRouter = router({
  /** 列出專案知識庫（不回傳全文，只回摘要與長度，省流量） */
  list: authedProcedure.input(z.object({ projectId: z.string().uuid() })).query(async ({ ctx, input }) => {
    const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, input.projectId));
    if (!project) throw new TRPCError({ code: "NOT_FOUND" });
    requireGroup(ctx.auth, project.groupId);
    const rows = await db
      .select()
      .from(schema.knowledge)
      .where(eq(schema.knowledge.projectId, input.projectId))
      .orderBy(desc(schema.knowledge.createdAt));
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      title: r.title,
      chars: r.content.length,
      excerpt: r.content.slice(0, 120),
      sourceAssetId: r.sourceAssetId,
      createdAt: r.createdAt,
    }));
  }),

  /** 讀單筆全文（編輯用） */
  get: authedProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ ctx, input }) => {
    const [row] = await db.select().from(schema.knowledge).where(eq(schema.knowledge.id, input.id));
    if (!row) throw new TRPCError({ code: "NOT_FOUND" });
    requireGroup(ctx.auth, row.groupId);
    return row;
  }),

  /** 新增知識（貼上文字） */
  add: authedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        kind: z.enum(["transcript", "testimony", "script", "note"]).default("note"),
        title: z.string().min(1, "請填標題").max(120),
        content: z.string().min(1, "內容不可為空").max(MAX_CONTENT, `內容過長（上限 ${MAX_CONTENT} 字）`),
        sourceAssetId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, input.projectId));
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      requireGroup(ctx.auth, project.groupId);
      const [row] = await db
        .insert(schema.knowledge)
        .values({
          projectId: project.id,
          groupId: project.groupId,
          kind: input.kind,
          title: input.title.trim(),
          content: input.content,
          sourceAssetId: input.sourceAssetId,
          createdBy: ctx.auth.user.id,
        })
        .returning();
      return row;
    }),

  update: authedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        kind: z.enum(["transcript", "testimony", "script", "note"]).optional(),
        title: z.string().min(1).max(120).optional(),
        content: z.string().min(1).max(MAX_CONTENT).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [row] = await db.select().from(schema.knowledge).where(eq(schema.knowledge.id, input.id));
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      requireGroup(ctx.auth, row.groupId);
      const [updated] = await db
        .update(schema.knowledge)
        .set({
          kind: input.kind ?? row.kind,
          title: input.title?.trim() ?? row.title,
          content: input.content ?? row.content,
        })
        .where(eq(schema.knowledge.id, input.id))
        .returning();
      return updated;
    }),

  remove: authedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const [row] = await db.select().from(schema.knowledge).where(eq(schema.knowledge.id, input.id));
    if (!row) throw new TRPCError({ code: "NOT_FOUND" });
    requireGroup(ctx.auth, row.groupId);
    await db.delete(schema.knowledge).where(eq(schema.knowledge.id, input.id));
    return { ok: true };
  }),

  /** 把已上傳的文字素材（txt/md）轉成知識——去重：同 asset 只建一次 */
  addFromAsset: authedProcedure.input(z.object({ assetId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const [asset] = await db.select().from(schema.assets).where(eq(schema.assets.id, input.assetId));
    if (!asset) throw new TRPCError({ code: "NOT_FOUND", message: "找不到素材" });
    requireGroup(ctx.auth, asset.groupId);
    const [dup] = await db
      .select()
      .from(schema.knowledge)
      .where(and(eq(schema.knowledge.sourceAssetId, asset.id), eq(schema.knowledge.projectId, asset.projectId)));
    if (dup) return dup; // 已加過就回原筆，冪等
    if (asset.kind !== "doc" || !asset.storagePath) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "只有文字類素材（txt/md）能加入知識庫" });
    }
    const { readFile } = await import("node:fs/promises");
    const { absPathOf } = await import("../services/storage");
    let content: string;
    try {
      content = (await readFile(absPathOf(asset.storagePath), "utf8")).slice(0, MAX_CONTENT);
    } catch {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "讀取素材內容失敗" });
    }
    if (!content.trim()) throw new TRPCError({ code: "BAD_REQUEST", message: "這份素材沒有可讀的文字內容" });
    const [row] = await db
      .insert(schema.knowledge)
      .values({
        projectId: asset.projectId,
        groupId: asset.groupId,
        kind: "note",
        title: asset.title.slice(0, 120),
        content,
        sourceAssetId: asset.id,
        createdBy: ctx.auth.user.id,
      })
      .returning();
    return row;
  }),
});
