-- Canonical Library Resource layer + Folder Import 2.0 + Project/Scene/Shot Context.
-- Additive only: no existing table, column, id, URL or project relation is changed.
-- assets.project_id stays NOT NULL on purpose; library_resources records which row
-- physically carries the bytes so other projects can reference the same data without
-- copying it. Every statement is IF NOT EXISTS, so re-running is a no-op.
CREATE TABLE IF NOT EXISTS "library_resources" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "group_id" uuid NOT NULL,
  "resource_kind" text NOT NULL,
  "resource_id" uuid NOT NULL,
  "intelligence_id" uuid,
  "home_project_id" uuid,
  "display_name" text NOT NULL,
  "mime" text,
  "size_bytes" bigint,
  "checksum" text,
  "source_root_name" text,
  "relative_path" text,
  "parent_path" text,
  "source_last_modified_at" timestamp,
  "origin_type" text DEFAULT 'upload' NOT NULL,
  "folder_import_session_id" uuid,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_by" uuid,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "library_resources_carrier_uq" ON "library_resources" ("resource_kind","resource_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "library_resources_group_checksum_idx" ON "library_resources" ("group_id","checksum");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "library_resources_group_path_idx" ON "library_resources" ("group_id","relative_path");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "library_resources_session_idx" ON "library_resources" ("folder_import_session_id");

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "library_resource_usages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "library_resource_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "group_id" uuid NOT NULL,
  "usage" text DEFAULT 'reference' NOT NULL,
  "created_by" uuid,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "library_resource_usages_uq" ON "library_resource_usages" ("library_resource_id","project_id","usage");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "library_resource_usages_project_idx" ON "library_resource_usages" ("project_id");

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "folder_import_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "group_id" uuid NOT NULL,
  "project_id" uuid,
  "source_type" text DEFAULT 'web_directory' NOT NULL,
  "source_root_id" text,
  "display_name" text NOT NULL,
  "mode" text DEFAULT 'import_once' NOT NULL,
  "previous_session_id" uuid,
  "processing_batch_id" uuid,
  "total_files" integer DEFAULT 0 NOT NULL,
  "uploaded_files" integer DEFAULT 0 NOT NULL,
  "skipped_files" integer DEFAULT 0 NOT NULL,
  "failed_files" integer DEFAULT 0 NOT NULL,
  "missing_files" integer DEFAULT 0 NOT NULL,
  "total_bytes" bigint DEFAULT 0 NOT NULL,
  "status" text DEFAULT 'scanning' NOT NULL,
  "created_by" uuid NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "completed_at" timestamp
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "folder_import_sessions_group_created_idx" ON "folder_import_sessions" ("group_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "folder_import_sessions_root_idx" ON "folder_import_sessions" ("group_id","source_root_id");

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "folder_import_entries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "session_id" uuid NOT NULL,
  "relative_path" text NOT NULL,
  "parent_path" text DEFAULT '' NOT NULL,
  "filename" text NOT NULL,
  "size_bytes" bigint DEFAULT 0 NOT NULL,
  "mime" text,
  "source_last_modified_at" timestamp,
  "checksum" text,
  "diff_state" text DEFAULT 'NEW' NOT NULL,
  "upload_status" text DEFAULT 'pending' NOT NULL,
  "attempt" integer DEFAULT 0 NOT NULL,
  "resource_kind" text,
  "resource_id" uuid,
  "library_resource_id" uuid,
  "intelligence_id" uuid,
  "error" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "folder_import_entries_path_uq" ON "folder_import_entries" ("session_id","relative_path");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "folder_import_entries_status_idx" ON "folder_import_entries" ("session_id","upload_status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "folder_import_entries_intelligence_idx" ON "folder_import_entries" ("intelligence_id");

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "context_bindings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "group_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "scope_type" text NOT NULL,
  "scope_id" uuid NOT NULL,
  "resource_kind" text NOT NULL,
  "resource_id" uuid NOT NULL,
  "intelligence_id" uuid,
  "library_resource_id" uuid,
  "role" text NOT NULL,
  "priority" text DEFAULT 'SECONDARY' NOT NULL,
  "source" text DEFAULT 'USER_CONFIRMED' NOT NULL,
  "confidence" real,
  "confirmed_by_user" boolean DEFAULT false NOT NULL,
  "note" text,
  "created_by" uuid,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "context_bindings_uq" ON "context_bindings" ("scope_type","scope_id","resource_kind","resource_id","role");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "context_bindings_scope_idx" ON "context_bindings" ("scope_type","scope_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "context_bindings_project_role_idx" ON "context_bindings" ("project_id","role");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "context_bindings_resource_idx" ON "context_bindings" ("resource_kind","resource_id");

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "context_resolution_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "group_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "scene_id" uuid,
  "shot_id" uuid,
  "user_id" uuid NOT NULL,
  "intent" text NOT NULL,
  "retrieval_run_id" uuid,
  "binding_count" integer DEFAULT 0 NOT NULL,
  "retrieved_count" integer DEFAULT 0 NOT NULL,
  "truncated" boolean DEFAULT false NOT NULL,
  "budget_chars" integer DEFAULT 0 NOT NULL,
  "included_chars" integer DEFAULT 0 NOT NULL,
  "trace" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "context_resolution_runs_project_created_idx" ON "context_resolution_runs" ("project_id","created_at");
