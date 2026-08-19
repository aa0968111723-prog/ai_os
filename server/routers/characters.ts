import { z } from "zod";
import { and, asc, desc, eq, getTableColumns, inArray, isNull, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  CHAR_APPEARANCE_MAX,
  CHAR_NAME_MAX,
  CHAR_NOTES_MAX,
  MAX_PROJECT_CHARACTERS,
} from "../../shared/cardLimits";
import { router, authedProcedure, requireGroup } from "../trpc";
import { db, schema } from "../db";
import { assertReferenceImage } from "../services/referenceAsset";
import { applyWithRevisionTrpc } from "../services/revisionGuard";
import { isInstructionCharacterName, sanitizeCharacterProposalName } from "../../shared/assistantCharacterPropose";
import { applyXiaohuaIdentityLock } from "../../shared/characterIdentityLock";
import { upsertProjectCharacterCore } from "../services/characterWriteCore";
import {
  CHARACTER_SHEET_MODEL_ID,
  characterSheetPrompt,
  isAllowedCharacterSheetModel,
} from "../../shared/characterSheetGenerate";
import { executeGenerationCommand } from "../services/generationCommand";

/** @deprecated 請直接 import from services/cardAnchors；保留 re-export 相容舊路徑 */
export { buildCharacterAnchor } from "../services/cardAnchors";

export { MAX_PROJECT_CHARACTERS };

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
        // Raw paste may be the model blob「小華（…）。不要寫素材清單」.
        // Sanitize down to a card name; CHAR_NAME_MAX still applies after.
        name: z.string().trim().min(1, "請填角色名").max(240),
        appearance: z.string().trim().min(1, "請填外觀設定").max(CHAR_APPEARANCE_MAX),
        notes: z.string().trim().max(CHAR_NOTES_MAX).optional(),
        referenceAssetId: z.string().uuid().optional(),
        /** 冪等鍵（client 產生的 UUID）：timeout 後重送同鍵回原卡片，不重複建立 */
        clientRequestId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, input.projectId));
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      requireGroup(ctx.auth, project.groupId);
      await (await import("../services/projectAcl")).assertProjectEditable(ctx.auth, project); // 2.3：檢視者不能改卡片
      const name = sanitizeCharacterProposalName(input.name);
      if (!name) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "這是指示句，不是角色名" });
      }
      // 跨專案引用驗證：referenceAssetId 必須同專案且是圖片（同組兩個「小華」不能互綁定裝圖）
      if (input.referenceAssetId) await assertReferenceImage(input.referenceAssetId, project.groupId, project.id);

      // 冪等重送：若 clientRequestId 已存在本專案卡，直接回既有（不佔新上限名額）
      if (input.clientRequestId) {
        const [existing] = await db
          .select()
          .from(schema.characters)
          .where(and(eq(schema.characters.id, input.clientRequestId), eq(schema.characters.projectId, project.id)));
        if (existing) return existing;
      }

      const written = await upsertProjectCharacterCore({
        auth: ctx.auth,
        groupId: project.groupId,
        projectId: project.id,
        name,
        appearance: input.appearance,
        notes: input.notes,
      });
      if (input.referenceAssetId) {
        await db
          .update(schema.characters)
          .set({ referenceAssetId: input.referenceAssetId })
          .where(eq(schema.characters.id, written.characterId));
      }
      const [row] = await db
        .select()
        .from(schema.characters)
        .where(and(eq(schema.characters.id, written.characterId), eq(schema.characters.projectId, project.id)));
      if (!row) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "角色定裝寫入後讀回失敗" });
      }
      return row;
    }),

  update: authedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().trim().min(1, "請填角色名").max(CHAR_NAME_MAX).optional(),
        appearance: z.string().trim().min(1, "請填外觀設定").max(CHAR_APPEARANCE_MAX).optional(),
        notes: z.string().trim().max(CHAR_NOTES_MAX).nullable().optional(),
        referenceAssetId: z.string().uuid().nullable().optional(),
        /** 樂觀併發（shared/revision.ts）：載入時的 rev；不給＝維持舊行為 */
        expectedRev: z.number().int().min(0).optional(),
        /** 載入時這些欄位的原值——rev 撞了但欄位沒撞時據此自動合併 */
        baseline: z.record(z.unknown()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [row] = await db.select().from(schema.characters).where(eq(schema.characters.id, input.id));
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      requireGroup(ctx.auth, row.groupId);
      await (await import("../services/projectAcl")).assertProjectEditable(ctx.auth, { id: row.projectId, groupId: row.groupId }); // 2.3
      if (input.name !== undefined && isInstructionCharacterName(input.name)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "這是指示句，不是角色名" });
      }
      // 跨專案引用驗證：改綁 referenceAssetId 時同樣要同專案且是圖片（null＝清除引用，免驗）
      if (input.referenceAssetId) await assertReferenceImage(input.referenceAssetId, row.groupId, row.projectId);

      // partial update：只 set 有傳入的欄位，避免 A 改 name、B 改 appearance 時讀後寫互相覆蓋
      const patch: {
        name?: string;
        appearance?: string;
        notes?: string | null;
        referenceAssetId?: string | null;
      } = {};
      if (input.name !== undefined) patch.name = input.name;
      if (input.appearance !== undefined) patch.appearance = input.appearance;
      const nextName = patch.name ?? row.name;
      const nextAppearance = patch.appearance ?? row.appearance;
      if (nextName && nextAppearance && (input.name !== undefined || input.appearance !== undefined)) {
        const [story] = await db
          .select({ content: schema.stories.content })
          .from(schema.stories)
          .where(eq(schema.stories.projectId, row.projectId))
          .limit(1);
        const [project] = await db
          .select({ title: schema.projects.title })
          .from(schema.projects)
          .where(eq(schema.projects.id, row.projectId))
          .limit(1);
        const locked = applyXiaohuaIdentityLock(
          { name: nextName, appearance: nextAppearance, costume: null },
          `${nextAppearance}\n${story?.content ?? ""}\n${project?.title ?? ""}`,
        );
        if (input.name !== undefined) patch.name = locked.name;
        patch.appearance = locked.appearance ?? nextAppearance;
      }
      if (input.notes !== undefined) patch.notes = input.notes || null;
      if (input.referenceAssetId !== undefined) patch.referenceAssetId = input.referenceAssetId;
      if (Object.keys(patch).length === 0) return row;

      // 條件寫入（見 services/revisionGuard）：partial patch 已避免「整份寫回」，
      // 但兩人同時改**同一欄**仍會靜默覆蓋——rev 這一關才擋得住那一種。
      const { row: updated, merged } = await applyWithRevisionTrpc({
        entity: "character",
        table: schema.characters,
        idColumn: schema.characters.id,
        revColumn: schema.characters.rev,
        row,
        patch,
        expectedRev: input.expectedRev,
        baseline: input.baseline,
        reload: async () => {
          const [fresh] = await db.select().from(schema.characters).where(eq(schema.characters.id, input.id));
          return fresh;
        },
      });
      await (await import("../services/shotContextPackets")).refreshShotContextStalenessSafely({
        auth: ctx.auth,
        projectId: row.projectId,
        changed: { kind: "character", id: row.id },
      });
      return { ...updated, merged };
    }),

  /**
   * Cheap-image 定裝圖：只走 schnell / sdxl / qwen 等級，禁止 Veo。
   * 0 own sheets 仍用文字鎖定出圖；完成後 honorGeneratedSheet 才綁回這張卡。
   */
  generateSheet: authedProcedure
    .input(
      z.object({
        characterId: z.string().uuid(),
        modelId: z.string().optional(),
        clientRequestId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [row] = await db.select().from(schema.characters).where(eq(schema.characters.id, input.characterId));
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      requireGroup(ctx.auth, row.groupId);
      const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, row.projectId));
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      await (await import("../services/projectAcl")).assertProjectEditable(ctx.auth, project);
      const modelId = input.modelId ?? CHARACTER_SHEET_MODEL_ID;
      if (!isAllowedCharacterSheetModel(modelId)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "定裝圖只用便宜生圖模型，不能用 Veo 或影片" });
      }
      const [story] = await db
        .select({ content: schema.stories.content })
        .from(schema.stories)
        .where(eq(schema.stories.projectId, project.id))
        .limit(1);
      const locked = applyXiaohuaIdentityLock(
        { name: row.name, appearance: row.appearance, costume: null },
        `${row.appearance}\n${story?.content ?? ""}\n${project.title}`,
      );
      const prompt = characterSheetPrompt(locked.name, locked.appearance ?? row.appearance);
      const generation = await executeGenerationCommand({
        auth: ctx.auth,
        source: "web",
        id: input.clientRequestId,
        projectId: project.id,
        modelId,
        prompt,
      });
      return { generationId: generation.id, modelId, characterId: row.id };
    }),

  honorGeneratedSheet: authedProcedure
    .input(z.object({
      characterId: z.string().uuid(),
      generationId: z.string().uuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await db.select().from(schema.characters).where(eq(schema.characters.id, input.characterId));
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      requireGroup(ctx.auth, row.groupId);
      await (await import("../services/projectAcl")).assertProjectEditable(ctx.auth, { id: row.projectId, groupId: row.groupId });
      const [gen] = await db.select().from(schema.generations).where(eq(schema.generations.id, input.generationId));
      if (!gen || gen.projectId !== row.projectId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "找不到這次定裝生成" });
      }
      const [asset] = await db
        .select({ id: schema.assets.id })
        .from(schema.assets)
        .where(and(
          eq(schema.assets.projectId, row.projectId),
          isNull(schema.assets.deletedAt),
          sql`${schema.assets.meta}->>'generationId' = ${gen.id}`,
        ))
        .orderBy(desc(schema.assets.createdAt))
        .limit(1);
      if (!asset) throw new TRPCError({ code: "NOT_FOUND", message: "這次定裝生成還沒有成品圖" });
      await assertReferenceImage(asset.id, row.groupId, row.projectId);
      const [updated] = await db
        .update(schema.characters)
        .set({ referenceAssetId: asset.id, rev: sql`${schema.characters.rev} + 1` })
        .where(eq(schema.characters.id, row.id))
        .returning();
      return updated;
    }),

  remove: authedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const [row] = await db.select().from(schema.characters).where(eq(schema.characters.id, input.id));
    if (!row) throw new TRPCError({ code: "NOT_FOUND" });
    requireGroup(ctx.auth, row.groupId);
    await (await import("../services/projectAcl")).assertProjectEditable(ctx.auth, { id: row.projectId, groupId: row.groupId }); // 2.3
    const { stripCardIdsFromProjectScenes } = await import("../services/sceneEntityIds");
    await db.transaction(async (tx) => {
      const looks = await tx
        .select({ id: schema.characterLooks.id })
        .from(schema.characterLooks)
        .where(and(eq(schema.characterLooks.projectId, row.projectId), eq(schema.characterLooks.characterId, row.id)));
      const lookIds = looks.map((look) => look.id);
      await stripCardIdsFromProjectScenes(tx, row.projectId, {
        characterIds: [row.id],
        lookIds,
      });
      if (lookIds.length) {
        await tx.delete(schema.characterLooks).where(inArray(schema.characterLooks.id, lookIds));
      }
      await tx.delete(schema.characters).where(eq(schema.characters.id, row.id));
    });
    return { ok: true };
  }),
});
