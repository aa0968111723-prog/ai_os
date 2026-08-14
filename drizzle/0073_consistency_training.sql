CREATE TABLE IF NOT EXISTS "consistency_dataset_manifests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"character_id" uuid,
	"look_id" uuid,
	"fingerprint" text NOT NULL,
	"manifest" jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "consistency_dataset_manifests_project_created_idx" ON "consistency_dataset_manifests" ("project_id","created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "consistency_dataset_manifests_fingerprint_uq" ON "consistency_dataset_manifests" ("project_id","fingerprint");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "consistency_training_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"character_id" uuid,
	"look_id" uuid,
	"dataset_id" uuid NOT NULL,
	"provider" text DEFAULT 'fal' NOT NULL,
	"model_id" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"external_job_id" text,
	"idempotency_key" text NOT NULL,
	"est_points" integer DEFAULT 0 NOT NULL,
	"look_rev_at_start" integer,
	"look_changed" boolean DEFAULT false NOT NULL,
	"error" text,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "consistency_training_jobs_project_status_idx" ON "consistency_training_jobs" ("project_id","status");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "consistency_training_jobs_idempotency_uq" ON "consistency_training_jobs" ("project_id","idempotency_key");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "consistency_model_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"character_id" uuid,
	"job_id" uuid NOT NULL,
	"adapter_ref" text,
	"active" boolean DEFAULT false NOT NULL,
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"promoted_at" timestamp,
	"promoted_by" uuid
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "consistency_model_versions_project_active_idx" ON "consistency_model_versions" ("project_id","active");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "consistency_model_versions_job_uq" ON "consistency_model_versions" ("job_id");
