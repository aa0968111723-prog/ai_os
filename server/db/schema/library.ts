/**
 * Canonical Library Resource layer + Folder Import 2.0 + Project/Scene/Shot Context.
 *
 * 三組表，一個共同原則：**additive sidecar，不動既有真相表**。
 * `assets` / `knowledge` / `data_files` / `data_tables` 仍然是原始資料的 source of truth，
 * `asset_intelligence` 仍然是 AI 理解的 sidecar。這裡新增的是三件既有架構表達不了的事：
 *
 * 1. `library_resources` — 「同一份原始資料在 Library 裡只有一份」。
 *    `assets.project_id` 是 NOT NULL（本次刻意不改），所以 bytes 一定掛在某個專案底下；
 *    library resource 記住「哪一列**實體持有** bytes」（carrier），其他專案透過
 *    `library_resource_usages` 引用同一份，不複製檔案、不重跑 AI 分析。
 *
 * 2. `folder_import_sessions` / `folder_import_entries` — 資料夾匯入是一個有狀態的作業，
 *    不是前端的一個 for-loop。它保留完整相對路徑（Source Metadata），並掛上既有的
 *    `intelligence_processing_batches`——**不建立第二套 AI job queue**。
 *
 * 3. `context_bindings` — Project / Scene / Shot 共用一張表（scope_type + scope_id）。
 *    三套幾乎相同的表會長出三套幾乎相同的 service；這裡只有一套。
 *
 * ★ 綁定不放寬權限：任何讀取端都必須先解出「這個人看得到什麼」，再與這些表取交集。
 *   與 project_data_bindings 同一條規則（docs/data-hub-current-state-2026-08.md §18.2）。
 */
import {
  bigint,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  boolean,
} from "drizzle-orm/pg-core";

/**
 * Library 裡的一份原始資料（canonical）。
 *
 * `resource_kind` + `resource_id` 指向**實體持有 bytes / 內容的那一列**（asset / document /
 * knowledge / table）。多個專案要用同一份資料時，加的是 `library_resource_usages`，
 * 不是再複製一份 asset。
 */
export const libraryResources = pgTable("library_resources", {
  id: uuid("id").primaryKey().defaultRandom(),
  groupId: uuid("group_id").notNull(),
  /** asset | document | knowledge | table —— 與 asset_intelligence.resource_kind 同一組值 */
  resourceKind: text("resource_kind").notNull(),
  resourceId: uuid("resource_id").notNull(),
  /** Intelligence sidecar；背景 enrol 尚未跑到時為 null */
  intelligenceId: uuid("intelligence_id"),
  /**
   * bytes 實際掛在哪個專案底下（assets.project_id 為 NOT NULL 的現實）。
   * 這**不是**「只有這個專案能用」——使用權看 library_resource_usages。
   */
  homeProjectId: uuid("home_project_id"),
  displayName: text("display_name").notNull(),
  mime: text("mime"),
  sizeBytes: bigint("size_bytes", { mode: "number" }),
  /** 伺服器確認過的內容雜湊（去重與「沒有變動」判斷的依據） */
  checksum: text("checksum"),
  /** 原始資料夾結構——Source Metadata，與 AI 分類是兩回事 */
  sourceRootName: text("source_root_name"),
  relativePath: text("relative_path"),
  parentPath: text("parent_path"),
  sourceLastModifiedAt: timestamp("source_last_modified_at"),
  /** upload | folder_import | google-drive | notion | ai_generated … */
  originType: text("origin_type").notNull().default("upload"),
  folderImportSessionId: uuid("folder_import_session_id"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  carrierUq: uniqueIndex("library_resources_carrier_uq").on(t.resourceKind, t.resourceId),
  groupChecksumIdx: index("library_resources_group_checksum_idx").on(t.groupId, t.checksum),
  groupPathIdx: index("library_resources_group_path_idx").on(t.groupId, t.relativePath),
  sessionIdx: index("library_resources_session_idx").on(t.folderImportSessionId),
}));

/** 哪些專案在用這份 Library 資料。原始 bytes 不複製，這裡只是引用。 */
export const libraryResourceUsages = pgTable("library_resource_usages", {
  id: uuid("id").primaryKey().defaultRandom(),
  libraryResourceId: uuid("library_resource_id").notNull(),
  projectId: uuid("project_id").notNull(),
  groupId: uuid("group_id").notNull(),
  /** reference（參考素材）| production（製作用）| delivery（交付） */
  usage: text("usage").notNull().default("reference"),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  usageUq: uniqueIndex("library_resource_usages_uq").on(t.libraryResourceId, t.projectId, t.usage),
  projectIdx: index("library_resource_usages_project_idx").on(t.projectId),
}));

/** 一次資料夾匯入作業。上傳與 AI 理解的進度**分開**記，不混成一條假進度。 */
export const folderImportSessions = pgTable("folder_import_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  groupId: uuid("group_id").notNull(),
  /** 匯入落點；null＝只進 Library 尚未指定專案 */
  projectId: uuid("project_id"),
  /** web_directory | desktop_folder */
  sourceType: text("source_type").notNull().default("web_directory"),
  /**
   * 來源根目錄的穩定識別碼（桌面版由原生端配發）。
   * ★ 永遠不是本機絕對路徑——絕對路徑只留在 Tauri native side（§11）。
   */
  sourceRootId: text("source_root_id"),
  displayName: text("display_name").notNull(),
  /** import_once | manual_rescan | watched */
  mode: text("mode").notNull().default("import_once"),
  /** 同一個資料夾的上一次 session（差異比對的基準） */
  previousSessionId: uuid("previous_session_id"),
  /** 既有的 AI 佇列批次——不是第二套 job queue */
  processingBatchId: uuid("processing_batch_id"),
  totalFiles: integer("total_files").notNull().default(0),
  uploadedFiles: integer("uploaded_files").notNull().default(0),
  skippedFiles: integer("skipped_files").notNull().default(0),
  failedFiles: integer("failed_files").notNull().default(0),
  missingFiles: integer("missing_files").notNull().default(0),
  totalBytes: bigint("total_bytes", { mode: "number" }).notNull().default(0),
  status: text("status").notNull().default("scanning"),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
}, (t) => ({
  groupCreatedIdx: index("folder_import_sessions_group_created_idx").on(t.groupId, t.createdAt),
  rootIdx: index("folder_import_sessions_root_idx").on(t.groupId, t.sourceRootId),
}));

/** 匯入清單中的一個檔案。保留完整相對路徑——匯入後不會只剩檔名。 */
export const folderImportEntries = pgTable("folder_import_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id").notNull(),
  relativePath: text("relative_path").notNull(),
  parentPath: text("parent_path").notNull().default(""),
  filename: text("filename").notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull().default(0),
  mime: text("mime"),
  sourceLastModifiedAt: timestamp("source_last_modified_at"),
  checksum: text("checksum"),
  /** UNCHANGED | NEW | MODIFIED | MISSING */
  diffState: text("diff_state").notNull().default("NEW"),
  /** pending | uploading | uploaded | skipped | failed | missing */
  uploadStatus: text("upload_status").notNull().default("pending"),
  attempt: integer("attempt").notNull().default(0),
  resourceKind: text("resource_kind"),
  resourceId: uuid("resource_id"),
  libraryResourceId: uuid("library_resource_id"),
  intelligenceId: uuid("intelligence_id"),
  error: text("error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  pathUq: uniqueIndex("folder_import_entries_path_uq").on(t.sessionId, t.relativePath),
  statusIdx: index("folder_import_entries_status_idx").on(t.sessionId, t.uploadStatus),
  intelligenceIdx: index("folder_import_entries_intelligence_idx").on(t.intelligenceId),
}));

/**
 * Project / Scene / Shot 的 Context Binding（一張表，三種 scope）。
 *
 * ★ `source = AI_SUGGESTED` 的列**不會**自動變成使用者確認——升級只能由明確動作寫入
 *   `confirmed_by_user = true` 與 `source = USER_CONFIRMED`（shared/projectContext.ts）。
 */
export const contextBindings = pgTable("context_bindings", {
  id: uuid("id").primaryKey().defaultRandom(),
  groupId: uuid("group_id").notNull(),
  /** 所屬專案（scene / shot 也一定屬於某個專案——ACL 一律從這裡起算） */
  projectId: uuid("project_id").notNull(),
  /** project | scene | shot */
  scopeType: text("scope_type").notNull(),
  /** projectId / storyScenes.id / scenes.id */
  scopeId: uuid("scope_id").notNull(),
  resourceKind: text("resource_kind").notNull(),
  resourceId: uuid("resource_id").notNull(),
  intelligenceId: uuid("intelligence_id"),
  libraryResourceId: uuid("library_resource_id"),
  role: text("role").notNull(),
  priority: text("priority").notNull().default("SECONDARY"),
  source: text("source").notNull().default("USER_CONFIRMED"),
  confidence: real("confidence"),
  confirmedByUser: boolean("confirmed_by_user").notNull().default(false),
  note: text("note"),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  bindingUq: uniqueIndex("context_bindings_uq")
    .on(t.scopeType, t.scopeId, t.resourceKind, t.resourceId, t.role),
  scopeIdx: index("context_bindings_scope_idx").on(t.scopeType, t.scopeId),
  projectRoleIdx: index("context_bindings_project_role_idx").on(t.projectId, t.role),
  resourceIdx: index("context_bindings_resource_idx").on(t.resourceKind, t.resourceId),
}));

/**
 * 每次 AI 使用 context 的追蹤紀錄（§30）。
 * 「這張圖為什麼長這樣？」要答得出來，就必須留下當下真的送進去的是哪幾份。
 */
export const contextResolutionRuns = pgTable("context_resolution_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  groupId: uuid("group_id").notNull(),
  projectId: uuid("project_id").notNull(),
  sceneId: uuid("scene_id"),
  shotId: uuid("shot_id"),
  userId: uuid("user_id").notNull(),
  intent: text("intent").notNull(),
  /** 對應的既有 intelligence retrieval run（有往第四層擴才有值） */
  retrievalRunId: uuid("retrieval_run_id"),
  bindingCount: integer("binding_count").notNull().default(0),
  retrievedCount: integer("retrieved_count").notNull().default(0),
  truncated: boolean("truncated").notNull().default(false),
  budgetChars: integer("budget_chars").notNull().default(0),
  includedChars: integer("included_chars").notNull().default(0),
  trace: jsonb("trace").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  projectCreatedIdx: index("context_resolution_runs_project_created_idx").on(t.projectId, t.createdAt),
}));
