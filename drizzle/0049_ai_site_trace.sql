-- 全站助手問答軌跡（ai_site_trace_sessions）：跨專案／無專案上下文的 site_ask session 分表。
--
-- 為什麼分表而不是放寬 ai_trace_sessions.project_id 的 NOT NULL：
-- 專案軌跡的讀取 API 全部以 projectId 起手（project-editor ACL），放寬 nullable 等於
-- 每個讀取端都要多一條「無專案」分支——ADR-010 對同型問題（agent_events）已明文反對
-- 為上層方便放寬 NOT NULL，這裡照該先例分表。
--
-- group_id 保 NOT NULL 的前提：全站助手單次會話 scope 固定為作用中單一組
-- （GLOBAL_ASSISTANT_PLAN §6-2「不做跨組資料聚合」）。
-- project_id 是「發問當下人在哪個專案頁」的脈絡提示，可空、非授權依據。
--
-- 事件不另開表：ai_trace_events.session_id 本來就是無 FK 的 uuid（0026），
-- site session 的事件寫進同一張表、共用同一套 sanitize 與 advisory-lock sequence。
CREATE TABLE IF NOT EXISTS "ai_site_trace_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "group_id" uuid NOT NULL,
  "project_id" uuid,
  "user_id" uuid NOT NULL,
  "mode" text DEFAULT 'site_ask' NOT NULL,
  "status" text DEFAULT 'prepared' NOT NULL,
  "title" text NOT NULL,
  "provider" text,
  "model" text,
  "summary" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_site_trace_sessions_group_created_idx" ON "ai_site_trace_sessions" USING btree ("group_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_site_trace_sessions_user_created_idx" ON "ai_site_trace_sessions" USING btree ("user_id", "created_at");
