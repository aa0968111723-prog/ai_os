ALTER TABLE "computer_sessions" ADD COLUMN IF NOT EXISTS "control_holder_user_id" uuid;
--> statement-breakpoint
ALTER TABLE "computer_sessions" ADD COLUMN IF NOT EXISTS "lease_expires_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "computer_sessions" ADD COLUMN IF NOT EXISTS "takeover_reason" text;
--> statement-breakpoint
ALTER TABLE "computer_sessions" ADD COLUMN IF NOT EXISTS "takeover_reason_code" text;
--> statement-breakpoint
ALTER TABLE "computer_sessions" ADD COLUMN IF NOT EXISTS "needs_reobserve" boolean DEFAULT false NOT NULL;
