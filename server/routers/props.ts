import { z } from "zod";
import { and, asc, count, eq, getTableColumns, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  MAX_PROJECT_PROPS,
  PROP_APPEARANCE_MAX,
  PROP_NAME_MAX,
  PROP_NOTES_MAX,
} from "../../shared/cardLimits";
import { router, authedProcedure, requireGroup } from "../trpc";
import { db, schema } from "../db";
import { assertReferenceImage } from "../services/referenceAsset";
import { isUniqueViolation } from "../services/generationCore";

export { MAX_PROJECT_PROPS };

/**
 * 物件／道具卡（QA 2026-08-01 使用者要求的第三種一致性錨點）。
 *
 * 行為逐條對齊角色定裝卡（同樣的 ACL、冪等鍵、上限、參考圖驗證）——三張卡在使用者眼裡是
 * 同一類東西，任何一張的守門比別人鬆，就是一個可以繞過去的洞。
 */
export const propsRouter = router({
  list: authedProcedure.input(z.object({ projectId: z.string().uuid() })).query(async ({ ctx, input }) => {
    const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, input.projectId));
    if (!project) throw new TRPCError({ code: "NOT_FOUND" });
    requireGroup(ctx.auth, project.groupId);
    // 帶出參考圖網址：left join 素材表——素材進回收桶就回 null，卡片縮圖自動消失
    return db
      .select({ ...getTableColumns(schema.propCards), referenceUrl: schema.assets.url })
      .from(schema.propCards)
      .leftJoin(
        schema.assets,
        and(eq(schema.assets.id, schema.propCards.referenceAssetId), isNull(schema.assets.deletedAt)),
      )
      .where(eq(schema.propCards.projectId, input.projectId))
      .orderBy(asc(schema.propCards.createdAt));
  }),

  add: authedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        name: z.string().trim().min(1, "請填物件名").max(PROP_NAME_MAX),
        appearance: z.string().trim().min(1, "請填外觀").max(PROP_APPEARANCE_MAX),
        notes: z.string().trim().max(PROP_NOTES_MAX).optional(),
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
      // 跨組引用驗證：referenceAssetId 必須同組且是圖片
      if (input.referenceAssetId) await assertReferenceImage(input.referenceAssetId, project.groupId);

      if (input.clientRequestId) {
        const [existing] = await db
          .select()
          .from(schema.propCards)
          .where(and(eq(schema.propCards.id, input.clientRequestId), eq(schema.propCards.projectId, project.id)));
        if (existing) return existing;
      }

      const [{ n }] = await db
        .select({ n: count() })
        .from(schema.propCards)
        .where(eq(schema.propCards.projectId, project.id));
      if (Number(n) >= MAX_PROJECT_PROPS) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `此專案物件卡已達上限（${MAX_PROJECT_PROPS} 張）——先刪不用的再新增`,
        });
      }

      try {
        const [row] = await db
          .insert(schema.propCards)
          .values({
            id: input.clientRequestId,
            projectId: project.id,
            groupId: project.groupId,
            name: input.name,
            appearance: input.appearance,
            notes: input.notes || null,
            referenceAssetId: input.referenceAssetId,
            createdBy: ctx.auth.user.id,
          })
          .returning();
        return row;
      } catch (err) {
        // 冪等重送撞唯一鍵＝前次請求已建卡（client timeout 後重試）：回既有卡，不重複建立
        if (input.clientRequestId && isUniqueViolation(err)) {
          const [existing] = await db
            .select()
            .from(schema.propCards)
            .where(and(eq(schema.propCards.id, input.clientRequestId), eq(schema.propCards.projectId, project.id)));
          if (existing) return existing;
        }
        throw err;
      }
    }),

  update: authedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().trim().min(1, "請填物件名").max(PROP_NAME_MAX).optional(),
        appearance: z.string().trim().min(1, "請填外觀").max(PROP_APPEARANCE_MAX).optional(),
        notes: z.string().trim().max(PROP_NOTES_MAX).nullable().optional(),
        referenceAssetId: z.string().uuid().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [row] = await db.select().from(schema.propCards).where(eq(schema.propCards.id, input.id));
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      requireGroup(ctx.auth, row.groupId);
      await (await import("../services/projectAcl")).assertProjectEditable(ctx.auth, { id: row.projectId, groupId: row.groupId }); // 2.3
      if (input.referenceAssetId) await assertReferenceImage(input.referenceAssetId, row.groupId);

      // partial update：只 set 有傳入的欄位（防 lost update）
      const patch: {
        name?: string;
        appearance?: string;
        notes?: string | null;
        referenceAssetId?: string | null;
      } = {};
      if (input.name !== undefined) patch.name = input.name;
      if (input.appearance !== undefined) patch.appearance = input.appearance;
      if (input.notes !== undefined) patch.notes = input.notes || null;
      if (input.referenceAssetId !== undefined) patch.referenceAssetId = input.referenceAssetId;
      if (Object.keys(patch).length === 0) return row;

      const [updated] = await db
        .update(schema.propCards)
        .set(patch)
        .where(eq(schema.propCards.id, input.id))
        .returning();
      return updated;
    }),

  remove: authedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const [row] = await db.select().from(schema.propCards).where(eq(schema.propCards.id, input.id));
    if (!row) throw new TRPCError({ code: "NOT_FOUND" });
    requireGroup(ctx.auth, row.groupId);
    await (await import("../services/projectAcl")).assertProjectEditable(ctx.auth, { id: row.projectId, groupId: row.groupId }); // 2.3
    await db.delete(schema.propCards).where(eq(schema.propCards.id, input.id));
    return { ok: true };
  }),
});
