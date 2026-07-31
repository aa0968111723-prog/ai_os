-- 組代理總指揮（L1 監督權／L2 調度權／L3 常駐計畫）。
--
-- 組代理原本只有「唯讀分析＋提議派工」：看得到一份子計畫失敗不能重跑、看得到待核堵著不能核准，
-- 看得到誰逾期不能改期。這份 migration 補上三樣東西：
--   1. group_members.agent_command_level：分級授權，取代只回答「能不能生出待核計畫」的單一布林。
--   2. group_agent_runs：組代理自己的多步調度計畫（campaign），一步 dispatch 產生一份 agent_runs。
--   3. group_agent_events：組級事件軌跡。不共用 agent_events——那張表 project_id NOT NULL，
--      而組代理最重要的幾件事（下令、超預算停手、跳過整條支線）不屬於任何單一專案。
ALTER TABLE "group_members" ADD COLUMN IF NOT EXISTS "agent_command_level" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "group_agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"goal" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"rationale" text,
	"status" text DEFAULT 'awaiting_approval' NOT NULL,
	"steps" jsonb NOT NULL,
	"budget_points" integer DEFAULT 0 NOT NULL,
	"spent_points" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "group_agent_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"run_id" uuid,
	"project_id" uuid,
	"child_run_id" uuid,
	"step_id" text,
	"event_key" text NOT NULL,
	"event_type" text NOT NULL,
	"actor_type" text DEFAULT 'system' NOT NULL,
	"actor_id" uuid,
	"summary" text NOT NULL,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "group_agent_runs_group_status_updated_idx" ON "group_agent_runs" USING btree ("group_id","status","updated_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "group_agent_runs_status_updated_idx" ON "group_agent_runs" USING btree ("status","updated_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "group_agent_events_run_event_uq" ON "group_agent_events" USING btree ("run_id","event_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "group_agent_events_group_created_idx" ON "group_agent_events" USING btree ("group_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "group_agent_events_run_created_idx" ON "group_agent_events" USING btree ("run_id","created_at");
