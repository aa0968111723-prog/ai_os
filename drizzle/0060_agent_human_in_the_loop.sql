ALTER TABLE "agent_runs" ADD COLUMN IF NOT EXISTS "context_slots" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN IF NOT EXISTS "active_question_id" uuid;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_questions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "run_id" uuid NOT NULL,
  "group_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "step_id" text,
  "question_type" text NOT NULL,
  "title" text NOT NULL,
  "description" text NOT NULL,
  "required" boolean DEFAULT true NOT NULL,
  "options" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "allow_custom" boolean DEFAULT false NOT NULL,
  "default_option" text,
  "context" jsonb NOT NULL,
  "resume_token" uuid DEFAULT gen_random_uuid() NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "answer" jsonb,
  "answered_by" uuid,
  "answered_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_questions_pending_run_uq"
  ON "agent_questions" USING btree ("run_id") WHERE "status" = 'pending';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_questions_project_status_created_idx"
  ON "agent_questions" USING btree ("project_id", "status", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_questions_user_status_created_idx"
  ON "agent_questions" USING btree ("user_id", "status", "created_at");
