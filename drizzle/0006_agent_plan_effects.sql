CREATE TABLE IF NOT EXISTS "agent_step_effects" (
	"id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"step_id" text NOT NULL,
	"kind" text NOT NULL,
	"output_type" text NOT NULL,
	"output_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN IF NOT EXISTS "plan_run_id" uuid;--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN IF NOT EXISTS "plan_step_id" text;--> statement-breakpoint
ALTER TABLE "schedule_items" ADD COLUMN IF NOT EXISTS "plan_run_id" uuid;--> statement-breakpoint
ALTER TABLE "schedule_items" ADD COLUMN IF NOT EXISTS "plan_step_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_step_effects_run_step_uq" ON "agent_step_effects" USING btree ("run_id","step_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_step_effects_run_idx" ON "agent_step_effects" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notes_plan_run_idx" ON "notes" USING btree ("plan_run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "schedule_items_plan_run_idx" ON "schedule_items" USING btree ("plan_run_id");
