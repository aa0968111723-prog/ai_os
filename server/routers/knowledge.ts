import { z } from "zod";
import { and, desc, eq, isNull, notInArray } from "drizzle-orm";
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
    // ★ 絕不注入已軟刪除（回收桶）的知識——刪掉的逐字稿／見證不可再餵給 AI 導演 LLM
    .where(and(eq(schema.knowledge.projectId, projectId), isNull(schema.knowledge.deletedAt)))
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

/** 版本歷史（#29）每個 refId 保留的最近版本上限——超過就把最舊的刪掉，避免逐字稿版本無限累積撐爆 DB */
const VERSION_KEEP = 20;

/**
 * 把知識庫某筆「當前（更新前）」的 title+content 存成一版快照（kind='knowledge'、refId=知識 id），
 * 再修剪成此 refId 只保留最近 VERSION_KEEP 版。呼叫端負責只在「內容真的改變」時呼叫（避免灌雜訊版本）。
 */
async function snapshotKnowledge(
  row: { id: string; projectId: string; groupId: string; title: string; content: string },
  createdBy: string,
): Promise<void> {
  await db.insert(schema.textVersions).values({
    projectId: row.projectId,
    groupId: row.groupId,
    kind: "knowledge",
    refId: row.id,
    title: row.title,
    content: row.content,
    createdBy,
  });
  // 修剪：撈此 refId 由新到舊的前 VERSION_KEEP 筆，其餘（較舊）刪除。
  // 只在版本數已達上限時才刪，且 notInArray 的保留集合此時必為非空（= VERSION_KEEP 筆）。
  const keep = await db
    .select({ id: schema.textVersions.id })
    .from(schema.textVersions)
    .where(and(eq(schema.textVersions.kind, "knowledge"), eq(schema.textVersions.refId, row.id)))
    .orderBy(desc(schema.textVersions.createdAt))
    .limit(VERSION_KEEP);
  if (keep.length >= VERSION_KEEP) {
    await db
      .delete(schema.textVersions)
      .where(
        and(
          eq(schema.textVersions.kind, "knowledge"),
          eq(schema.textVersions.refId, row.id),
          notInArray(
            schema.textVersions.id,
            keep.map((k) => k.id),
          ),
        ),
      );
  }
}

export const knowledgeRouter = router({
  /** 列出專案知識庫（不回傳全文，只回摘要與長度，省流量） */
  list: authedProcedure.input(z.object({ projectId: z.string().uuid() })).query(async ({ ctx, input }) => {
    const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, input.projectId));
    if (!project) throw new TRPCError({ code: "NOT_FOUND" });
    requireGroup(ctx.auth, project.groupId);
    // 回收桶裡的知識不列在正式清單（另走 projects.listDeleted）
    const rows = await db
      .select()
      .from(schema.knowledge)
      .where(and(eq(schema.knowledge.projectId, input.projectId), isNull(schema.knowledge.deletedAt)))
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

  /** 讀單筆全文（編輯用）：回收桶裡的視為不存在（不給編輯，先還原） */
  get: authedProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ ctx, input }) => {
    const [row] = await db
      .select()
      .from(schema.knowledge)
      .where(and(eq(schema.knowledge.id, input.id), isNull(schema.knowledge.deletedAt)));
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
      // 跨組引用驗證：referenced asset 必須同組，否則能借知識庫把別組素材綁進本專案（與 generationCore 對 sourceAssetId 一致）
      if (input.sourceAssetId) {
        const [srcAsset] = await db.select().from(schema.assets).where(eq(schema.assets.id, input.sourceAssetId));
        if (!srcAsset) throw new TRPCError({ code: "NOT_FOUND", message: "找不到來源素材" });
        if (srcAsset.groupId !== project.groupId) throw new TRPCError({ code: "FORBIDDEN", message: "來源素材不屬於此專案的組" });
      }
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
      // 版本歷史（#29）：覆寫前，先把「更新前」的舊全文存成一版快照——
      // 只在內容『真的改變』時存（只改標題／重存相同內容不灌版本），避免雜訊。
      const contentChanges = input.content !== undefined && input.content !== row.content;
      if (contentChanges) await snapshotKnowledge(row, ctx.auth.user.id);
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

  /**
   * 列出某筆知識的版本歷史（#29）：由新到舊，只回摘要（title/字數/前段預覽），不回全文（省流量）。
   * 授權：先以 knowledge id（未軟刪除者）撈出該筆，再 requireGroup(ctx.auth, row.groupId)——
   * 沿用 get/remove 的「查本筆 → 用它的 groupId 守衛」模式，回收桶裡的知識視為不存在。
   */
  listVersions: authedProcedure.input(z.object({ knowledgeId: z.string().uuid() })).query(async ({ ctx, input }) => {
    const [row] = await db
      .select()
      .from(schema.knowledge)
      .where(and(eq(schema.knowledge.id, input.knowledgeId), isNull(schema.knowledge.deletedAt)));
    if (!row) throw new TRPCError({ code: "NOT_FOUND" });
    requireGroup(ctx.auth, row.groupId);
    const versions = await db
      .select()
      .from(schema.textVersions)
      .where(and(eq(schema.textVersions.kind, "knowledge"), eq(schema.textVersions.refId, input.knowledgeId)))
      .orderBy(desc(schema.textVersions.createdAt));
    return versions.map((v) => ({
      id: v.id,
      title: v.title,
      chars: v.content.length,
      preview: v.content.slice(0, 120),
      createdAt: v.createdAt,
    }));
  }),

  /**
   * 還原到某一版（#29）：先把「當前」全文再存一版快照（讓還原本身也可被再還原／反悔），
   * 再把知識的 title/content 覆寫成該版內容。授權同 update：查本筆（未軟刪除）→ requireGroup(groupId)；
   * 回收桶裡的知識不給還原版本（要先還原整筆）。版本必須屬於這筆知識（kind='knowledge'、refId 相符）。
   */
  restoreVersion: authedProcedure
    .input(z.object({ knowledgeId: z.string().uuid(), versionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await db
        .select()
        .from(schema.knowledge)
        .where(and(eq(schema.knowledge.id, input.knowledgeId), isNull(schema.knowledge.deletedAt)));
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      requireGroup(ctx.auth, row.groupId);
      const [version] = await db
        .select()
        .from(schema.textVersions)
        .where(
          and(
            eq(schema.textVersions.id, input.versionId),
            eq(schema.textVersions.kind, "knowledge"),
            eq(schema.textVersions.refId, input.knowledgeId),
          ),
        );
      if (!version) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這個版本" });
      // 先把當前內容存成一版，這樣「還原」本身也可被再還原（不會弄丟現況）。
      await snapshotKnowledge(row, ctx.auth.user.id);
      const [updated] = await db
        .update(schema.knowledge)
        .set({ title: version.title ?? row.title, content: version.content })
        .where(eq(schema.knowledge.id, input.knowledgeId))
        .returning();
      return updated;
    }),

  /** 刪除知識＝軟刪除（回收桶）：保留逐字稿／見證全文，可還原；還原前不會注入 LLM */
  remove: authedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const [row] = await db
      .select()
      .from(schema.knowledge)
      .where(and(eq(schema.knowledge.id, input.id), isNull(schema.knowledge.deletedAt)));
    if (!row) throw new TRPCError({ code: "NOT_FOUND" });
    requireGroup(ctx.auth, row.groupId);
    await db.update(schema.knowledge).set({ deletedAt: new Date() }).where(eq(schema.knowledge.id, input.id));
    return { ok: true };
  }),

  /** 還原知識（回收桶 → 知識庫）：清掉 deletedAt，之後又會被注入 AI 導演 */
  restore: authedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const [row] = await db.select().from(schema.knowledge).where(eq(schema.knowledge.id, input.id));
    if (!row) throw new TRPCError({ code: "NOT_FOUND" });
    requireGroup(ctx.auth, row.groupId);
    await db.update(schema.knowledge).set({ deletedAt: null }).where(eq(schema.knowledge.id, input.id));
    return { ok: true };
  }),

  /** 永久刪除知識（回收桶內「永久刪除」）：真的 db.delete，不可復原 */
  purge: authedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
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
      .where(
        and(
          eq(schema.knowledge.sourceAssetId, asset.id),
          eq(schema.knowledge.projectId, asset.projectId),
          // 只認未刪除的既有筆：若前一份已丟進回收桶，這次重新加入應建一份新的活筆
          isNull(schema.knowledge.deletedAt),
        ),
      );
    if (dup) return dup; // 已加過就回原筆，冪等
    if (asset.kind !== "doc" || !asset.storagePath) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "只有文字類素材（txt/md）能加入知識庫" });
    }
    const { open } = await import("node:fs/promises");
    const { absPathOf } = await import("../services/storage");
    let content: string;
    try {
      // 只讀前段（非整檔進記憶體）——即使有人上傳 200MB 的 .txt，也只吃 MAX_CONTENT×4 bytes。
      // CJK 一字最多 4 bytes（UTF-8），讀 MAX_CONTENT×4 bytes 後再截到 MAX_CONTENT 字，足夠且有界。
      const fh = await open(absPathOf(asset.storagePath), "r");
      try {
        const buf = Buffer.alloc(MAX_CONTENT * 4);
        const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
        content = buf.subarray(0, bytesRead).toString("utf8").slice(0, MAX_CONTENT);
      } finally {
        await fh.close();
      }
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
