-- 靈感頻道自動細化分類：把發布素材從「五格 mediaKind」細到多面向標籤。
-- auto_tags 是字典產物（shared/inspirationTaxonomy.ts），值域封閉、可拿來做篩選與計數；
-- 作者手寫的 tags 保持原樣不動——重算分類永遠只覆寫 auto_tags。
-- taxonomy_version 落後 TAXONOMY_VERSION 的列會在讀取時自動重算，所以改字典
-- 不需要停機補資料；預設 0 代表「這列還沒分類過」，既有貼文一次讀取就會補上。
--
-- 三個欄位的本體已寫進 0032 的 CREATE TABLE（community_posts 仍在 legacy bridge 的
-- pending 批次內，bridge 比對整表 DDL，欄位不能只靠這裡的 ALTER 補——見 0022／0029 的註記）。
-- 底下三句 ADD COLUMN IF NOT EXISTS 是給「已經套用過舊版 0032」的資料庫補欄位；
-- 新資料庫跑到這裡是 no-op，兩條路徑最終 schema 完全相同。
ALTER TABLE "community_posts" ADD COLUMN IF NOT EXISTS "auto_tags" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "community_posts" ADD COLUMN IF NOT EXISTS "category" text;
--> statement-breakpoint
ALTER TABLE "community_posts" ADD COLUMN IF NOT EXISTS "taxonomy_version" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
-- 主分類（列表卡片＋分類頁）：與 published_at 併走一條 btree，排序不必回表
CREATE INDEX IF NOT EXISTS "community_posts_category_idx" ON "community_posts" USING btree ("category","published_at");
--> statement-breakpoint
-- 細化篩選一律是 auto_tags @> '["subject:city"]'：jsonb 包含查詢只有 GIN 走得動
CREATE INDEX IF NOT EXISTS "community_posts_auto_tags_idx" ON "community_posts" USING gin ("auto_tags");
