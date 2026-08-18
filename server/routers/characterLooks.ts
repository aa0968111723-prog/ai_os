/**
 * 造型（CharacterLook；PE 計畫 §07/§08）：可變外觀與固定 Identity 分層。
 * 「三年後她剪短髮」建新 Look 而非覆蓋 characters.appearance——跨鏡一致性不被時間線污染。
 * ACL 慣例同 characters：載卡 → requireGroup(row.groupId) → 寫入再 assertProjectEditable。
 */
import { z } from "zod";
import { and, asc, count, eq, isNull, getTableColumns } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure, requireGroup } from "../trpc";
import { db, schema } from "../db";
import { assertProjectEditable } from "../services/projectAcl";
import { assertReferenceImage } from "../services/referenceAsset";
import { LOOK_COSTUME_MAX, LOOK_NAME_MAX, MAX_PROJECT_LOOKS } from "../../shared/story";
import { applyWithRevision } from "../services/revisionGuard";

export const characterLooksRouter = router({
  list: authedProcedure.input(z.object({ projectId: z.string().uuid() })).query(async ({ ctx, input }) => {
    const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, input.projectId));
    if (!project) throw new TRPCError({ code: "NOT_FOUND" });
    requireGroup(ctx.auth, project.groupId);
    return db
      .select({ ...getTableColumns(schema.characterLooks), referenceUrl: schema.assets.url })
      .from(schema.characterLooks)
      .leftJoin(
        schema.assets,
        and(eq(schema.assets.id, schema.characterLooks.referenceAssetId), isNull(schema.assets.deletedAt)),
      )
      .where(eq(schema.characterLooks.projectId, input.projectId))
      .orderBy(asc(schema.characterLooks.createdAt));
  }),

  add: authedProcedure
    .input(
      z.object({
        characterId: z.string().uuid(),
        name: z.string().trim().min(1, "請填造型名").max(LOOK_NAME_MAX),
        costume: z.string().trim().max(LOOK_COSTUME_MAX).optional(),
        notes: z.string().trim().max(500).optional(),
        referenceAssetId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [owner] = await db.select().from(schema.characters).where(eq(schema.characters.id, input.characterId));
      if (!owner) throw new TRPCError({ code: "NOT_FOUND", message: "找不到角色" });
      requireGroup(ctx.auth, owner.groupId);
      await assertProjectEditable(ctx.auth, { id: owner.projectId, groupId: owner.groupId });
      if (input.referenceAssetId) await assertReferenceImage(input.referenceAssetId, owner.groupId);

      const [{ n }] = await db
        .select({ n: count() })
        .from(schema.characterLooks)
        .where(eq(schema.characterLooks.projectId, owner.projectId));
      if (Number(n) >= MAX_PROJECT_LOOKS) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `此專案造型已達上限（${MAX_PROJECT_LOOKS} 個）——先刪不用的再新增` });
      }

      const [row] = await db
        .insert(schema.characterLooks)
        .values({
          projectId: owner.projectId,
          groupId: owner.groupId,
          characterId: owner.id,
          name: input.name,
          costume: input.costume || null,
          notes: input.notes || null,
          referenceAssetId: input.referenceAssetId,
          source: "manual",
          createdBy: ctx.auth.user.id,
        })
        .returning();
      return row;
    }),

  update: authedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().trim().min(1).max(LOOK_NAME_MAX).optional(),
        costume: z.string().trim().max(LOOK_COSTUME_MAX).nullable().optional(),
        notes: z.string().trim().max(500).nullable().optional(),
        referenceAssetId: z.string().uuid().nullable().optional(),
        /** 樂觀併發（shared/revision.ts）：載入時的 rev；不給＝維持舊行為 */
        expectedRev: z.number().int().min(0).optional(),
        /** 載入時這些欄位的原值——rev 撞了但欄位沒撞時據此自動合併 */
        baseline: z.record(z.unknown()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [row] = await db.select().from(schema.characterLooks).where(eq(schema.characterLooks.id, input.id));
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      requireGroup(ctx.auth, row.groupId);
      await assertProjectEditable(ctx.auth, { id: row.projectId, groupId: row.groupId });
      if (input.referenceAssetId) await assertReferenceImage(input.referenceAssetId, row.groupId);

      const patch: { name?: string; costume?: string | null; notes?: string | null; referenceAssetId?: string | null } = {};
      if (input.name !== undefined) patch.name = input.name;
      if (input.costume !== undefined) patch.costume = input.costume || null;
      if (input.notes !== undefined) patch.notes = input.notes || null;
      if (input.referenceAssetId !== undefined) patch.referenceAssetId = input.referenceAssetId;
      if (Object.keys(patch).length === 0) return row;

      const { row: updated, merged } = await applyWithRevision({
        entity: "characterLook",
        table: schema.characterLooks,
        idColumn: schema.characterLooks.id,
        revColumn: schema.characterLooks.rev,
        row,
        patch,
        expectedRev: input.expectedRev,
        baseline: input.baseline,
        reload: async () => {
          const [fresh] = await db.select().from(schema.characterLooks).where(eq(schema.characterLooks.id, input.id));
          return fresh;
        },
      });
      await (await import("../services/shotContextPackets")).refreshShotContextStalenessSafely({
        auth: ctx.auth,
        projectId: row.projectId,
        changed: { kind: "character_look", id: row.id },
      });
      return { ...updated, merged };
    }),

  remove: authedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const [row] = await db.select().from(schema.characterLooks).where(eq(schema.characterLooks.id, input.id));
    if (!row) throw new TRPCError({ code: "NOT_FOUND" });
    requireGroup(ctx.auth, row.groupId);
    await assertProjectEditable(ctx.auth, { id: row.projectId, groupId: row.groupId });
    await db.delete(schema.characterLooks).where(eq(schema.characterLooks.id, input.id));
    return { ok: true };
  }),
});
