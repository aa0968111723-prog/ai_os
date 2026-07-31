-- P1c：使用者介面密度偏好（跨裝置同步）。
-- 注意：drizzle-kit generate 原本在本檔夾帶 upload_grants／model_live_catalog／
-- sessions 追蹤欄位等「早已存在於所有真實 DB」的結構（0013 手寫時未更新 snapshot，
-- 產生器誤以為要補建；照套會撞 duplicate table）。本檔改寫為只含本次真正的新變更；
-- meta snapshot 保留原樣——它現在正確反映 TS schema，讓之後的 generate 不再誤報。
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "ui_density" text;
