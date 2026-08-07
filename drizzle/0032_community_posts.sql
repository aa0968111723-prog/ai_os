-- Community / 靈感頻道：全站共用提示詞與多模態素材展示（Flow-TV 風格）
-- 發布快照：不污染 prompts/generations/assets 等核心表；原列改刪後公開卡仍可展示
-- IF NOT EXISTS 沿用 0016/0031 慣例：重複套用不炸
--
-- auto_tags／category／taxonomy_version（自動細化分類）也寫在這張 CREATE TABLE 裡：
-- community_posts 本身還在 legacy bridge 的 pending 批次內，bridge 比對的是整表 DDL，
-- 欄位不能只靠後面的 0040 用 ALTER 補——見 0022 的註記與 0025／0029 的前例。
-- 已經套用過舊版本檔的資料庫由 0040 的 ADD COLUMN IF NOT EXISTS 補齊；
-- 新資料庫跑到 0040 是 no-op。兩條路徑最終 schema 完全相同。
CREATE TABLE IF NOT EXISTS "community_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"author_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid,
	"source_project_id" uuid,
	"source_group_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"prompt_text" text,
	"model_id" text,
	"media_kind" text DEFAULT 'text' NOT NULL,
	"media_url" text,
	"thumbnail_url" text,
	"character_ids" jsonb,
	"scene_preset_ids" jsonb,
	"prop_ids" jsonb,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"auto_tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"category" text,
	"taxonomy_version" integer DEFAULT 0 NOT NULL,
	"like_count" integer DEFAULT 0 NOT NULL,
	"use_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'published' NOT NULL,
	"published_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "community_posts_published_feed_idx" ON "community_posts" USING btree ("published_at") WHERE "community_posts"."status" = 'published';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "community_posts_popular_idx" ON "community_posts" USING btree ("like_count","published_at") WHERE "community_posts"."status" = 'published';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "community_posts_author_idx" ON "community_posts" USING btree ("author_id","published_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "community_posts_source_type_idx" ON "community_posts" USING btree ("source_type","published_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "community_posts_source_active_uq" ON "community_posts" USING btree ("source_type","source_id") WHERE "community_posts"."source_id" is not null and "community_posts"."status" = 'published';
