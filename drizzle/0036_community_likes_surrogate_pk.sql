-- 0036: community_likes 改 surrogate uuid PK，避開 drizzle-kit composite PK introspection bug (#5557)
-- 既有列以 gen_random_uuid() 回填；語意不變（一人一帖仍由 unique 保證）。
ALTER TABLE "community_likes" ADD COLUMN IF NOT EXISTS "id" uuid DEFAULT gen_random_uuid();
--> statement-breakpoint
UPDATE "community_likes" SET "id" = gen_random_uuid() WHERE "id" IS NULL;
--> statement-breakpoint
ALTER TABLE "community_likes" ALTER COLUMN "id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "community_likes" DROP CONSTRAINT IF EXISTS "community_likes_pk";
--> statement-breakpoint
ALTER TABLE "community_likes" ADD CONSTRAINT "community_likes_pkey" PRIMARY KEY ("id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "community_likes_post_user_uq" ON "community_likes" USING btree ("post_id","user_id");
