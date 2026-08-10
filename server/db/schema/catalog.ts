/**
 * Catalog & feedback schema（模型目錄、問卷回饋、元件回報、審計）
 */
import { pgTable, uuid, text, integer, boolean, timestamp, jsonb, index, uniqueIndex, doublePrecision } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/** 模型目錄(啟動時從 shared/models.ts 同步;代理/報表可直接 SQL 查「哪個模型適合」) */
export const modelCatalog = pgTable("model_catalog", {
  id: text("id").primaryKey(),
  endpoint: text("endpoint").notNull(),
  category: text("category").notNull(),
  tier: text("tier").notNull(),
  kind: text("kind").notNull(),
  needs: text("needs"),
  points: integer("points").notNull(),
  strengths: text("strengths").notNull(),
  bestFor: text("best_for").notNull(),
  cost: text("cost").notNull(),
  verified: boolean("verified").notNull().default(false),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const modelLiveCatalog = pgTable("model_live_catalog", {
  id: text("id").primaryKey(),
  endpoint: text("endpoint").notNull(),
  label: text("label").notNull(),
  category: text("category").notNull(),
  tier: text("tier").notNull(),
  kind: text("kind").notNull(),
  needs: text("needs"),
  source: text("source", { enum: ["static", "fal_discovered"] }).notNull().default("static"),
  points: integer("points").notNull(),
  pointsStatic: integer("points_static"),
  cost: text("cost").notNull(),
  costUsd: doublePrecision("cost_usd"),
  costUnit: text("cost_unit"),
  estTwd: integer("est_twd").notNull().default(0),
  strengths: text("strengths").notNull().default(""),
  bestFor: text("best_for").notNull().default(""),
  verified: boolean("verified").notNull().default(false),
  recommended: boolean("recommended").notNull().default(false),
  available: boolean("available").notNull().default(true),
  rawPricing: jsonb("raw_pricing"),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (tbl) => ({
  categoryIdx: index("model_live_catalog_category_idx").on(tbl.category, tbl.available),
  sourceIdx: index("model_live_catalog_source_idx").on(tbl.source),
  fetchedIdx: index("model_live_catalog_fetched_idx").on(tbl.fetchedAt),
}));

/** 測試回饋（6 題評分＋優缺點/備註文字） */
export const feedback = pgTable("feedback", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  groupId: uuid("group_id"),
  scores: jsonb("scores").notNull().default({}),
  best: text("best"),
  worst: text("worst"),
  note: text("note"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  /** 重送＝修改（一人一組一份）。舊版靠竄改 createdAt 讓更新浮到最新，會抹掉真正建立時間；
   * 改用獨立 updatedAt：createdAt 保留初次填答時刻，彙整/預填以 updatedAt 排序。 */
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  // PostgreSQL 的 UNIQUE 預設不把 NULL 視為相同，因此以固定 UUID 收斂「無組別」問卷。
  userGroupUq: uniqueIndex("feedback_user_group_uq")
    .on(t.userId, sql`coalesce(${t.groupId}, '00000000-0000-0000-0000-000000000000'::uuid)`),
}));

/**
 * 元件級回饋（R23）：使用者點選頁面元件自動標定 → 分類 + 文字 + 可選截圖。
 * 有別於 feedback 表（定期六題滿意度問卷），這裡是「針對某頁某元件的即時回報」。
 * pages＝可複選頁面；target*＝被點選的元件描述（page-level 回饋時為 null）。
 */
export const feedbackReports = pgTable("feedback_reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  groupId: uuid("group_id"),
  /** bug｜uiux｜feature｜stuck｜other（與 shared/options FEEDBACK_CATEGORIES 一致） */
  category: text("category").notNull(),
  /** 涉及頁面（單一或複選）：頁面代稱陣列，如 ["專案頁","作業台"] */
  pages: jsonb("pages").notNull().default([]),
  /** 被點選元件的可讀標籤（如「生成按鈕」）；不指定元件的頁面級回饋為 null */
  targetLabel: text("target_label"),
  /** 元件定位路徑（data-fb 或 DOM 路徑），供工程回溯 */
  targetSelector: text("target_selector"),
  /** 點選當下的位置與視窗尺寸 {x,y,w,h,vw,vh}，供還原標記 */
  targetRect: jsonb("target_rect"),
  note: text("note").notNull(),
  /** 截圖（含標記框）落地 Volume 的相對路徑；擷取失敗或未附時為 null */
  screenshotPath: text("screenshot_path"),
  status: text("status", { enum: ["open", "reviewing", "done"] }).notNull().default("open"),
  /* ── 回饋代理（每 3 天巡一次）自動分診欄位 ──
   * 背景代理讀未處理回饋 → LLM 分診（嚴重度／一句摘要／建議修復／給使用者的回覆）→
   * 回填以下欄位並寄信通知回報者。全部可為 null（既有列與尚未巡到的回饋維持 null，屬向前相容新增欄位）。 */
  agentReviewedAt: timestamp("agent_reviewed_at"),
  /** LLM 判定的嚴重度：low｜medium｜high（分診排序用；解析不出時 null） */
  agentSeverity: text("agent_severity", { enum: ["low", "medium", "high"] }),
  /** 一句話分診摘要（給審閱者快速掃過） */
  agentSummary: text("agent_summary"),
  /** 建議的修復方向／排程（工程可直接採用；「排程修復」的產出） */
  agentFix: text("agent_fix"),
  /** 寄給回報者的回覆內文（先落地再寄，寄信失敗也留存草稿供人工補寄） */
  agentReply: text("agent_reply"),
  /** 回覆信寄送狀態：sent＝已寄出、skipped＝信箱機制未設定（僅落地）、failed＝寄送失敗 */
  emailStatus: text("email_status", { enum: ["sent", "skipped", "failed"] }),
  /** 回覆信實際寄出時刻（skipped/failed 為 null） */
  emailedAt: timestamp("emailed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  userCreatedIdx: index("feedback_reports_user_created_idx").on(t.userId, t.createdAt),
  groupStatusCreatedIdx: index("feedback_reports_group_status_created_idx").on(t.groupId, t.status, t.createdAt),
  statusAgentCreatedIdx: index("feedback_reports_status_agent_created_idx").on(t.status, t.agentReviewedAt, t.createdAt),
}));

/**
 * 回饋代理巡檢紀錄（每 3 天一次；亦可開發者手動觸發）：每次巡檢寫一列，
 * 記這輪看了幾筆、寄出幾封信、成功與否——管理頁「回饋代理」卡以最新一列顯示狀態。
 * 只插入不更新完局後不再改（running→done/failed 於同列 update），新表由正式 migration 建立。
 */
export const feedbackAgentRuns = pgTable("feedback_agent_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** manual＝開發者在管理頁按「立即巡檢」；scheduled＝每 3 天排程自動觸發 */
  trigger: text("trigger", { enum: ["scheduled", "manual"] }).notNull().default("scheduled"),
  status: text("status", { enum: ["running", "done", "failed"] }).notNull().default("running"),
  /** 這輪分診的回饋筆數 */
  reviewedCount: integer("reviewed_count").notNull().default(0),
  /** 這輪成功寄出的回覆信封數 */
  emailedCount: integer("emailed_count").notNull().default(0),
  /** 收尾備註（如「無待處理回饋」）或失敗訊息 */
  note: text("note"),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  finishedAt: timestamp("finished_at"),
}, (t) => ({
  startedIdx: index("feedback_agent_runs_started_idx").on(t.startedAt),
}));

/**
 * 審計日誌（需求 2.2「紀錄每一個行動的每一個細節操作」）：
 * 所有登入後 mutation 由 tRPC 中介層集中寫入（見 services/audit.ts）——
 * 誰、何時、做了什麼（procedure 路徑）、對哪個組/專案、輸入摘要（已脫敏）、成功與否。
 * 新表由正式 migration 建立；只插入不更新，量大時靠索引查詢。
 */
export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  actorId: uuid("actor_id").notNull(),
  /** tRPC procedure 完整路徑，如 "generation.submit"、"scenes.update" */
  action: text("action").notNull(),
  /** 盡力從輸入解析的歸屬（供組層級過濾）；解析不到為 null */
  groupId: uuid("group_id"),
  projectId: uuid("project_id"),
  /** 輸入摘要：密碼/token 類鍵剔除、長字串截斷、深度與鍵數上限（見 sanitizeAuditInput） */
  input: jsonb("input").notNull().default({}),
  ok: boolean("ok").notNull().default(true),
  /** 失敗時的錯誤訊息（截斷） */
  error: text("error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  createdIdx: index("audit_log_created_idx").on(t.createdAt),
  actorIdx: index("audit_log_actor_idx").on(t.actorId),
  groupIdx: index("audit_log_group_idx").on(t.groupId),
}));
