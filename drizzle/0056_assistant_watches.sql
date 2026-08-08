CREATE TABLE IF NOT EXISTS "assistant_watches" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "group_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "kind" text NOT NULL,
  "label" text NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "last_checked_at" timestamp with time zone,
  "last_triggered_at" timestamp with time zone,
  "last_fingerprint" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "assistant_watches_user_project_kind_uq" ON "assistant_watches" USING btree ("user_id", "project_id", "kind");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assistant_watches_active_checked_idx" ON "assistant_watches" USING btree ("active", "last_checked_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assistant_watches_project_idx" ON "assistant_watches" USING btree ("project_id");
