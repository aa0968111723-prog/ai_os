CREATE TABLE IF NOT EXISTS "shot_context_packets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"shot_id" uuid NOT NULL,
	"schema_version" text NOT NULL,
	"fingerprint" text NOT NULL,
	"packet" jsonb NOT NULL,
	"parent_packet_id" uuid,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shot_context_packets_shot_created_idx" ON "shot_context_packets" ("shot_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shot_context_packets_project_shot_idx" ON "shot_context_packets" ("project_id","shot_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shot_context_packets_fingerprint_idx" ON "shot_context_packets" ("shot_id","fingerprint");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "shot_context_packet_heads" (
	"shot_id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"packet_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"stale" boolean DEFAULT false NOT NULL,
	"stale_reason" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shot_context_packet_heads_project_stale_idx" ON "shot_context_packet_heads" ("project_id","stale");
