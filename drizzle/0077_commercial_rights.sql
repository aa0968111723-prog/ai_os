CREATE TABLE IF NOT EXISTS "asset_rights_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"license_type" text DEFAULT 'unknown' NOT NULL,
	"rights_status" text DEFAULT 'UNKNOWN' NOT NULL,
	"commercial_use_allowed" boolean,
	"training_allowed" boolean,
	"derivatives_allowed" boolean,
	"attribution_required" boolean,
	"editorial_only" boolean DEFAULT false NOT NULL,
	"personal_use_only" boolean DEFAULT false NOT NULL,
	"confidence" integer DEFAULT 0 NOT NULL,
	"decision_version" text NOT NULL,
	"usage_context" text DEFAULT 'commercial_final' NOT NULL,
	"license_fingerprint" text,
	"profile" jsonb NOT NULL,
	"checked_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "asset_rights_profiles_asset_uq" ON "asset_rights_profiles" ("asset_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asset_rights_profiles_project_status_idx" ON "asset_rights_profiles" ("project_id","rights_status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asset_rights_profiles_group_idx" ON "asset_rights_profiles" ("group_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "asset_rights_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"decision_version" text NOT NULL,
	"rights_status" text NOT NULL,
	"fingerprint" text NOT NULL,
	"trigger" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "asset_rights_checks_asset_fingerprint_uq" ON "asset_rights_checks" ("asset_id","fingerprint");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asset_rights_checks_asset_created_idx" ON "asset_rights_checks" ("asset_id","created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "asset_rights_attestations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"reason" text NOT NULL,
	"excerpt" text,
	"source_url" text,
	"fingerprint" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asset_rights_attestations_asset_created_idx" ON "asset_rights_attestations" ("asset_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asset_rights_attestations_group_created_idx" ON "asset_rights_attestations" ("group_id","created_at");
