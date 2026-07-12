import { z } from "zod";
import { and, desc, eq, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure, requireGroup } from "../trpc";
import { db, schema } from "../db";
import { worldviewSchema } from "../../shared/worldview";
import { PLATFORMS } from "../../shared/models";
import { removeStoredFile } from "../services/storage";

export const projectsRouter = router({
  /** 列出指定組的專案（未指定 → 所有我可見的組）；隔離由 requireGroup／成員組清單保證 */
  list: authedProcedure
    .input(z.object({ groupId: z.string().uuid().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const groupIds = input?.groupId
        ? [requireGroup(ctx.auth, input.groupId) && input.groupId]
        : ctx.auth.groups.map((g) => g.groupId);
      if (groupIds.length === 0) return [];
      return db
        .select()
        .from(schema.projects)
        .where(inArray(schema.projects.groupId, groupIds as string[]))
        .orderBy(desc(schema.projects.updatedAt));
    }),

  create: authedProcedure
    .input(
      z.object({
        groupId: z.string().uuid(),
        title: z.string().min(1, "請填專案名稱"),
        kind: z.string().min(1),
        platform: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requireGroup(ctx.auth, input.groupId);
      const platform = PLATFORMS.find((p) => p.id === input.platform);
      if (!platform) throw new TRPCError({ code: "BAD_REQUEST", message: "未知平台" });
      const [project] = await db
        .insert(schema.projects)
        .values({
          groupId: input.groupId,
          ownerId: ctx.auth.user.id,
          title: input.title,
          kind: input.kind,
          platform: input.platform,
          format: platform.format,
          worldview: worldviewSchema.parse({}),
        })
        .returning();
      return project;
    }),

  get: authedProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ ctx, input }) => {
    const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, input.id));
    if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "找不到專案" });
    requireGroup(ctx.auth, project.groupId); // 多組隔離
    return project;
  }),

  /** 專案素材庫(生成成品;供「來源輸入」挑選與素材總覽) */
  assets: authedProcedure.input(z.object({ projectId: z.string().uuid() })).query(async ({ ctx, input }) => {
    const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, input.projectId));
    if (!project) throw new TRPCError({ code: "NOT_FOUND" });
    requireGroup(ctx.auth, project.groupId);
    return db
      .select()
      .from(schema.assets)
      .where(eq(schema.assets.projectId, input.projectId))
      .orderBy(desc(schema.assets.createdAt))
      .limit(100);
  }),

  /** 刪除素材（上傳者本人或組長以上）——同時清掉引用它的分鏡格與 Volume 檔案 */
  deleteAsset: authedProcedure.input(z.object({ assetId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const [asset] = await db.select().from(schema.assets).where(eq(schema.assets.id, input.assetId));
    if (!asset) throw new TRPCError({ code: "NOT_FOUND", message: "找不到素材" });
    const role = requireGroup(ctx.auth, asset.groupId);
    const isUploader = asset.uploadedBy === ctx.auth.user.id;
    if (!isUploader && role === "member") {
      throw new TRPCError({ code: "FORBIDDEN", message: "只有上傳者本人或組長以上可以刪除素材" });
    }
    await db.update(schema.scenes).set({ assetId: null }).where(eq(schema.scenes.assetId, asset.id));
    await db.delete(schema.assets).where(eq(schema.assets.id, asset.id));
    if (asset.storagePath) await removeStoredFile(asset.storagePath);
    return { ok: true };
  }),

  /** 素材改名（整理雜亂素材用） */
  renameAsset: authedProcedure
    .input(z.object({ assetId: z.string().uuid(), title: z.string().min(1, "請填名稱").max(80) }))
    .mutation(async ({ ctx, input }) => {
      const [asset] = await db.select().from(schema.assets).where(eq(schema.assets.id, input.assetId));
      if (!asset) throw new TRPCError({ code: "NOT_FOUND", message: "找不到素材" });
      requireGroup(ctx.auth, asset.groupId);
      const [updated] = await db
        .update(schema.assets)
        .set({ title: input.title })
        .where(eq(schema.assets.id, input.assetId))
        .returning();
      return updated;
    }),

  updateWorldview: authedProcedure
    // partial patch：只送有改的欄位，伺服器端與現值合併。
    // 舊版前端送整包 {...wv, field}，快速連改不同欄位時後一次會用「上一次 render 的舊 wv」覆蓋掉前一次的變更（資料遺失）。
    .input(z.object({ id: z.string().uuid(), worldview: worldviewSchema.partial() }))
    .mutation(async ({ ctx, input }) => {
      const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, input.id));
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      requireGroup(ctx.auth, project.groupId);
      const current = worldviewSchema.parse(project.worldview ?? {});
      const merged = worldviewSchema.parse({ ...current, ...input.worldview });
      const [updated] = await db
        .update(schema.projects)
        .set({ worldview: merged, updatedAt: new Date() })
        .where(eq(schema.projects.id, input.id))
        .returning();
      return updated;
    }),
});
