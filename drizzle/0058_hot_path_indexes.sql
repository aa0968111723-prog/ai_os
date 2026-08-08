-- Aios hot-path secondary indexes: the four busiest per-project query tables
-- (projects / prompts / characters / workflow_runs) previously carried only
-- their primary key, so every project-scoped list, top-K prompt lookup, and
-- workflow status scan hit a seq scan. This migration is additive only — no
-- table, column, constraint, or row is changed; every statement is guarded
-- with IF NOT EXISTS so re-running against any database is a no-op.
--   projects      WHERE group_id … AND status <> 'archived' ORDER BY updated_at DESC
--   prompts       WHERE project_id … ORDER BY use_count DESC, updated_at DESC LIMIT 50
--   characters    WHERE project_id … ORDER BY created_at ASC
--   workflow_runs WHERE project_id … AND status … ORDER BY created_at DESC
CREATE INDEX IF NOT EXISTS "projects_group_status_updated_idx" ON "projects" USING btree ("group_id","status","updated_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prompts_project_used_idx" ON "prompts" USING btree ("project_id","use_count","updated_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "characters_project_created_idx" ON "characters" USING btree ("project_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_runs_project_status_created_idx" ON "workflow_runs" USING btree ("project_id","status","created_at");
