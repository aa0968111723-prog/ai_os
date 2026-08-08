-- 資料中心 P4／P6：專案×資源綁定，與匯入來源譜系。
--
-- 純新增（additive-only）：一張新表 ＋ 兩張既有表的 nullable 欄位。
-- 不改寫任何既有列、不刪任何欄位、不動任何既有行為；全部語句都有 IF NOT EXISTS 保護，
-- 重跑為 no-op。與 0025／0031 同一類（新表的欄位一律寫在 CREATE TABLE 裡，
-- 不在同一批 pending 內用 ALTER 補——否則 legacy bridge 比對整表 DDL 會對不起來）。
--
-- ── project_data_bindings（P4）────────────────────────────────────
-- 在此之前，一張資料表要跟專案扯上關係只有一條路：表裡某一列的「專案連結」欄位
-- 指向該專案（services/databaseProjectLinks）。那條路表達的是「這一列跟這個專案有關」，
-- 表達不了「整張表都給這個專案用」。這張表補上後者。
--
-- ★ 這是加法不是取代：既有 project link field 完全不動，所有讀取端一律 dual read
--   （兩邊聯集，見 services/projectDataBindings）。這一版不刪任何 legacy 行為。
-- ★ 綁定不放寬任何權限：能不能綁由 services/projectDataBindings 守門（personal 範圍
--   的表永遠不可綁），讀取時仍逐表重新解析 databaseAcl。綁定只決定「列不列進這個專案」。
-- ★ 不下 FOREIGN KEY：全站慣例（見 0026 ai_trace、0050 ai_site_trace）——
--   跨領域引用一律以 uuid 存、由服務層守門，孤兒列由讀取端 join 過濾。
--
-- ── 來源譜系（P6）──────────────────────────────────────────────
-- knowledge 在此之前完全沒有來源欄位：從 Google 雲端轉存進來的腳本，跟手動貼上的
-- 筆記在資料庫裡長得一模一樣。data_files 只有 source_url，回答不了「這是 Google
-- 還是 Notion」「對方那邊改了沒」。全部 nullable：舊列維持 null，UI 據此誠實留白，
-- 不猜、不回填——把不確定的東西標成「Google 雲端」比留白更糟。
--
-- last_synced_at 的語意是「本站最後一次真的去抓的時刻」（匯入或按重新整理），
-- 不是排程同步——站內沒有背景同步，這一版也不加。
CREATE TABLE IF NOT EXISTS "project_data_bindings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "group_id" uuid NOT NULL,
  "resource_kind" text NOT NULL,
  "resource_id" uuid NOT NULL,
  "created_by" uuid NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_data_bindings_project_resource_idx" ON "project_data_bindings" USING btree ("project_id","resource_kind","resource_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_data_bindings_resource_idx" ON "project_data_bindings" USING btree ("resource_kind","resource_id");
--> statement-breakpoint
ALTER TABLE "data_files" ADD COLUMN IF NOT EXISTS "source_provider" text;
--> statement-breakpoint
ALTER TABLE "data_files" ADD COLUMN IF NOT EXISTS "source_external_id" text;
--> statement-breakpoint
ALTER TABLE "data_files" ADD COLUMN IF NOT EXISTS "source_modified_at" timestamp;
--> statement-breakpoint
ALTER TABLE "data_files" ADD COLUMN IF NOT EXISTS "last_synced_at" timestamp;
--> statement-breakpoint
ALTER TABLE "knowledge" ADD COLUMN IF NOT EXISTS "source_provider" text;
--> statement-breakpoint
ALTER TABLE "knowledge" ADD COLUMN IF NOT EXISTS "source_url" text;
--> statement-breakpoint
ALTER TABLE "knowledge" ADD COLUMN IF NOT EXISTS "source_external_id" text;
--> statement-breakpoint
ALTER TABLE "knowledge" ADD COLUMN IF NOT EXISTS "source_modified_at" timestamp;
--> statement-breakpoint
ALTER TABLE "knowledge" ADD COLUMN IF NOT EXISTS "last_synced_at" timestamp;
