ALTER TABLE "computer_sessions" ADD COLUMN IF NOT EXISTS "screenshot_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "computer_sessions" ADD COLUMN IF NOT EXISTS "escalated_from_session_id" uuid;
--> statement-breakpoint
ALTER TABLE "computer_sessions" ADD COLUMN IF NOT EXISTS "escalation_reason" text;
--> statement-breakpoint
ALTER TABLE "computer_sessions" ADD COLUMN IF NOT EXISTS "current_app" text;
