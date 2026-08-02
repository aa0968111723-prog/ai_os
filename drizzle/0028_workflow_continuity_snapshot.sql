ALTER TABLE "workflow_runs" ADD COLUMN IF NOT EXISTS "continuity_snapshot" jsonb;
