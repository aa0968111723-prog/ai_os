-- Agent retries must not create a second note/task for the same run step.
-- Keep the oldest row when duplicates already exist. Manual notes without a
-- plan step stay unconstrained.
DELETE FROM "notes" a USING "notes" b
WHERE a."plan_run_id" IS NOT NULL AND a."plan_step_id" IS NOT NULL
  AND a."plan_run_id" = b."plan_run_id" AND a."plan_step_id" = b."plan_step_id"
  AND (a."created_at", a."id") > (b."created_at", b."id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "notes_plan_step_uq"
  ON "notes" USING btree ("plan_run_id", "plan_step_id");
