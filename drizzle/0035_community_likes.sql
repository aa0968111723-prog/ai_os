CREATE TABLE IF NOT EXISTS "community_likes" (
  "post_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "community_likes_pk" PRIMARY KEY ("post_id", "user_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "community_likes_user_idx" ON "community_likes" USING btree ("user_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "community_likes_post_idx" ON "community_likes" USING btree ("post_id");
