-- 專案分享連結（唯讀公開檢視）：拿到連結的人不必登入就能唯讀看整個專案。
-- token_hash 只存 SHA-256（原文只在建立當下回一次），唯一性比照 upload_grants/mcp_tokens 走
-- 表級 CONSTRAINT（對齊 schema 的 .unique()）。可設 expires_at、可 revoked_at 撤銷。
-- 刻意不加 FK：專案永久刪除時不該被分享連結擋住，讀取端一律先查專案是否還在。
CREATE TABLE IF NOT EXISTS "project_share_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"label" text,
	"created_by" uuid NOT NULL,
	"expires_at" timestamp,
	"revoked_at" timestamp,
	"last_viewed_at" timestamp,
	"view_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_share_links_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_share_links_project_created_idx" ON "project_share_links" USING btree ("project_id","created_at");
