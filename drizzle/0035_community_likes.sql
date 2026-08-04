-- 靈感頻道讚。最初為 composite PK (post_id,user_id)；為避開 drizzle-kit composite PK
-- introspection 崩潰（#5557 / #398）改為 surrogate uuid PK + unique(post_id,user_id)。
-- 已套用舊版 0035 的 DB 由 0036 前向升級；本檔新 hash 記入 MIGRATION_REVISIONS。
CREATE TABLE IF NOT EXISTS "community_likes" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "post_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "community_likes_pkey" PRIMARY KEY ("id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "community_likes_post_user_uq" ON "community_likes" USING btree ("post_id", "user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "community_likes_user_idx" ON "community_likes" USING btree ("user_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "community_likes_post_idx" ON "community_likes" USING btree ("post_id");
