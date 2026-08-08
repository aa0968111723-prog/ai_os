/**
 * Custom databases schema（個人→組→團隊→全站 四層範圍）
 */
import { pgTable, uuid, text, integer, boolean, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";

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
  /* ── 來源譜系（P6）：全部 nullable，舊列維持 null＝「來源不明」，UI 據此誠實留白 ──
   * sourceUrl 只回答「從哪個網址抓的」，回答不了「這是 Google 還是 Notion」「對方那邊改了沒」。
   * 猜是不行的：把不確定的東西標成「Google 雲端」比留白更糟。所以匯入當下就把已知的記下來。 */
  /** 來源供應商：google-drive／notion／url／api（與 shared/dataHub 的 DataHubSource 同字） */
  sourceProvider: text("source_provider"),
  /** 對方系統裡的穩定 id（Google fileId／Notion page id）——網址會變，這個不會 */
  sourceExternalId: text("source_external_id"),
  /** 來源端的最後修改時刻（抓取當下由對方 API 給）：可據此顯示「來源有更新」 */
  sourceModifiedAt: timestamp("source_modified_at"),
  /** 本站最後一次真的去抓的時刻（匯入或重新整理）——不是「排程同步」，站內沒有背景同步 */
  lastSyncedAt: timestamp("last_synced_at"),
  uploadedBy: uuid("uploaded_by").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  tableIdx: index("data_files_table_idx").on(t.tableId),
  uploaderIdx: index("data_files_uploader_idx").on(t.uploadedBy),
}));

/**
 * 專案 × 資源綁定（P4）：把「整份資源」提供給某個專案。
 *
 * 為什麼需要它——在此之前，一張資料表要跟專案扯上關係，只有一條路：
 * 表裡某一列的「專案連結」欄位指向該專案（見 services/databaseProjectLinks）。
 * 那條路表達的是「這一列跟這個專案有關」，表達不了「整張表都給這個專案用」，
 * 而且規則本身不容易被發現（docs/data-hub-current-state-2026-08.md §13.7）。
 *
 * ★ 這是**加法**，不是取代：既有的 project link field 完全不動，所有讀取端一律
 *   dual read（兩邊聯集）。第一支 migration 不刪任何 legacy 行為。
 *
 * ★ ACL：綁定**不放寬任何權限**。能不能綁由 services/projectDataBindings 守門——
 *   personal 範圍的表永遠不可綁（否則個人私有資料會經專案助手外洩給整組人，
 *   違反 docs §14 的不變量與 §43）。讀取時仍逐表重新解析 databaseAcl，
 *   綁定只影響「列不列進這個專案」，不影響「這個人看不看得到」。
 *
 * resourceKind 目前只開放 table：knowledge 與 asset 本來就有 project_id（已經綁好了），
 * document 的權限跟隨所屬表、綁表即涵蓋。欄位留 text 是為了之後要擴充時不必動 schema。
 * 新表由正式 migration 0051 建立。
 */
export const projectDataBindings = pgTable("project_data_bindings", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull(),
  /** 專案所屬組（冗餘欄，與 knowledge／assets 同慣例）：組隔離查詢不必每次 join projects */
  groupId: uuid("group_id").notNull(),
  /** 資源種類（對應 shared/dataHub 的 DataHubKind）；目前只寫入 "table" */
  resourceKind: text("resource_kind").notNull(),
  resourceId: uuid("resource_id").notNull(),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  // 同一個專案不會重複綁同一份資源——重複綁定是使用者按兩次，不該長出兩列
  projectResourceIdx: uniqueIndex("project_data_bindings_project_resource_idx")
    .on(t.projectId, t.resourceKind, t.resourceId),
  // 反向查「這份資源被哪些專案用了」（解除綁定與刪表前的影響範圍提示）
  resourceIdx: index("project_data_bindings_resource_idx").on(t.resourceKind, t.resourceId),
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
