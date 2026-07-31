-- 知識庫摘要：更新全文時自動抽取；注入預算緊時可塞摘要覆蓋更多篇。
ALTER TABLE "knowledge" ADD COLUMN IF NOT EXISTS "summary" text;
