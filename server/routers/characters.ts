import { z } from "zod";
import { and, asc, eq, getTableColumns, inArray, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure, requireGroup } from "../trpc";
import { db, schema } from "../db";
import { assertReferenceImage } from "../services/referenceAsset";

/**
 * 把選定角色組成注入生成提示詞的「定裝錨點」（給 generation 重用）。
 * 只放外觀（appearance），不放個性/語氣——那些會被畫成文字或無意義。
 */
export async function buildCharacterAnchor(projectId: string, characterIds: string[]): Promise<string> {
  if (characterIds.length === 0) return "";
  const rows = await db
    .select()
    .from(schema.characters)
    .where(and(eq(schema.characters.projectId, projectId), inArray(schema.characters.id, characterIds)));
  if (rows.length === 0) return "";
  return rows.map((c) => `${c.name}：${c.appearance}`).join("；");
}

export const charactersRouter = router({
  list: authedProcedure.input(z.object({ projectId: z.string().uuid() })).query(async ({ ctx, input }) => {
    const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, input.projectId));
    if (!project) throw new TRPCError({ code: "NOT_FOUND" });
    requireGroup(ctx.auth, project.groupId);
    // 帶出參考圖網址（referenceUrl）：left join 素材表——素材進回收桶就回 null，卡片縮圖自動消失
    return db
      .select({ ...getTableColumns(schema.characters), referenceUrl: schema.assets.url })
      .from(schema.characters)
      .leftJoin(
        schema.assets,
        and(eq(schema.assets.id, schema.characters.referenceAssetId), isNull(schema.assets.deletedAt)),
      )
      .where(eq(schema.characters.projectId, input.projectId))
      .orderBy(asc(schema.characters.createdAt));
  }),

  add: authedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        name: z.string().min(1, "請填角色名").max(40),
        appearance: z.string().min(1, "請填外觀設定").max(1000),
        notes: z.string().max(1000).optional(),
        referenceAssetId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, input.projectId));
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      requireGroup(ctx.auth, project.groupId);
      await (await import("../services/projectAcl")).assertProjectEditable(ctx.auth, project); // 2.3：檢視者不能改卡片
      // 跨組引用驗證：referenceAssetId 必須同組且是圖片，否則能把別組定裝圖綁進本組角色
      if (input.referenceAssetId) await assertReferenceImage(input.referenceAssetId, project.groupId);
      const [row] = await db
        .insert(schema.characters)
        .values({
          projectId: project.id,
          groupId: project.groupId,
          name: input.name.trim(),
          appearance: input.appearance.trim(),
          notes: input.notes?.trim(),
          referenceAssetId: input.referenceAssetId,
          createdBy: ctx.auth.user.id,
        })
        .returning();
      return row;
    }),

  update: authedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(40).optional(),
        appearance: z.string().min(1).max(1000).optional(),
        notes: z.string().max(1000).optional(),
        referenceAssetId: z.string().uuid().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [row] = await db.select().from(schema.characters).where(eq(schema.characters.id, input.id));
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      requireGroup(ctx.auth, row.groupId);
      await (await import("../services/projectAcl")).assertProjectEditable(ctx.auth, { id: row.projectId, groupId: row.groupId }); // 2.3
      // 跨組引用驗證：改綁 referenceAssetId 時同樣要同組且是圖片（null＝清除引用，免驗）
      if (input.referenceAssetId) await assertReferenceImage(input.referenceAssetId, row.groupId);
      const [updated] = await db
        .update(schema.characters)
        .set({
          name: input.name?.trim() ?? row.name,
          appearance: input.appearance?.trim() ?? row.appearance,
          notes: input.notes !== undefined ? input.notes?.trim() : row.notes,
          referenceAssetId: input.referenceAssetId !== undefined ? input.referenceAssetId : row.referenceAssetId,
        })
        .where(eq(schema.characters.id, input.id))
        .returning();
      return updated;
    }),

  remove: authedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const [row] = await db.select().from(schema.characters).where(eq(schema.characters.id, input.id));
    if (!row) throw new TRPCError({ code: "NOT_FOUND" });
    requireGroup(ctx.auth, row.groupId);
    await (await import("../services/projectAcl")).assertProjectEditable(ctx.auth, { id: row.projectId, groupId: row.groupId }); // 2.3
    await db.delete(schema.characters).where(eq(schema.characters.id, input.id));
    return { ok: true };
  }),
});
