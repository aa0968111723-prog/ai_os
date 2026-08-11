CREATE TABLE IF NOT EXISTS "computer_auth_contexts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"service_host" text NOT NULL,
	"service_label" text DEFAULT '' NOT NULL,
	"scope" text DEFAULT 'browser_session' NOT NULL,
	"provider" text NOT NULL,
	"context_enc" text NOT NULL,
	"context_fingerprint" text NOT NULL,
	"source_session_id" uuid,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "computer_auth_contexts_user_host_idx" ON "computer_auth_contexts" USING btree ("user_id","service_host");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "computer_auth_contexts_user_idx" ON "computer_auth_contexts" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "computer_auth_contexts_expires_idx" ON "computer_auth_contexts" USING btree ("expires_at");
