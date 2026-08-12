-- Agent retries must not create a second schedule row for the same run step.
DELETE FROM "schedule_items" a USING "schedule_items" b
WHERE a."plan_run_id" IS NOT NULL AND a."plan_step_id" IS NOT NULL
  AND a."plan_run_id" = b."plan_run_id" AND a."plan_step_id" = b."plan_step_id"
  AND (a."created_at", a."id") > (b."created_at", b."id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "schedule_items_plan_step_uq"
  ON "schedule_items" USING btree ("plan_run_id", "plan_step_id");
