-- BYOK Phase 1：個人 AI API Key（目前只支援 fal）
-- 一人一供應商一條；secret_enc 為 AES-256-GCM（iv:tag:cipher hex），金鑰見 services/userAiKeys.ts
-- IF NOT EXISTS 沿用 0016 慣例：重複套用不炸
CREATE TABLE IF NOT EXISTS "user_ai_provider_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"secret_enc" text NOT NULL,
	"key_last4" text NOT NULL,
	"status" text DEFAULT 'unverified' NOT NULL,
	"prefer_user_key" boolean DEFAULT true NOT NULL,
	"validated_at" timestamp,
	"last_used_at" timestamp,
	"last_error" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_ai_provider_keys_user_provider_idx" ON "user_ai_provider_keys" USING btree ("user_id","provider");
