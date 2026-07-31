-- AUTH: email step-up challenges for sensitive operations (option B)
CREATE TABLE IF NOT EXISTS "email_step_up_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"consumed_at" timestamp,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_step_up_challenges_user_idx" ON "email_step_up_challenges" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_step_up_challenges_expires_idx" ON "email_step_up_challenges" USING btree ("expires_at");
