-- AUTH-02: session device meta for list/revoke UI (nullable for forward-compat)
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "last_seen_at" timestamp;
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "user_agent" text;
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "ip_hash" text;
