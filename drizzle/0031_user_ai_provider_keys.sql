-- BYOK Phase 1：使用者自帶 AI 供應商金鑰（目前僅 fal）。
-- 與 external_accounts / user_integrations 同慣例：secret_enc 為 AES-256-GCM 密文，
-- 原文永不回前端；一人一 provider 一條（重新設定＝覆蓋）。
-- IF NOT EXISTS 沿用 0016 慣例：重複套用不炸。
CREATE TABLE IF NOT EXISTS "user_ai_provider_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"secret_enc" text NOT NULL,
	"key_last4" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"prefer_user_key" boolean DEFAULT true NOT NULL,
	"validated_at" timestamp,
	"last_used_at" timestamp,
	"last_error" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_ai_provider_keys_user_provider_idx" ON "user_ai_provider_keys" USING btree ("user_id","provider");
