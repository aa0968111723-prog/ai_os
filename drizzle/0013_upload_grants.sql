-- AUTH-03: single-use upload grants (desktop handoff / long upload) + token_hash only
-- token_hash uniqueness matches schema `.unique()` → table CONSTRAINT (same as mcp_tokens)
CREATE TABLE IF NOT EXISTS "upload_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"user_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"source_asset_id" uuid,
	"handoff_id" text,
	"max_bytes" integer NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "upload_grants_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "upload_grants_user_idx" ON "upload_grants" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "upload_grants_expires_idx" ON "upload_grants" USING btree ("expires_at");
