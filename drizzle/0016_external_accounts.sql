-- #224 PR1：外部帳號連結（目前只有 Adobe）——OAuth 雙 token 加密落庫。
-- IF NOT EXISTS 沿用 0013 慣例：重複套用不炸（migration CI 會再跑一次驗冪等）。
CREATE TABLE IF NOT EXISTS "external_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"account_email" text,
	"account_id" text,
	"access_token_enc" text,
	"refresh_token_enc" text,
	"expires_at" timestamp,
	"scope" text,
	"mode" text DEFAULT 'mock' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"last_error" text,
	"last_used_at" timestamp,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "external_accounts_user_provider_idx" ON "external_accounts" USING btree ("user_id","provider");
