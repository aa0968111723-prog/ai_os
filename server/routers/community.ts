/**
 * Community / 靈感頻道 router（Flow-TV 風格）
 *
 * PR1：publishFromSource / unpublish / listPublic / get / recordUse / myPosts
 * 之後 PR：like、remixToProject、channel 篩選、完整設定卡 snapshot
 */
import { z } from "zod";
import { and, desc, eq, lt, sql, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure, requireGroup } from "../trpc";
import { db, schema } from "../db";
import { assertProjectEditable } from "../services/projectAcl";
import {
  COMMUNITY_SOURCE_TYPES,
  COMMUNITY_MEDIA_KINDS,
} from "../db/schema/community";

const sourceTypeSchema = z.enum(COMMUNITY_SOURCE_TYPES);
const mediaKindSchema = z.enum(COMMUNITY_MEDIA_KINDS);

/** 從來源列推 mediaKind */
function inferMediaKind(sourceType: string, kindOrMime?: string | null): (typeof COMMUNITY_MEDIA_KINDS)[number] {
  if (sourceType === "prompt") return "text";
  if (sourceType === "character" || sourceType === "scene_preset" || sourceType === "prop") return "card";
  if (sourceType === "asset" || sourceType === "generation") {
    const k = (kindOrMime || "").toLowerCase();
    if (k.includes("video") || k === "video") return "video";
    if (k.includes("audio") || k === "audio" || k.includes("sound")) return "audio";
    if (k.includes("image") || k === "image" || k.includes("photo")) return "image";
    return "image"; // generation default
  }
  return "text";
}

export const communityRouter = router({
  /**
   * 靈感頻道主 feed（全站公開）
   * cursor = publishedAt ISO string（往更舊的方向翻頁）
   */
  listPublic: authedProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(50).default(24),
        cursor: z.string().datetime().optional(),
        sort: z.enum(["recent", "popular"]).default("recent"),
        mediaKind: mediaKindSchema.optional(),
        sourceType: sourceTypeSchema.optional(),
        tag: z.string().max(50).optional(),
      }),
    )
    .query(async ({ input }) => {
      const conditions = [eq(schema.communityPosts.status, "published")];
      if (input.mediaKind) conditions.push(eq(schema.communityPosts.mediaKind, input.mediaKind));
      if (input.sourceType) conditions.push(eq(schema.communityPosts.sourceType, input.sourceType));
      if (input.cursor) {
        conditions.push(lt(schema.communityPosts.publishedAt, new Date(input.cursor)));
      }
      // 簡單 tags 包含（jsonb @> 語意用 sql）
      if (input.tag) {
        conditions.push(sql`${schema.communityPosts.tags} @> ${JSON.stringify([input.tag])}::jsonb`);
      }

      const orderBy =
        input.sort === "popular"
          ? [desc(schema.communityPosts.likeCount), desc(schema.communityPosts.publishedAt)]
          : [desc(schema.communityPosts.publishedAt)];

      const rows = await db
        .select()
        .from(schema.communityPosts)
        .where(and(...conditions))
        .orderBy(...orderBy)
        .limit(input.limit + 1);

      let nextCursor: string | undefined;
      if (rows.length > input.limit) {
        const next = rows.pop()!;
        nextCursor = next.publishedAt.toISOString();
      }
      return { items: rows, nextCursor };
    }),

  get: authedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      const [row] = await db
        .select()
        .from(schema.communityPosts)
        .where(and(eq(schema.communityPosts.id, input.id), eq(schema.communityPosts.status, "published")));
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      return row;
    }),

  /** 作者自己的發布列表（含 hidden） */
  myPosts: authedProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(50).default(30),
        cursor: z.string().datetime().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const conditions = [
        eq(schema.communityPosts.authorId, ctx.auth.user.id),
        inArray(schema.communityPosts.status, ["published", "hidden"]),
      ];
      if (input.cursor) {
        conditions.push(lt(schema.communityPosts.publishedAt, new Date(input.cursor)));
      }
      const rows = await db
        .select()
        .from(schema.communityPosts)
        .where(and(...conditions))
        .orderBy(desc(schema.communityPosts.publishedAt))
        .limit(input.limit + 1);
      let nextCursor: string | undefined;
      if (rows.length > input.limit) {
        const next = rows.pop()!;
        nextCursor = next.publishedAt.toISOString();
      }
      return { items: rows, nextCursor };
    }),

  /**
   * 從既有來源發布到靈感頻道（快照）
   * 同一來源若已有 published 貼 → 更新快照（partial unique）
   */
  publishFromSource: authedProcedure
    .input(
      z.object({
        sourceType: sourceTypeSchema,
        sourceId: z.string().uuid(),
        title: z.string().min(1).max(200).optional(),
        description: z.string().max(2000).optional(),
        tags: z.array(z.string().min(1).max(40)).max(20).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.auth.user.id;
      let title = input.title?.trim() || "";
      let promptText: string | null = null;
      let modelId: string | null = null;
      let mediaUrl: string | null = null;
      let thumbnailUrl: string | null = null;
      let mediaKind: (typeof COMMUNITY_MEDIA_KINDS)[number] = "text";
      let characterIds: string[] | null = null;
      let scenePresetIds: string[] | null = null;
      let propIds: string[] | null = null;
      let sourceProjectId: string | null = null;
      let sourceGroupId: string | null = null;

      if (input.sourceType === "prompt") {
        const [row] = await db.select().from(schema.prompts).where(eq(schema.prompts.id, input.sourceId));
        if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "提示詞不存在" });
        requireGroup(ctx.auth, row.groupId);
        await assertProjectEditable(ctx.auth, { id: row.projectId, groupId: row.groupId });
        title = title || row.text.slice(0, 80) + (row.text.length > 80 ? "…" : "");
        promptText = row.text;
        modelId = row.modelId ?? null;
        characterIds = row.characterIds ?? null;
        scenePresetIds = row.scenePresetIds ?? null;
        propIds = row.propIds ?? null;
        mediaKind = "text";
        sourceProjectId = row.projectId;
        sourceGroupId = row.groupId;
      } else if (input.sourceType === "generation") {
        const [row] = await db.select().from(schema.generations).where(eq(schema.generations.id, input.sourceId));
        if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "生成紀錄不存在" });
        requireGroup(ctx.auth, row.groupId);
        await assertProjectEditable(ctx.auth, { id: row.projectId, groupId: row.groupId });
        title = title || row.name || row.prompt.slice(0, 80) + (row.prompt.length > 80 ? "…" : "");
        promptText = row.prompt;
        modelId = row.modelId;
        mediaUrl = row.resultUrl ?? null;
        mediaKind = inferMediaKind("generation", row.kind);
        characterIds = row.characterIds ?? null;
        scenePresetIds = row.scenePresetIds ?? null;
        propIds = row.propIds ?? null;
        sourceProjectId = row.projectId;
        sourceGroupId = row.groupId;
      } else if (input.sourceType === "asset") {
        const [row] = await db.select().from(schema.assets).where(eq(schema.assets.id, input.sourceId));
        if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "素材不存在" });
        requireGroup(ctx.auth, row.groupId);
        await assertProjectEditable(ctx.auth, { id: row.projectId, groupId: row.groupId });
        title = title || row.title;
        mediaUrl = row.url;
        mediaKind = inferMediaKind("asset", row.kind);
        sourceProjectId = row.projectId;
        sourceGroupId = row.groupId;
      } else if (input.sourceType === "character") {
        const [row] = await db.select().from(schema.characters).where(eq(schema.characters.id, input.sourceId));
        if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "角色卡不存在" });
        requireGroup(ctx.auth, row.groupId);
        await assertProjectEditable(ctx.auth, { id: row.projectId, groupId: row.groupId });
        title = title || row.name;
        promptText = [row.appearance, row.notes].filter(Boolean).join("\n") || null;
        mediaKind = "card";
        characterIds = [row.id];
        sourceProjectId = row.projectId;
        sourceGroupId = row.groupId;
      } else if (input.sourceType === "scene_preset") {
        const [row] = await db.select().from(schema.scenePresets).where(eq(schema.scenePresets.id, input.sourceId));
        if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "場景卡不存在" });
        requireGroup(ctx.auth, row.groupId);
        await assertProjectEditable(ctx.auth, { id: row.projectId, groupId: row.groupId });
        title = title || row.name;
        promptText = [row.palette, row.lighting].filter(Boolean).join(" · ") || null;
        mediaKind = "card";
        scenePresetIds = [row.id];
        sourceProjectId = row.projectId;
        sourceGroupId = row.groupId;
      } else if (input.sourceType === "prop") {
        const [row] = await db.select().from(schema.props).where(eq(schema.props.id, input.sourceId));
        if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "道具卡不存在" });
        requireGroup(ctx.auth, row.groupId);
        await assertProjectEditable(ctx.auth, { id: row.projectId, groupId: row.groupId });
        title = title || row.name;
        promptText = [row.appearance, row.notes].filter(Boolean).join("\n") || null;
        mediaKind = "card";
        propIds = [row.id];
        sourceProjectId = row.projectId;
        sourceGroupId = row.groupId;
      } else {
        throw new TRPCError({ code: "BAD_REQUEST", message: "不支援的來源類型" });
      }

      if (!title) title = "未命名";

      const now = new Date();
      const values = {
        authorId: userId,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        sourceProjectId,
        sourceGroupId,
        title,
        description: input.description?.trim() || null,
        promptText,
        modelId,
        mediaKind,
        mediaUrl,
        thumbnailUrl,
        characterIds,
        scenePresetIds,
        propIds,
        tags: input.tags ?? [],
        status: "published" as const,
        publishedAt: now,
        updatedAt: now,
      };

      // 若已有同來源 published 貼 → 更新；否則新增
      const [existing] = await db
        .select()
        .from(schema.communityPosts)
        .where(
          and(
            eq(schema.communityPosts.sourceType, input.sourceType),
            eq(schema.communityPosts.sourceId, input.sourceId),
            eq(schema.communityPosts.status, "published"),
          ),
        );

      if (existing) {
        const [updated] = await db
          .update(schema.communityPosts)
          .set({
            ...values,
            // 保留既有互動計數
            likeCount: existing.likeCount,
            useCount: existing.useCount,
          })
          .where(eq(schema.communityPosts.id, existing.id))
          .returning();
        return updated;
      }

      const [created] = await db.insert(schema.communityPosts).values(values).returning();
      return created;
    }),

  /** 作者下架（status → hidden） */
  unpublish: authedProcedure
    .input(z.object({ postId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [post] = await db
        .select()
        .from(schema.communityPosts)
        .where(eq(schema.communityPosts.id, input.postId));
      if (!post) throw new TRPCError({ code: "NOT_FOUND" });
      if (post.authorId !== ctx.auth.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "只能下架自己的貼文" });
      }
      const [updated] = await db
        .update(schema.communityPosts)
        .set({ status: "hidden", updatedAt: new Date() })
        .where(eq(schema.communityPosts.id, input.postId))
        .returning();
      return updated;
    }),

  /** 一鍵再用時呼叫，增加 useCount */
  recordUse: authedProcedure
    .input(z.object({ postId: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const [updated] = await db
        .update(schema.communityPosts)
        .set({
          useCount: sql`${schema.communityPosts.useCount} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(eq(schema.communityPosts.id, input.postId), eq(schema.communityPosts.status, "published")),
        )
        .returning({ id: schema.communityPosts.id, useCount: schema.communityPosts.useCount });
      if (!updated) throw new TRPCError({ code: "NOT_FOUND" });
      return updated;
    }),
});
