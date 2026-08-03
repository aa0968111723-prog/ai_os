-- 個人設定：頭像 URL（相對路徑，如 avatars/{userId}.jpg；null＝尚未設定）
-- 可向前相容；既有帳號預設無頭像。
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "avatar_url" text;
