import { z } from "zod";
import { and, asc, count, eq, getTableColumns, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  MAX_PROJECT_PROPS,
  PROP_APPEARANCE_MAX,
  PROP_NAME_MAX,
  PROP_NOTES_MAX,
} from "../../shared/cardLimits";
import { PROP_OWNER_KINDS, type PropOwnerKind } from "../../shared/propOwnership";
import { router, authedProcedure, requireGroup } from "../trpc";
import { db, schema } from "../db";
import { assertReferenceImage } from "../services/referenceAsset";
import { isUniqueViolation } from "../services/generationCore";

export { MAX_PROJECT_PROPS };

/** 歸屬輸入：兩欄同進同出（都給＝掛主人、都不給＝獨立物件、只給一個＝擋下） */
const ownerInput = {
  ownerKind: z.enum(PROP_OWNER_KINDS).nullable().optional(),
  ownerId: z.string().uuid().nullable().optional(),
};

/**
 * 歸屬校驗：主人必須是本專案的角色卡／場景卡。
 * 回傳要寫進 DB 的兩欄（null＝清除歸屬）；undefined＝呼叫端沒傳、不動既有值。
 */
async function resolveOwnerPatch(
  projectId: string,
  input: { ownerKind?: PropOwnerKind | null; ownerId?: string | null },
): Promise<{ ownerKind: PropOwnerKind | null; ownerId: string | null } | undefined> {
  if (input.ownerKind === undefined && input.ownerId === undefined) return undefined;
  const kind = input.ownerKind ?? null;
  const id = input.ownerId ?? null;
  // 清除歸屬：兩欄一起清，不留半截（半截狀態會讓自動帶入永遠對不上主人）
  if (!kind && !id) return { ownerKind: null, ownerId: null };
  if (!kind || !id) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "歸屬要嘛完整指定角色／場景卡，要嘛清空" });
  }
  const table = kind === "character" ? schema.characters : schema.scenePresets;
  const [owner] = await db
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.id, id), eq(table.projectId, projectId)));
  if (!owner) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: kind === "character" ? "找不到這張角色定裝卡（不屬於本專案）" : "找不到這張場景設定卡（不屬於本專案）",
    });
  }
  return { ownerKind: kind, ownerId: id };
}

/**
 * 素材設定卡（道具／標誌物件一致性）：與角色定裝卡、場景設定卡同一套規則
 * ——同組隔離、檢視者唯讀、冪等建立、參考圖跨組驗證、每專案張數上限。
 * 另可掛歸屬：某角色的隨身物品／某場景的場上物件（勾主人就自動帶入，見 shared/propOwnership.ts）。
 */
export const propsRouter = router({
  list: authedProcedure.input(z.object({ projectId: z.string().uuid() })).query(async ({ ctx, input }) => {
    const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, input.projectId));
    if (!project) throw new TRPCError({ code: "NOT_FOUND" });
    requireGroup(ctx.auth, project.groupId);
    // 帶出參考圖網址（referenceUrl）：left join 素材表——素材進回收桶就回 null，卡片縮圖自動消失
    // 再 left join 主人卡取名字（ownerName）：卡片上要顯示「安倢的紅傘」，主人被刪掉就回 null
    const rows = await db
      .select({
        ...getTableColumns(schema.props),
        referenceUrl: schema.assets.url,
        ownerCharacterName: schema.characters.name,
        ownerSceneName: schema.scenePresets.name,
      })
      .from(schema.props)
      .leftJoin(
        schema.assets,
        and(eq(schema.assets.id, schema.props.referenceAssetId), isNull(schema.assets.deletedAt)),
      )
      .leftJoin(
        schema.characters,
        and(eq(schema.characters.id, schema.props.ownerId), eq(schema.props.ownerKind, "character")),
      )
      .leftJoin(
        schema.scenePresets,
        and(eq(schema.scenePresets.id, schema.props.ownerId), eq(schema.props.ownerKind, "scene")),
      )
      .where(eq(schema.props.projectId, input.projectId))
      .orderBy(asc(schema.props.createdAt));
    return rows.map(({ ownerCharacterName, ownerSceneName, ...row }) => ({
      ...row,
      // 主人卡被刪 → ownerName 為 null，UI 顯示「主人已刪除」而不是靜默裝作獨立物件
      ownerName: row.ownerKind === "character" ? ownerCharacterName : row.ownerKind === "scene" ? ownerSceneName : null,
    }));
  }),

  add: authedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        // 先 trim 再驗：否則 "   " 通過 min(1) 後再 trim 成空字串入庫
        name: z.string().trim().min(1, "請填素材名").max(PROP_NAME_MAX),
        appearance: z.string().trim().min(1, "請填外觀・材質").max(PROP_APPEARANCE_MAX),
        notes: z.string().trim().max(PROP_NOTES_MAX).optional(),
        referenceAssetId: z.string().uuid().optional(),
        ...ownerInput,
        /** 冪等鍵（client 產生的 UUID，當 row id 用）：timeout 後重送同鍵回原卡片，不重複建立 */
        clientRequestId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, input.projectId));
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      requireGroup(ctx.auth, project.groupId);
      await (await import("../services/projectAcl")).assertProjectEditable(ctx.auth, project); // 2.3：檢視者不能改卡片
      // 跨組引用驗證：referenceAssetId 必須同組且是圖片（比照 characters／scenePresets）
      if (input.referenceAssetId) await assertReferenceImage(input.referenceAssetId, project.groupId);
      const owner = await resolveOwnerPatch(project.id, input);

      if (input.clientRequestId) {
        const [existing] = await db
          .select()
          .from(schema.props)
          .where(and(eq(schema.props.id, input.clientRequestId), eq(schema.props.projectId, project.id)));
        if (existing) return existing;
      }

      const [{ n }] = await db
        .select({ n: count() })
        .from(schema.props)
        .where(eq(schema.props.projectId, project.id));
      if (Number(n) >= MAX_PROJECT_PROPS) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `此專案素材設定已達上限（${MAX_PROJECT_PROPS} 張）——先刪不用的再新增`,
        });
      }

      try {
        const [row] = await db
          .insert(schema.props)
          .values({
            id: input.clientRequestId,
            projectId: project.id,
            groupId: project.groupId,
            name: input.name,
            appearance: input.appearance,
            notes: input.notes || null,
            referenceAssetId: input.referenceAssetId,
            ownerKind: owner?.ownerKind ?? null,
            ownerId: owner?.ownerId ?? null,
            createdBy: ctx.auth.user.id,
          })
          .returning();
        return row;
      } catch (err) {
        // 冪等重送撞唯一鍵＝前次請求已建卡（client timeout 後重試）：回既有卡，不重複建立
        if (input.clientRequestId && isUniqueViolation(err)) {
          const [existing] = await db
            .select()
            .from(schema.props)
            .where(and(eq(schema.props.id, input.clientRequestId), eq(schema.props.projectId, project.id)));
          if (existing) return existing;
        }
        throw err;
      }
    }),

  update: authedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().trim().min(1, "請填素材名").max(PROP_NAME_MAX).optional(),
        appearance: z.string().trim().min(1, "請填外觀・材質").max(PROP_APPEARANCE_MAX).optional(),
        notes: z.string().trim().max(PROP_NOTES_MAX).nullable().optional(),
        referenceAssetId: z.string().uuid().nullable().optional(),
        ...ownerInput,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [row] = await db.select().from(schema.props).where(eq(schema.props.id, input.id));
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      requireGroup(ctx.auth, row.groupId);
      await (await import("../services/projectAcl")).assertProjectEditable(ctx.auth, { id: row.projectId, groupId: row.groupId }); // 2.3
      // 跨組引用驗證：改綁 referenceAssetId 時同樣要同組且是圖片（null＝清除引用，免驗）
      if (input.referenceAssetId) await assertReferenceImage(input.referenceAssetId, row.groupId);
      const owner = await resolveOwnerPatch(row.projectId, input);

      // partial update：只 set 有傳入的欄位（與角色／場景卡同口徑，防 lost update）
      const patch: {
        name?: string;
        appearance?: string;
        notes?: string | null;
        referenceAssetId?: string | null;
        ownerKind?: PropOwnerKind | null;
        ownerId?: string | null;
      } = {};
      if (input.name !== undefined) patch.name = input.name;
      if (input.appearance !== undefined) patch.appearance = input.appearance;
      if (input.notes !== undefined) patch.notes = input.notes || null;
      if (input.referenceAssetId !== undefined) patch.referenceAssetId = input.referenceAssetId;
      if (owner) {
        patch.ownerKind = owner.ownerKind;
        patch.ownerId = owner.ownerId;
      }
      if (Object.keys(patch).length === 0) return row;

      const [updated] = await db.update(schema.props).set(patch).where(eq(schema.props.id, input.id)).returning();
      return updated;
    }),

  remove: authedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const [row] = await db.select().from(schema.props).where(eq(schema.props.id, input.id));
    if (!row) throw new TRPCError({ code: "NOT_FOUND" });
    requireGroup(ctx.auth, row.groupId);
    await (await import("../services/projectAcl")).assertProjectEditable(ctx.auth, { id: row.projectId, groupId: row.groupId }); // 2.3
    await db.delete(schema.props).where(eq(schema.props.id, input.id));
    return { ok: true };
  }),
});
