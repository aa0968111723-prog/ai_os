-- Whole-table DDL must match schema.ts for bridge comparison.
CREATE TABLE IF NOT EXISTS "computer_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "run_id" uuid,
  "step_id" text,
  "project_id" uuid NOT NULL,
  "group_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "runtime_kind" text DEFAULT 'browser' NOT NULL,
  "provider" text NOT NULL,
  "provider_session_ref" text NOT NULL,
  "status" text DEFAULT 'requested' NOT NULL,
  "control_holder" text DEFAULT 'none' NOT NULL,
  "control_holder_user_id" uuid,
  "lease_version" integer DEFAULT 0 NOT NULL,
  "lease_expires_at" timestamp with time zone,
  "session_revision" integer DEFAULT 0 NOT NULL,
  "current_url" text,
  "label" text,
  "takeover_reason" text,
  "takeover_reason_code" text,
  "needs_reobserve" boolean DEFAULT false NOT NULL,
  "action_count" integer DEFAULT 0 NOT NULL,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "ended_at" timestamp with time zone,
  "termination_reason" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "computer_sessions_project_status_idx"
  ON "computer_sessions" USING btree ("project_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "computer_sessions_group_status_idx"
  ON "computer_sessions" USING btree ("group_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "computer_sessions_user_status_idx"
  ON "computer_sessions" USING btree ("user_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "computer_sessions_run_idx"
  ON "computer_sessions" USING btree ("run_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "computer_sessions_expires_idx"
  ON "computer_sessions" USING btree ("expires_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "computer_actions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "session_id" uuid NOT NULL,
  "run_id" uuid,
  "step_id" text,
  "action_id" text NOT NULL,
  "sequence" integer DEFAULT 0 NOT NULL,
  "actor_type" text DEFAULT 'agent' NOT NULL,
  "action_kind" text NOT NULL,
  "safe_target" text DEFAULT '' NOT NULL,
  "status" text DEFAULT 'requested' NOT NULL,
  "risk_level" text DEFAULT 'low' NOT NULL,
  "approval_id" uuid,
  "result_summary" text,
  "error_code" text,
  "lease_version" integer,
  "expected_session_revision" integer,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "computer_actions_action_id_uq"
  ON "computer_actions" USING btree ("action_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "computer_actions_session_seq_idx"
  ON "computer_actions" USING btree ("session_id", "sequence");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "computer_actions_session_status_idx"
  ON "computer_actions" USING btree ("session_id", "status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "computer_live_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "session_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "token_hash" text NOT NULL,
  "mode" text DEFAULT 'watch' NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "revoked" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "computer_live_tokens_hash_uq"
  ON "computer_live_tokens" USING btree ("token_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "computer_live_tokens_session_idx"
  ON "computer_live_tokens" USING btree ("session_id");
