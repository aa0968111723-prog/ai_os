-- Persistent external editing hand-off state. Media remains canonical in assets,
-- while these rows preserve truthful session, package, and return context.
CREATE TABLE IF NOT EXISTS "external_editing_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "editor_id" text NOT NULL,
  "project_id" uuid NOT NULL,
  "group_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "selection_type" text NOT NULL,
  "story_scene_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "shot_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "asset_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "context_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "status" text DEFAULT 'preparing' NOT NULL,
  "origin_assistant_run_id" uuid,
  "origin_conversation_id" text,
  "origin_surface" text,
  "return_context" jsonb,
  "returned_asset_id" uuid,
  "error" text,
  "handed_off_at" timestamp with time zone,
  "returned_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "external_editing_sessions_project_status_idx"
  ON "external_editing_sessions" USING btree ("project_id", "status", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "external_editing_sessions_user_created_idx"
  ON "external_editing_sessions" USING btree ("user_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "external_editing_sessions_conversation_idx"
  ON "external_editing_sessions" USING btree ("origin_conversation_id", "created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "external_editing_packages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "session_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "handoff_mode" text NOT NULL,
  "file_name" text NOT NULL,
  "manifest" jsonb NOT NULL,
  "asset_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "external_editing_packages_session_created_idx"
  ON "external_editing_packages" USING btree ("session_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "external_editing_packages_expiry_idx"
  ON "external_editing_packages" USING btree ("expires_at");
