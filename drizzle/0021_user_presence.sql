-- 私訊「誰在線上」：每位使用者一列的最後活躍時刻，由 tRPC 中介層節流寫入（services/presence）。
-- 純新增一張表、不動任何既有資料；IF NOT EXISTS 沿用 0013 以降的慣例（重複套用不炸，CI 會再跑一次驗冪等）。
-- 離線是「時間過了」自然發生的，沒有下線事件要寫，所以不需要任何回填或清理步驟。
CREATE TABLE IF NOT EXISTS "user_presence" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"last_active_at" timestamp with time zone DEFAULT now() NOT NULL
);
