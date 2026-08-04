-- 0036: 已套用「舊版 0035 composite PK」的 DB → surrogate uuid PK。
-- 新版 0035 已是最終形狀時：DROP+ADD pkey 等價重套、unique 為 IF NOT EXISTS。
-- 語意不變：一人一帖仍由 unique(post_id,user_id) 保證。不可納入 LEGACY_ADOPTION。
ALTER TABLE "community_likes" ADD COLUMN IF NOT EXISTS "id" uuid DEFAULT gen_random_uuid();
--> statement-breakpoint
UPDATE "community_likes" SET "id" = gen_random_uuid() WHERE "id" IS NULL;
--> statement-breakpoint
ALTER TABLE "community_likes" ALTER COLUMN "id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "community_likes" DROP CONSTRAINT IF EXISTS "community_likes_pk";
--> statement-breakpoint
ALTER TABLE "community_likes" DROP CONSTRAINT IF EXISTS "community_likes_pkey";
--> statement-breakpoint
ALTER TABLE "community_likes" ADD CONSTRAINT "community_likes_pkey" PRIMARY KEY ("id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "community_likes_post_user_uq" ON "community_likes" USING btree ("post_id","user_id");
