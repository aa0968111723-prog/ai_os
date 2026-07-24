import { z } from "zod";
import { and, asc, eq, getTableColumns, inArray, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure, requireGroup } from "../trpc";
import { db, schema } from "../db";
import { assertReferenceImage } from "../services/referenceAsset";
import { isUniqueViolation } from "../services/generationCore";

/**
 * 把選定場景組成注入生成提示詞的「場景錨點」（色板＋光線；給 generation 重用）。
 */
export async function buildSceneAnchor(projectId: string, presetIds: string[]): Promise<string> {
  if (presetIds.length === 0) return "";
  const rows = await db
    .select()
    .from(schema.scenePresets)
    .where(and(eq(schema.scenePresets.projectId, projectId), inArray(schema.scenePresets.id, presetIds)));
  if (rows.length === 0) return "";
  return rows
    .map((s) => `${s.name}：色板 ${s.palette}${s.lighting ? `、光線 ${s.lighting}` : ""}`)
    .join("；");
}

export const scenePresetsRouter = router({
  list: authedProcedure.input(z.object({ projectId: z.string().uuid() })).query(async ({ ctx, input }) => {
    const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, input.projectId));
    if (!project) throw new TRPCError({ code: "NOT_FOUND" });
    requireGroup(ctx.auth, project.groupId);
    // 帶出參考圖網址（referenceUrl）：left join 素材表——素材進回收桶就回 null，卡片縮圖自動消失
    return db
      .select({ ...getTableColumns(schema.scenePresets), referenceUrl: schema.assets.url })
      .from(schema.scenePresets)
      .leftJoin(
        schema.assets,
        and(eq(schema.assets.id, schema.scenePresets.referenceAssetId), isNull(schema.assets.deletedAt)),
      )
      .where(eq(schema.scenePresets.projectId, input.projectId))
      .orderBy(asc(schema.scenePresets.createdAt));
  }),

  add: authedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        name: z.string().min(1, "請填場景名").max(40),
        palette: z.string().min(1, "請填色板").max(500),
        lighting: z.string().max(500).optional(),
        referenceAssetId: z.string().uuid().optional(),
        /** 冪等鍵（client 產生的 UUID，當 row id 用）：timeout 後重送同鍵回原卡片，不重複建立 */
        clientRequestId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, input.projectId));
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      requireGroup(ctx.auth, project.groupId);
      await (await import("../services/projectAcl")).assertProjectEditable(ctx.auth, project); // 2.3：檢視者不能改卡片
      // 跨組引用驗證：referenceAssetId 必須同組且是圖片（比照 characters）
      if (input.referenceAssetId) await assertReferenceImage(input.referenceAssetId, project.groupId);
      try {
        const [row] = await db
          .insert(schema.scenePresets)
          .values({
            id: input.clientRequestId,
            projectId: project.id,
            groupId: project.groupId,
            name: input.name.trim(),
            palette: input.palette.trim(),
            lighting: input.lighting?.trim(),
            referenceAssetId: input.referenceAssetId,
            createdBy: ctx.auth.user.id,
          })
          .returning();
        return row;
      } catch (err) {
        // 冪等重送撞唯一鍵＝前次請求已建卡（client timeout 後重試）：回既有卡，不重複建立（QA-003）
        if (input.clientRequestId && isUniqueViolation(err)) {
          const [existing] = await db
            .select()
            .from(schema.scenePresets)
            .where(and(eq(schema.scenePresets.id, input.clientRequestId), eq(schema.scenePresets.projectId, project.id)));
          if (existing) return existing;
        }
        throw err;
      }
    }),

  update: authedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(40).optional(),
        palette: z.string().min(1).max(500).optional(),
        lighting: z.string().max(500).optional(),
        referenceAssetId: z.string().uuid().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [row] = await db.select().from(schema.scenePresets).where(eq(schema.scenePresets.id, input.id));
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      requireGroup(ctx.auth, row.groupId);
      await (await import("../services/projectAcl")).assertProjectEditable(ctx.auth, { id: row.projectId, groupId: row.groupId }); // 2.3
      // 跨組引用驗證：改綁 referenceAssetId 時同樣要同組且是圖片（null＝清除引用，免驗）
      if (input.referenceAssetId) await assertReferenceImage(input.referenceAssetId, row.groupId);
      const [updated] = await db
        .update(schema.scenePresets)
        .set({
          name: input.name?.trim() ?? row.name,
          palette: input.palette?.trim() ?? row.palette,
          lighting: input.lighting !== undefined ? input.lighting?.trim() : row.lighting,
          referenceAssetId: input.referenceAssetId !== undefined ? input.referenceAssetId : row.referenceAssetId,
        })
        .where(eq(schema.scenePresets.id, input.id))
        .returning();
      return updated;
    }),

  remove: authedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const [row] = await db.select().from(schema.scenePresets).where(eq(schema.scenePresets.id, input.id));
    if (!row) throw new TRPCError({ code: "NOT_FOUND" });
    requireGroup(ctx.auth, row.groupId);
    await (await import("../services/projectAcl")).assertProjectEditable(ctx.auth, { id: row.projectId, groupId: row.groupId }); // 2.3
    await db.delete(schema.scenePresets).where(eq(schema.scenePresets.id, input.id));
    return { ok: true };
  }),
});
