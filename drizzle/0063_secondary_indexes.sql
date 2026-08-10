-- Aios hot-path secondary indexes (batch 2): the remaining per-project /
-- per-user tables (scene_presets / feedback_reports / text_versions /
-- google_calendar_connections) carried only their primary key, so every
-- project-scoped scene list, feedback "mine" / admin review list, text
-- version history read, and calendar-connection status sweep hit a seq scan
-- as the tables grew. This migration is additive only — no table, column,
-- constraint, or row is changed; every statement is guarded with
-- IF NOT EXISTS so re-running against any database is a no-op.
--   scene_presets             WHERE project_id … ORDER BY created_at ASC
--   feedback_reports.mine     WHERE user_id … ORDER BY created_at DESC LIMIT 100
--   feedback_reports.review   WHERE group_id … AND status … ORDER BY created_at DESC
--   feedback_reports.agent    WHERE status='open' AND agent_reviewed_at IS NULL ORDER BY created_at ASC
--   text_versions             WHERE kind … AND ref_id … ORDER BY created_at DESC
--   google_calendar_connections WHERE status='active'（同步佇列 + 週期對帳掃描）
CREATE INDEX IF NOT EXISTS "scene_presets_project_created_idx" ON "scene_presets" USING btree ("project_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "feedback_reports_user_created_idx" ON "feedback_reports" USING btree ("user_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "feedback_reports_group_status_created_idx" ON "feedback_reports" USING btree ("group_id","status","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "feedback_reports_status_agent_created_idx" ON "feedback_reports" USING btree ("status","agent_reviewed_at","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "text_versions_kind_ref_created_idx" ON "text_versions" USING btree ("kind","ref_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "google_calendar_connections_status_idx" ON "google_calendar_connections" USING btree ("status");
