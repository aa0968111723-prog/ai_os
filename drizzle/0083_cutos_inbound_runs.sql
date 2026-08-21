-- The inbound half of the CUTOS bridge: runs CUTOS asked AIOS to orchestrate.
-- Mirror image of cutos_tool_effects (AIOS → CUTOS). The unique idempotency key
-- is the whole point: a retried submit resolves to the AIOS run that already
-- exists instead of starting a second copy of the same editing job. The CUTOS
-- correlation columns are echoed back on every poll, which is what makes
-- aiosRunId ↔ cutosAgentRunId ↔ cutosJobId ↔ timelineRevision traceable from
-- either end. Governance is unchanged: the run enters the ordinary approval
-- gate, so an inbound submit cannot execute a destructive edit unattended.
CREATE TABLE IF NOT EXISTS "cutos_inbound_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "run_id" uuid NOT NULL,
  "group_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "cutos_project_id" text NOT NULL,
  "capability" text NOT NULL,
  "quality_profile" text NOT NULL,
  "request_id" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "cutos_agent_run_id" text,
  "trace_id" text,
  "timeline_revision" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- A retried submit lands on this row by construction, not by a read-then-write
-- race between two CUTOS retries arriving at the same moment.
CREATE UNIQUE INDEX IF NOT EXISTS "cutos_inbound_runs_idempotency_uq"
  ON "cutos_inbound_runs" USING btree ("idempotency_key");
--> statement-breakpoint
-- One inbound record per AIOS run: polling by run id can never be ambiguous.
CREATE UNIQUE INDEX IF NOT EXISTS "cutos_inbound_runs_run_uq"
  ON "cutos_inbound_runs" USING btree ("run_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cutos_inbound_runs_project_idx"
  ON "cutos_inbound_runs" USING btree ("project_id", "updated_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cutos_inbound_runs_cutos_project_idx"
  ON "cutos_inbound_runs" USING btree ("cutos_project_id", "updated_at");
