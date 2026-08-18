import { z } from "zod";
import { and, asc, count, eq, getTableColumns, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  MAX_PROJECT_SCENE_PRESETS,
  SCENE_LIGHTING_MAX,
  SCENE_NAME_MAX,
  SCENE_PALETTE_MAX,
} from "../../shared/cardLimits";
import { router, authedProcedure, requireGroup } from "../trpc";
import { db, schema } from "../db";
import { assertReferenceImage } from "../services/referenceAsset";
import { isUniqueViolation } from "../services/generationCore";
import { applyWithRevisionTrpc } from "../services/revisionGuard";

/** @deprecated 請直接 import from services/cardAnchors；保留 re-export 相容舊路徑 */
export { buildSceneAnchor } from "../services/cardAnchors";

export { MAX_PROJECT_SCENE_PRESETS };

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
        // 先 trim 再驗：與角色定裝卡同口徑，避免空白字串入庫
        name: z.string().trim().min(1, "請填場景名").max(SCENE_NAME_MAX),
        palette: z.string().trim().min(1, "請填色板").max(SCENE_PALETTE_MAX),
        lighting: z.string().trim().max(SCENE_LIGHTING_MAX).optional(),
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
      if (input.referenceAssetId) await assertReferenceImage(input.referenceAssetId, project.groupId, project.id);

      if (input.clientRequestId) {
        const [existing] = await db
          .select()
          .from(schema.scenePresets)
          .where(and(eq(schema.scenePresets.id, input.clientRequestId), eq(schema.scenePresets.projectId, project.id)));
        if (existing) return existing;
      }

      const [{ n }] = await db
        .select({ n: count() })
        .from(schema.scenePresets)
        .where(eq(schema.scenePresets.projectId, project.id));
      if (Number(n) >= MAX_PROJECT_SCENE_PRESETS) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `此專案場景設定已達上限（${MAX_PROJECT_SCENE_PRESETS} 張）——先刪不用的再新增`,
        });
      }

      try {
        const [row] = await db
          .insert(schema.scenePresets)
          .values({
            id: input.clientRequestId,
            projectId: project.id,
            groupId: project.groupId,
            name: input.name,
            palette: input.palette,
            lighting: input.lighting || null,
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
        name: z.string().trim().min(1, "請填場景名").max(SCENE_NAME_MAX).optional(),
        palette: z.string().trim().min(1, "請填色板").max(SCENE_PALETTE_MAX).optional(),
        lighting: z.string().trim().max(SCENE_LIGHTING_MAX).nullable().optional(),
        referenceAssetId: z.string().uuid().nullable().optional(),
        /** 樂觀併發（shared/revision.ts）：載入時的 rev；不給＝維持舊行為 */
        expectedRev: z.number().int().min(0).optional(),
        /** 載入時這些欄位的原值——rev 撞了但欄位沒撞時據此自動合併 */
        baseline: z.record(z.unknown()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [row] = await db.select().from(schema.scenePresets).where(eq(schema.scenePresets.id, input.id));
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      requireGroup(ctx.auth, row.groupId);
      await (await import("../services/projectAcl")).assertProjectEditable(ctx.auth, { id: row.projectId, groupId: row.groupId }); // 2.3
      // 跨組引用驗證：改綁 referenceAssetId 時同樣要同組且是圖片（null＝清除引用，免驗）
      if (input.referenceAssetId) await assertReferenceImage(input.referenceAssetId, row.groupId, row.projectId);

      // partial update：只 set 有傳入的欄位（與角色定裝同口徑，防 lost update）
      const patch: {
        name?: string;
        palette?: string;
        lighting?: string | null;
        referenceAssetId?: string | null;
      } = {};
      if (input.name !== undefined) patch.name = input.name;
      if (input.palette !== undefined) patch.palette = input.palette;
      if (input.lighting !== undefined) patch.lighting = input.lighting || null;
      if (input.referenceAssetId !== undefined) patch.referenceAssetId = input.referenceAssetId;
      if (Object.keys(patch).length === 0) return row;

      const { row: updated, merged } = await applyWithRevisionTrpc({
        entity: "scenePreset",
        table: schema.scenePresets,
        idColumn: schema.scenePresets.id,
        revColumn: schema.scenePresets.rev,
        row,
        patch,
        expectedRev: input.expectedRev,
        baseline: input.baseline,
        reload: async () => {
          const [fresh] = await db.select().from(schema.scenePresets).where(eq(schema.scenePresets.id, input.id));
          return fresh;
        },
      });
      await (await import("../services/shotContextPackets")).refreshShotContextStalenessSafely({
        auth: ctx.auth,
        projectId: row.projectId,
        changed: { kind: "scene_preset", id: row.id },
      });
      return { ...updated, merged };
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
