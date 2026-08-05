-- 靈感頻道讚。最初為 composite PK (post_id,user_id)；為避開 drizzle-kit composite PK
-- introspection 崩潰（#5557 / #398）改為 surrogate uuid PK + unique(post_id,user_id)。
-- 已套用舊版 0035 的 DB 由 0036 前向升級；本檔新 hash 記入 MIGRATION_REVISIONS。
--
-- 主鍵寫成欄位上的 inline PRIMARY KEY，而不是 table-level CONSTRAINT "community_likes_pkey"：
-- 兩者在 PostgreSQL 建出來的是同一個約束（inline PK 的預設名就是 <table>_pkey，0036 的
-- DROP/ADD CONSTRAINT "community_likes_pkey" 兩種寫法都接得上），但 legacy adoption bridge
-- 是拿本檔的 DDL 去跟 drizzle-kit 產生的 drift 計畫做「正規化後逐字」比對，而產生器只吐
-- inline 形式。table-level 的那一版讓這張表在 bridge 眼中永遠是「非 bridge 預期 drift」，
-- adopt 因此整批失敗——與 0022 註解講的是同一個坑（DDL 要跟產生器的排版對得起來）。
CREATE TABLE IF NOT EXISTS "community_likes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "community_likes_post_user_uq" ON "community_likes" USING btree ("post_id", "user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "community_likes_user_idx" ON "community_likes" USING btree ("user_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "community_likes_post_idx" ON "community_likes" USING btree ("post_id");
