/**
 * Community / 靈感頻道 schema（Flow-TV 風格全站共用展示）
 *
 * 目標：把專案內的提示詞、生成結果、素材、角色／場景／道具卡，
 * 以「明確發布」方式公開到全站靈感頻道，供其他人瀏覽、偷看 prompt、一鍵再用。
 *
 * 設計取捨：
 * - 不在 prompts/generations/assets 等原表加 visibility（避免污染核心表、避免跨表 UNION）
 * - 用 community_posts 做發布快照：發布當下把 title / prompt / media / 設定卡 id 複製進來
 *   → 原列之後被改或刪，公開卡仍可展示與再用
 * - 署名保留 authorId + 可選 sourceProjectId / sourceGroupId（僅內部追蹤，公開列表可隱藏）
 */
import { pgTable, uuid, text, integer, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/** 靈感頻道貼文來源類型 */
export const COMMUNITY_SOURCE_TYPES = [
  "prompt",
  "generation",
  "asset",
  "character",
  "scene_preset",
  "prop",
] as const;
export type CommunitySourceType = (typeof COMMUNITY_SOURCE_TYPES)[number];

/** 貼文狀態：published=公開、hidden=作者暫時下架、removed=管理員下架 */
export const COMMUNITY_POST_STATUSES = ["published", "hidden", "removed"] as const;
export type CommunityPostStatus = (typeof COMMUNITY_POST_STATUSES)[number];

/**
 * 媒體類型（方便 Feed 卡片與頻道篩選）
 * - text：純提示詞或文字結果
 * - image / video / audio：對應生成或素材
 * - card：角色／場景／道具設定卡（可能附參考圖）
 */
export const COMMUNITY_MEDIA_KINDS = ["text", "image", "video", "audio", "card"] as const;
export type CommunityMediaKind = (typeof COMMUNITY_MEDIA_KINDS)[number];

export const communityPosts = pgTable(
  "community_posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** 發布者（署名） */
    authorId: uuid("author_id").notNull(),
    /** 來源類型 */
    sourceType: text("source_type", {
      enum: ["prompt", "generation", "asset", "character", "scene_preset", "prop"],
    }).notNull(),
    /** 來源列 id（可為 null：來源已刪或手動貼文） */
    sourceId: uuid("source_id"),
    /** 來源專案／組（內部追蹤與權限校驗用；公開列表可不露出） */
    sourceProjectId: uuid("source_project_id"),
    sourceGroupId: uuid("source_group_id"),

    /** 卡片標題（可編；預設從來源推） */
    title: text("title").notNull(),
    /** 可選說明／創作心得 */
    description: text("description"),
    /** Show Prompt：完整提示詞快照（Flow TV 核心） */
    promptText: text("prompt_text"),
    /** 使用的模型 id（可為 null） */
    modelId: text("model_id"),

    /** 媒體類型與預覽 */
    mediaKind: text("media_kind", {
      enum: ["text", "image", "video", "audio", "card"],
    })
      .notNull()
      .default("text"),
    mediaUrl: text("media_url"),
    thumbnailUrl: text("thumbnail_url"),

    /** 一鍵再用所需的設定卡快照（id 陣列；實際卡可能在原專案） */
    characterIds: jsonb("character_ids").$type<string[]>(),
    scenePresetIds: jsonb("scene_preset_ids").$type<string[]>(),
    propIds: jsonb("prop_ids").$type<string[]>(),

    /** 標籤（頻道／搜尋） */
    tags: jsonb("tags").$type<string[]>().notNull().default([]),

    /** 互動計數（之後 PR 可接真實 like 表；先 denormalized） */
    likeCount: integer("like_count").notNull().default(0),
    useCount: integer("use_count").notNull().default(0),

    status: text("status", {
      enum: ["published", "hidden", "removed"],
    })
      .notNull()
      .default("published"),

    publishedAt: timestamp("published_at").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    // 靈感頻道主列表：只掃 published，依時間或熱度
    publishedFeedIdx: index("community_posts_published_feed_idx")
      .on(t.publishedAt)
      .where(sql`${t.status} = 'published'`),
    popularIdx: index("community_posts_popular_idx")
      .on(t.likeCount, t.publishedAt)
      .where(sql`${t.status} = 'published'`),
    authorIdx: index("community_posts_author_idx").on(t.authorId, t.publishedAt),
    sourceTypeIdx: index("community_posts_source_type_idx").on(t.sourceType, t.publishedAt),
    // 同一來源避免重複發布（作者可 hidden 後再發新版；active 唯一）
    sourceActiveUq: uniqueIndex("community_posts_source_active_uq")
      .on(t.sourceType, t.sourceId)
      .where(sql`${t.sourceId} is not null and ${t.status} = 'published'`),
  }),
);
