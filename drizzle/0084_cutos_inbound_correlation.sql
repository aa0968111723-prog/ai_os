-- Corrections to cutos_inbound_runs, all additive.
--
-- 1. `cutos_job_id` — the request schema permits CUTOS to declare its own job
--    id, but the submit path stored only the agent-run id, so a job-correlated
--    caller lost that link on the very first reply and every later poll. The
--    documented aiosRunId ↔ cutosAgentRunId ↔ cutosJobId chain needs it.
-- 2. `expected_revision` — the submitter's belief was being written into
--    `timeline_revision` and echoed back as the run's RESULTING revision, which
--    hands CUTOS a stale number to guard its next mutation with. The two are now
--    separate: `timeline_revision` stays null until the run's own work lands.
-- 3. `request_fingerprint` — the replay check compared only the CUTOS project,
--    so the same key submitted with a different capability or goal returned the
--    unrelated earlier run with HTTP 200 (an export request could appear
--    successfully attached to an edit-plan run). Nullable because rows written
--    before this migration have no fingerprint to compare against; those are
--    treated as unverifiable rather than as a match.
ALTER TABLE "cutos_inbound_runs" ADD COLUMN IF NOT EXISTS "cutos_job_id" text;
--> statement-breakpoint
ALTER TABLE "cutos_inbound_runs" ADD COLUMN IF NOT EXISTS "expected_revision" integer;
--> statement-breakpoint
ALTER TABLE "cutos_inbound_runs" ADD COLUMN IF NOT EXISTS "request_fingerprint" text;
