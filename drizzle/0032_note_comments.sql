CREATE TABLE IF NOT EXISTS "note_comments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "note_id" uuid NOT NULL,
  "group_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "body" text NOT NULL,
  "reply_to_id" uuid,
  "mentions" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "note_comments_note_created_idx" ON "note_comments" USING btree ("note_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "note_comments_group_idx" ON "note_comments" USING btree ("group_id");
