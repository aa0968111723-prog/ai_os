/**
 * Custom databases schema（個人→組→團隊→全站 四層範圍）
 */
import { pgTable, uuid, text, integer, boolean, timestamp, jsonb, index } from "drizzle-orm/pg-core";

/* ── 自訂資料庫（個人→組→團隊→全站 四層範圍） ─────────────
 * 願景：一套可從「個人筆記型清單」長到「組織級結構化資料」的輕量資料庫——
 * 欄位由使用者自訂（fields jsonb），列資料存 data_rows.data（jsonb）。
 * 權限完全沿用既有組織模型（見 services/databaseAcl.ts）：
 *   personal＝只有本人；group＝組成員（組長管理）；team＝團隊成員（團隊管理員管理）；
 *   global＝全站可讀（開發者管理）。memberWritable=false 時列資料只有管理者可寫。
 * 新表由正式 migration 建立。 */

export const dataTables = pgTable("data_tables", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** 範圍：personal=個人（僅本人）、group=組、team=團隊、global=全站 */
  scope: text("scope", { enum: ["personal", "group", "team", "global"] }).notNull(),
  /** personal 範圍的擁有者（其他範圍為 null） */
  ownerId: uuid("owner_id"),
  /** group 範圍所屬組（其他範圍為 null） */
  groupId: uuid("group_id"),
  /** team 範圍所屬團隊（其他範圍為 null） */
  teamId: uuid("team_id"),
  name: text("name").notNull(),
  description: text("description"),
  /** 欄位定義陣列（shared/databaseFields.ts 的 DataField[]）——結構是資料不是 schema，改欄位不動 DB */
  fields: jsonb("fields").notNull().default([]),
  /** true＝範圍內成員都能新增/編輯列；false＝只有管理者（組長/團隊管理員/開發者/建立者）能寫 */
  memberWritable: boolean("member_writable").notNull().default(true),
  /** AI／MCP 存取等級（管理者可調）：none＝AI 完全看不到、read＝AI 可查不可寫、write＝AI 可查可寫。
   *  約束的是「介面」（MCP 工具與團隊助手注入），人的網頁權限不受影響；
   *  實際查寫仍疊加使用者本人權限（databaseAcl），此欄只會更嚴、不會放寬。 */
  agentAccess: text("agent_access", { enum: ["none", "read", "write"] }).notNull().default("write"),
  createdBy: uuid("created_by").notNull(),
  /** 軟刪除：整庫誤刪可救（列資料原地保留）；所有列表查詢以 isNull(deletedAt) 過濾 */
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  ownerIdx: index("data_tables_owner_idx").on(t.ownerId),
  groupIdx: index("data_tables_group_idx").on(t.groupId),
  teamIdx: index("data_tables_team_idx").on(t.teamId),
}));

/**
 * 資料庫文件（AI 可讀的檔案層）：檔案上傳或網址匯入（Google 雲端/Notion 公開頁）掛在某個資料庫下。
 * - textContent＝伺服器抽出的純文字（AI 讀這裡；null＝此格式暫不可讀，僅存檔）。
 * - storagePath＝Volume 落地檔（null＝純文字匯入，只有 textContent）。
 * - 配額：每人（uploadedBy 加總 sizeBytes）預設 5GB，settings.fileQuotaGb 可調。
 * 新表由正式 migration 建立。
 */
export const dataFiles = pgTable("data_files", {
  id: uuid("id").primaryKey().defaultRandom(),
  tableId: uuid("table_id").notNull(),
  name: text("name").notNull(),
  mime: text("mime").notNull(),
  sizeBytes: integer("size_bytes").notNull().default(0),
  /** Volume 相對路徑（null＝僅文字，無原檔） */
  storagePath: text("storage_path"),
  /** 網址匯入的來源（供回溯與重新整理；上傳檔為 null） */
  sourceUrl: text("source_url"),
  /** 抽出的可讀文字（上限見 databaseFiles.MAX_TEXT_CHARS）；null＝AI 暫不可讀 */
  textContent: text("text_content"),
  /** 分類標籤（圖影與一般文件皆可）：人工可改、圖片可由 AI 自動分類填入。nullable 可向前相容 */
  category: text("category"),
  /** AI 看圖描述（vision 模型產生的繁中描述）：圖影檔的「AI 可讀」內容，
   *  團隊助手與 MCP 代理引用這裡回答「這張圖是什麼」。nullable 可向前相容 */
  aiDescription: text("ai_description"),
  uploadedBy: uuid("uploaded_by").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  tableIdx: index("data_files_table_idx").on(t.tableId),
  uploaderIdx: index("data_files_uploader_idx").on(t.uploadedBy),
}));

export const dataRows = pgTable("data_rows", {
  id: uuid("id").primaryKey().defaultRandom(),
  tableId: uuid("table_id").notNull(),
  /** 列資料：{ 欄位key: 值 }——值型別由欄位定義決定，寫入前經 validateRowData 清洗 */
  data: jsonb("data").notNull().default({}),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  tableIdx: index("data_rows_table_idx").on(t.tableId, t.createdAt),
}));
