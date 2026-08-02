CREATE TABLE IF NOT EXISTS "ai_trace_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "group_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "mode" text NOT NULL,
  "status" text DEFAULT 'prepared' NOT NULL,
  "source_type" text,
  "source_id" uuid,
  "title" text NOT NULL,
  "provider" text,
  "model" text,
  "summary" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_trace_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "session_id" uuid NOT NULL,
  "sequence" integer NOT NULL,
  "event_type" text NOT NULL,
  "summary" text NOT NULL,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "payload_sha256" text,
  "truncated_fields" jsonb,
  "latency_ms" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_trace_sessions_project_created_idx" ON "ai_trace_sessions" ("project_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_trace_sessions_group_created_idx" ON "ai_trace_sessions" ("group_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_trace_sessions_source_idx" ON "ai_trace_sessions" ("source_type", "source_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ai_trace_events_session_sequence_uq" ON "ai_trace_events" ("session_id", "sequence");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_trace_events_session_created_idx" ON "ai_trace_events" ("session_id", "created_at");
--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD COLUMN IF NOT EXISTS "step_prompt_overrides" jsonb;
--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD COLUMN IF NOT EXISTS "trace_session_id" uuid;
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN IF NOT EXISTS "trace_session_id" uuid;
