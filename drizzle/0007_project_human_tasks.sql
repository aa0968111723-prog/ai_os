CREATE TABLE IF NOT EXISTS "project_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"plan_run_id" uuid,
	"plan_step_id" text,
	"wake_run_id" uuid,
	"wake_step_id" text,
	"task_type" text DEFAULT 'task' NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"assignee_id" uuid,
	"approver_role" text,
	"status" text DEFAULT 'todo' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"starts_at" timestamp with time zone,
	"due_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"completed_by" uuid,
	"completed_at" timestamp with time zone,
	"source_message_id" uuid,
	"mentions" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_tasks_plan_step_uq" ON "project_tasks" USING btree ("plan_run_id","plan_step_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_tasks_project_status_idx" ON "project_tasks" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_tasks_group_status_idx" ON "project_tasks" USING btree ("group_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_tasks_assignee_status_idx" ON "project_tasks" USING btree ("assignee_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_tasks_wake_run_idx" ON "project_tasks" USING btree ("wake_run_id");
