-- CUTOS bridge (cutos.agent.v2). Durable AIOS-side state for the CUTOS
-- integration: which CUTOS project an AIOS project may touch, the intent
-- record for every CUTOS write (written before the call so a crash is
-- recoverable), and the mirrored cross-system activity feed.
CREATE TABLE IF NOT EXISTS "aios_cutos_project_bindings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "group_id" uuid NOT NULL,
  "aios_project_id" uuid NOT NULL,
  "cutos_project_id" text NOT NULL,
  "cutos_project_name" text,
  "last_timeline_revision" integer,
  "cutos_base_url" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- One CUTOS project per AIOS project, and one owner per CUTOS project: an
-- agent cannot widen its own scope by binding a second video project.
CREATE UNIQUE INDEX IF NOT EXISTS "aios_cutos_bindings_aios_project_uq"
  ON "aios_cutos_project_bindings" USING btree ("aios_project_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "aios_cutos_bindings_cutos_project_uq"
  ON "aios_cutos_project_bindings" USING btree ("cutos_project_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "aios_cutos_bindings_group_idx"
  ON "aios_cutos_project_bindings" USING btree ("group_id", "updated_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cutos_tool_effects" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "run_id" uuid NOT NULL,
  "step_id" text NOT NULL,
  "user_id" uuid NOT NULL,
  "group_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "cutos_project_id" text NOT NULL,
  "tool_id" text NOT NULL,
  "capability" text NOT NULL,
  "request_id" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "expected_revision" integer,
  "status" text DEFAULT 'prepared' NOT NULL,
  "cutos_agent_run_id" text,
  "cutos_job_id" text,
  "timeline_revision" integer,
  "result_ref" jsonb,
  "error_code" text,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- A retry lands on the same row by construction; two concurrent attempts
-- cannot both believe they own the effect.
CREATE UNIQUE INDEX IF NOT EXISTS "cutos_tool_effects_idempotency_uq"
  ON "cutos_tool_effects" USING btree ("idempotency_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cutos_tool_effects_run_step_idx"
  ON "cutos_tool_effects" USING btree ("run_id", "step_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cutos_tool_effects_status_updated_idx"
  ON "cutos_tool_effects" USING btree ("status", "updated_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cutos_tool_effects_job_idx"
  ON "cutos_tool_effects" USING btree ("cutos_job_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cutos_activity_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "source_event_id" text NOT NULL,
  "run_id" uuid,
  "step_id" text,
  "group_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "cutos_project_id" text NOT NULL,
  "cutos_agent_run_id" text,
  "cutos_job_id" text,
  "kind" text NOT NULL,
  "status" text NOT NULL,
  "message_key" text NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "occurred_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cutos_activity_source_uq"
  ON "cutos_activity_events" USING btree ("cutos_project_id", "source_event_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cutos_activity_project_occurred_idx"
  ON "cutos_activity_events" USING btree ("project_id", "occurred_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cutos_activity_run_idx"
  ON "cutos_activity_events" USING btree ("run_id", "occurred_at");
