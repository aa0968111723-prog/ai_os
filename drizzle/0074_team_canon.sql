CREATE TABLE IF NOT EXISTS "canon_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"summary" text,
	"status" text DEFAULT 'active' NOT NULL,
	"parent_canon_id" uuid,
	"source_project_id" uuid,
	"source_entity_kind" text,
	"source_entity_id" uuid,
	"reuse_scope" text DEFAULT 'team' NOT NULL,
	"training_allowed" boolean DEFAULT false NOT NULL,
	"generation_allowed" boolean DEFAULT true NOT NULL,
	"rights_note" text,
	"production_version_id" uuid,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "canon_entries_group_kind_idx" ON "canon_entries" ("group_id","kind");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "canon_entries_group_status_idx" ON "canon_entries" ("group_id","status");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "canon_entries_source_uq" ON "canon_entries" ("group_id","source_entity_kind","source_entity_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "canon_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canon_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"parent_version_id" uuid,
	"fingerprint" text NOT NULL,
	"payload" jsonb NOT NULL,
	"dataset_fingerprint" text,
	"adapter_ref" text,
	"training_job_id" uuid,
	"archived" boolean DEFAULT false NOT NULL,
	"created_reason" text DEFAULT 'manual' NOT NULL,
	"evaluation" jsonb,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "canon_versions_canon_version_uq" ON "canon_versions" ("canon_id","version_number");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "canon_versions_canon_fingerprint_uq" ON "canon_versions" ("canon_id","fingerprint");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "canon_versions_canon_idx" ON "canon_versions" ("canon_id","created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "canon_version_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canon_id" uuid NOT NULL,
	"version_id" uuid,
	"event" text NOT NULL,
	"detail" jsonb,
	"actor" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "canon_version_events_canon_created_idx" ON "canon_version_events" ("canon_id","created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_canon_pins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"canon_id" uuid NOT NULL,
	"pinned_version_id" uuid NOT NULL,
	"local_entity_kind" text,
	"local_entity_id" uuid,
	"pinned_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_canon_pins_project_canon_uq" ON "project_canon_pins" ("project_id","canon_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_canon_pins_project_local_uq" ON "project_canon_pins" ("project_id","local_entity_kind","local_entity_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_canon_pins_project_idx" ON "project_canon_pins" ("project_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_canon_pins_canon_idx" ON "project_canon_pins" ("canon_id");
