-- 裝置綁定登入（docs/device-trust-design.md）：
-- 已信任的「人＋裝置」配對，陌生裝置需通過信箱驗證碼才發 session。
-- 全部 IF NOT EXISTS／nullable：既有 session 不受影響，上線不踢人。
--
-- ★所有欄位都寫在 CREATE TABLE 裡、不用後續 ALTER 補欄位：
--   legacy adoption bridge 比對的是「drizzle 產生的整表 DDL」，那是含全部欄位的
--   單一 CREATE TABLE；若在同一批 pending migration 裡先建表再 ALTER 加欄位，
--   兩邊的文字就對不起來（bridge 會判為非預期 drift）。
CREATE TABLE IF NOT EXISTS "user_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"label" text NOT NULL,
	"fingerprint_hash" text NOT NULL,
	"details" jsonb,
	"last_seen_at" timestamp,
	"last_seen_ip_hash" text,
	"trusted_at" timestamp DEFAULT now() NOT NULL,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- 裝置憑證全域唯一（token 為 randomBytes(32)，碰撞不可能；唯一鍵擋重複寫入）
CREATE UNIQUE INDEX IF NOT EXISTS "user_devices_token_hash_uq" ON "user_devices" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_devices_user_idx" ON "user_devices" USING btree ("user_id");--> statement-breakpoint

-- 陌生裝置的信箱驗證挑戰。刻意獨立於 email_step_up_challenges：語意不同
-- （那是已登入者要做敏感操作，這是還沒有 session 的登入關卡），信箱未設定時的降級策略
-- 剛好相反，且這張要綁定發起裝置的指紋。
CREATE TABLE IF NOT EXISTS "device_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"fingerprint_hash" text NOT NULL,
	"device_label" text NOT NULL,
	"details" jsonb,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp NOT NULL,
	"consumed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "device_challenges_user_idx" ON "device_challenges" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "device_challenges_expires_idx" ON "device_challenges" USING btree ("expires_at");--> statement-breakpoint

-- session 記錄它是由哪台已信任裝置簽發的；移除裝置即可連帶登出該裝置。
-- nullable：既有 session（含裝置信任尚未啟用期間簽發的）維持 null，不受影響。
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "device_id" uuid;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sessions_device_idx" ON "sessions" USING btree ("device_id");--> statement-breakpoint

-- 管理員預先授信（救援用）：此時刻前該帳號在陌生裝置登入免驗證碼。
-- 沒有這條路，enforce 模式下「同事在國外收不到信」就等於被鎖在門外。
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "device_grace_until" timestamp;
