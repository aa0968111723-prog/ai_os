CREATE TABLE IF NOT EXISTS "story_entity_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"story_id" uuid NOT NULL,
	"story_rev" integer DEFAULT 0 NOT NULL,
	"mention_text" text NOT NULL,
	"mention_key" text NOT NULL,
	"span_start" integer,
	"span_end" integer,
	"entity_kind" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"entity_rev" integer,
	"source" text DEFAULT 'auto' NOT NULL,
	"confidence" real,
	"locked" boolean DEFAULT false NOT NULL,
	"reason" text,
	"aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "story_entity_bindings_project_mention_uq" ON "story_entity_bindings" ("project_id","mention_key","entity_kind");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "story_entity_bindings_project_kind_idx" ON "story_entity_bindings" ("project_id","entity_kind");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "story_entity_bindings_entity_idx" ON "story_entity_bindings" ("entity_kind","entity_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "story_entity_binding_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"story_id" uuid NOT NULL,
	"story_rev" integer DEFAULT 0 NOT NULL,
	"mention_text" text NOT NULL,
	"mention_key" text NOT NULL,
	"span_start" integer,
	"span_end" integer,
	"entity_kind" text NOT NULL,
	"candidates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp,
	"resolved_by" uuid,
	"applied_binding_id" uuid
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "story_entity_binding_proposals_project_status_idx" ON "story_entity_binding_proposals" ("project_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "story_entity_binding_proposals_mention_idx" ON "story_entity_binding_proposals" ("project_id","mention_key","entity_kind");
