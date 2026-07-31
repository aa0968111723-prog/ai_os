-- 知識庫釘選：注入時優先於「僅依建立時間新→舊」，避免新筆記擠掉主腳本／開示。
ALTER TABLE "knowledge" ADD COLUMN IF NOT EXISTS "pinned" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_project_pinned_created_idx" ON "knowledge" USING btree ("project_id","pinned","created_at");
