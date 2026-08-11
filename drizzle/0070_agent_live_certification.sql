ALTER TABLE "agent_runs" ADD COLUMN IF NOT EXISTS "lock_version" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "agent_tool_receipts" ADD COLUMN IF NOT EXISTS "user_id" uuid;
--> statement-breakpoint
ALTER TABLE "agent_tool_receipts" ADD COLUMN IF NOT EXISTS "group_id" uuid;
--> statement-breakpoint
ALTER TABLE "agent_tool_receipts" ADD COLUMN IF NOT EXISTS "project_id" uuid;
--> statement-breakpoint
UPDATE "agent_tool_receipts" tr SET "user_id" = r."user_id", "group_id" = r."group_id", "project_id" = r."project_id" FROM "agent_runs" r WHERE r."id" = tr."run_id" AND (tr."user_id" IS NULL OR tr."group_id" IS NULL OR tr."project_id" IS NULL);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_tool_receipts_group_run_idx" ON "agent_tool_receipts" USING btree ("group_id", "run_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_tool_receipts_project_created_idx" ON "agent_tool_receipts" USING btree ("project_id", "created_at");
--> statement-breakpoint
ALTER TABLE "agent_tool_receipts" ADD COLUMN IF NOT EXISTS "step_id" text;
--> statement-breakpoint
ALTER TABLE "agent_tool_receipts" ADD COLUMN IF NOT EXISTS "tool_call_id" uuid;
--> statement-breakpoint
ALTER TABLE "agent_tool_receipts" ADD COLUMN IF NOT EXISTS "attempt_id" uuid;
--> statement-breakpoint
ALTER TABLE "agent_tool_receipts" ADD COLUMN IF NOT EXISTS "effect_fingerprint" text;
--> statement-breakpoint
ALTER TABLE "agent_tool_receipts" ADD COLUMN IF NOT EXISTS "handler_identity" text;
--> statement-breakpoint
ALTER TABLE "agent_tool_receipts" ADD COLUMN IF NOT EXISTS "trace_id" text;
--> statement-breakpoint
ALTER TABLE "agent_tool_receipts" ADD COLUMN IF NOT EXISTS "conversation_id" text;
--> statement-breakpoint
ALTER TABLE "agent_tool_receipts" ADD COLUMN IF NOT EXISTS "goal_id" text;
--> statement-breakpoint
ALTER TABLE "agent_tool_receipts" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'reserved' NOT NULL;
--> statement-breakpoint
ALTER TABLE "agent_tool_receipts" ADD COLUMN IF NOT EXISTS "lease_owner" uuid;
--> statement-breakpoint
ALTER TABLE "agent_tool_receipts" ADD COLUMN IF NOT EXISTS "lease_expires_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "agent_tool_receipts" ADD COLUMN IF NOT EXISTS "requested_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "agent_tool_receipts" ADD COLUMN IF NOT EXISTS "executed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "agent_tool_receipts" ADD COLUMN IF NOT EXISTS "verification_stage" text;
--> statement-breakpoint
ALTER TABLE "agent_tool_receipts" ADD COLUMN IF NOT EXISTS "verification_method" text;
--> statement-breakpoint
ALTER TABLE "agent_tool_receipts" ADD COLUMN IF NOT EXISTS "target_refs" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "agent_tool_receipts" ADD COLUMN IF NOT EXISTS "trust_origin" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_tool_receipts_lease_idx" ON "agent_tool_receipts" USING btree ("status", "lease_expires_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_capability_certifications" (
  "capability_id" text PRIMARY KEY NOT NULL,
  "certification_state" text DEFAULT 'DECLARED_ONLY' NOT NULL,
  "verification_mode" text DEFAULT 'contract' NOT NULL,
  "proof" jsonb DEFAULT '{"useful":false,"declared":false,"reachable":false,"executable":false,"resolvable":false,"verifiable":false}'::jsonb NOT NULL,
  "evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "success_rate" real,
  "p95_ms" integer,
  "blocker_reason" text,
  "deployment_sha" text,
  "schema_version" text,
  "registry_hash" text,
  "last_verified_at" timestamp with time zone,
  "updated_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_capability_certifications_state_verified_idx" ON "agent_capability_certifications" USING btree ("certification_state", "last_verified_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "assistant_conversation_states" (
  "conversation_id" text PRIMARY KEY NOT NULL,
  "group_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "project_id" uuid,
  "run_id" text,
  "goal_id" uuid,
  "plan_revision" integer DEFAULT 1 NOT NULL,
  "status" text DEFAULT 'running' NOT NULL,
  "messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "active_goal" jsonb,
  "recent_action_results" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "events" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "memory_metadata" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assistant_conversation_states_owner_updated_idx" ON "assistant_conversation_states" USING btree ("group_id", "user_id", "updated_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assistant_conversation_states_run_idx" ON "assistant_conversation_states" USING btree ("run_id");
