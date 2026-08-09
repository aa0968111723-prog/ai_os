-- External generation hand-off state only. Assets/Library/Intelligence remain the
-- canonical media pipeline; no second asset or project domain is introduced.
CREATE TABLE IF NOT EXISTS "user_external_tools" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "group_id" uuid NOT NULL,
  "name" text NOT NULL,
  "url" text NOT NULL,
  "capabilities" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "favorite" boolean DEFAULT false NOT NULL,
  "instructions" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_external_tools_user_group_name_uq"
  ON "user_external_tools" USING btree ("user_id", "group_id", "name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_external_tools_user_group_idx"
  ON "user_external_tools" USING btree ("user_id", "group_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "external_generation_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "group_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "scene_id" uuid,
  "target_type" text NOT NULL,
  "external_tool" text NOT NULL,
  "external_tool_name" text NOT NULL,
  "external_url" text NOT NULL,
  "prompt" text NOT NULL,
  "negative_prompt" text,
  "reference_asset_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "status" text DEFAULT 'prepared' NOT NULL,
  "imported_asset_id" uuid,
  "trace_session_id" uuid,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "completed_at" timestamp
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "external_generation_sessions_project_status_idx"
  ON "external_generation_sessions" USING btree ("project_id", "status", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "external_generation_sessions_user_created_idx"
  ON "external_generation_sessions" USING btree ("user_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "external_generation_sessions_scene_status_idx"
  ON "external_generation_sessions" USING btree ("scene_id", "status", "created_at");
