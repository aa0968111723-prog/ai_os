-- Legacy cleanup is deliberately versioned and reviewable. Keep the newest
-- questionnaire per user/group before enforcing the invariant.
DELETE FROM "feedback" a USING "feedback" b
WHERE a."user_id" = b."user_id"
  AND a."group_id" IS NOT DISTINCT FROM b."group_id"
  AND (a."created_at", a."id"::text) < (b."created_at", b."id"::text);--> statement-breakpoint
CREATE UNIQUE INDEX "feedback_user_group_uq" ON "feedback" USING btree ("user_id",coalesce("group_id", '00000000-0000-0000-0000-000000000000'::uuid));--> statement-breakpoint
CREATE INDEX "generations_active_idx" ON "generations" USING btree ("updated_at") WHERE "generations"."status" in ('queued','running');--> statement-breakpoint
CREATE INDEX "generations_project_active_idx" ON "generations" USING btree ("project_id","updated_at") WHERE "generations"."status" in ('queued','running');--> statement-breakpoint
-- Keep the oldest option row (the original seed) deterministically.
DELETE FROM "group_options" a USING "group_options" b
WHERE a."group_id" = b."group_id"
  AND a."type" = b."type"
  AND a."value" = b."value"
  AND (a."created_at", a."id"::text) > (b."created_at", b."id"::text);--> statement-breakpoint
CREATE UNIQUE INDEX "group_options_group_type_value_uq" ON "group_options" USING btree ("group_id","type","value");
