CREATE TABLE IF NOT EXISTS "agent_tool_receipts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "run_id" uuid NOT NULL,
  "idempotency_key" text NOT NULL,
  "tool_id" text NOT NULL,
  "result" jsonb,
  "reserved_points" integer DEFAULT 0 NOT NULL,
  "actual_points" integer,
  "settled" boolean DEFAULT false NOT NULL,
  "verified_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_tool_receipts_idempotency_uq" ON "agent_tool_receipts" USING btree ("idempotency_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_tool_receipts_run_idx" ON "agent_tool_receipts" USING btree ("run_id");
