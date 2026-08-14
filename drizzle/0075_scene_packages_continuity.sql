CREATE TABLE IF NOT EXISTS "scene_packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"story_scene_id" uuid NOT NULL,
	"schema_version" text NOT NULL,
	"fingerprint" text NOT NULL,
	"payload" jsonb NOT NULL,
	"parent_package_id" uuid,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scene_packages_scene_created_idx" ON "scene_packages" ("story_scene_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scene_packages_project_idx" ON "scene_packages" ("project_id","story_scene_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scene_packages_fingerprint_idx" ON "scene_packages" ("story_scene_id","fingerprint");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scene_package_heads" (
	"story_scene_id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"package_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"stale" boolean DEFAULT false NOT NULL,
	"stale_reason" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scene_package_heads_project_stale_idx" ON "scene_package_heads" ("project_id","stale");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "shot_continuity_states" (
	"shot_id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"end_state" jsonb NOT NULL,
	"source_generation_id" uuid,
	"source_asset_id" uuid,
	"extracted_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shot_continuity_states_project_idx" ON "shot_continuity_states" ("project_id");
