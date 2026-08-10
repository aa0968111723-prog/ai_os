-- A Command Center run must be durable before it knows which project the user
-- means.  The existing Human-in-the-loop answer binds project_id atomically;
-- no placeholder project and no second question store are introduced.
ALTER TABLE "agent_runs" ALTER COLUMN "project_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "agent_questions" ALTER COLUMN "project_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "agent_events" ALTER COLUMN "project_id" DROP NOT NULL;
