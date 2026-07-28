CREATE TABLE IF NOT EXISTS "agent_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"step_id" text,
	"step_index" integer,
	"event_key" text NOT NULL,
	"event_type" text NOT NULL,
	"actor_type" text DEFAULT 'system' NOT NULL,
	"actor_id" uuid,
	"summary" text NOT NULL,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_events_run_event_uq" ON "agent_events" USING btree ("run_id","event_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_events_run_created_idx" ON "agent_events" USING btree ("run_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_events_project_created_idx" ON "agent_events" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_runs_project_status_created_idx" ON "agent_runs" USING btree ("project_id","status","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_runs_status_updated_idx" ON "agent_runs" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_runs_user_status_idx" ON "agent_runs" USING btree ("user_id","status");
