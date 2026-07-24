import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure, requireGroup } from "../trpc";
import { db, schema } from "../db";
import { assertProjectEditable } from "../services/projectAcl";

/** 「再用」要還原的完整生成設定：模型＋角色/場景卡（latest-wins，跟著最近一次使用更新） */
export interface PromptSettings {
  modelId?: string;
  characterIds?: string[];
  scenePresetIds?: string[];
}

/**
 * 存/去重核心（自 save mutation 抽出，行為不變）：同專案同文字已存在則使用次數 +1，
 * 並以「最近一次」的模型/角色/場景設定覆蓋（再用還原的是最新用法）。
 * 抽成函式的原因：工作流啟動（startWorkflowCore）也要把「想法」入庫——
 * 提示詞庫才收得齊全專案的咒語，不只生成台這一路。
 */
export async function savePromptCore(
  project: { id: string; groupId: string },
  userId: string,
  rawText: string,
  settings: PromptSettings = {},
) {
  const text = rawText.trim();
  if (!text || text.length > 2000) return null;
  // 併發自動存同一咒語會 select-then-insert 競態（重複列/漏加 useCount）。
  // 用交易＋per-(專案,文字) advisory lock 序列化——不加唯一索引（text 可達 2000 字、
  // 超過 btree 索引位元上限，索引建立會失敗）。
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${project.id}), hashtext(${text}))`);
    // 非破壞式 latest-wins：只覆蓋呼叫端「有提供」的欄位（undefined＝不知道，別動既有值）。
    // 不然工作流啟動（只知道文字）會把生成台剛存好的模型/角色/場景設定整組洗成 null——
    // 「再用還原完整設定」被「用於工作流」默默毀掉。
    const patch: Partial<{ modelId: string | null; characterIds: string[] | null; scenePresetIds: string[] | null }> = {};
    if (settings.modelId !== undefined) patch.modelId = settings.modelId ?? null;
    if (settings.characterIds !== undefined) patch.characterIds = settings.characterIds?.length ? settings.characterIds : null;
    if (settings.scenePresetIds !== undefined) patch.scenePresetIds = settings.scenePresetIds?.length ? settings.scenePresetIds : null;
    const [existing] = await tx
      .select()
      .from(schema.prompts)
      .where(and(eq(schema.prompts.projectId, project.id), eq(schema.prompts.text, text)));
    if (existing) {
      const [bumped] = await tx
        .update(schema.prompts)
        .set({ useCount: existing.useCount + 1, updatedAt: new Date(), ...patch })
        .where(eq(schema.prompts.id, existing.id))
        .returning();
      return bumped;
    }
    const [row] = await tx
      .insert(schema.prompts)
      .values({ projectId: project.id, groupId: project.groupId, text, createdBy: userId, ...patch })
      .returning();
    return row;
  });
}

/** 提示詞庫：成功生成的「咒語」自動入庫，一鍵再用 */
export const promptsRouter = router({
  list: authedProcedure.input(z.object({ projectId: z.string().uuid() })).query(async ({ ctx, input }) => {
    const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, input.projectId));
    if (!project) throw new TRPCError({ code: "NOT_FOUND" });
    requireGroup(ctx.auth, project.groupId);
    return db
      .select()
      .from(schema.prompts)
      .where(eq(schema.prompts.projectId, input.projectId))
      .orderBy(desc(schema.prompts.useCount), desc(schema.prompts.updatedAt))
      .limit(50);
  }),

  /** 存/去重：同專案同文字已存在則使用次數 +1（自動存的入口，前端在生成成功後呼叫）。
   *  三合一：連同模型/角色/場景設定一起存——「再用」還原完整設定，不只文字。 */
  save: authedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        text: z.string().min(1).max(2000),
        modelId: z.string().max(200).optional(),
        characterIds: z.array(z.string().uuid()).max(6).optional(),
        scenePresetIds: z.array(z.string().uuid()).max(4).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, input.projectId));
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      requireGroup(ctx.auth, project.groupId);
      await assertProjectEditable(ctx.auth, project); // 2.3：檢視者不能寫共用提示詞庫
      return savePromptCore(project, ctx.auth.user.id, input.text, {
        modelId: input.modelId,
        characterIds: input.characterIds,
        scenePresetIds: input.scenePresetIds,
      });
    }),

  remove: authedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const [row] = await db.select().from(schema.prompts).where(eq(schema.prompts.id, input.id));
    if (!row) throw new TRPCError({ code: "NOT_FOUND" });
    requireGroup(ctx.auth, row.groupId);
    await assertProjectEditable(ctx.auth, { id: row.projectId, groupId: row.groupId }); // 2.3：檢視者不能刪他人咒語
    await db.delete(schema.prompts).where(eq(schema.prompts.id, input.id));
    return { ok: true };
  }),
});
