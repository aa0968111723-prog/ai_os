/**
 * AI Director OS — 資料庫 schema（單一真相來源）
 * Railway Postgres · Drizzle（pg 方言）
 * 組織模型：超管 → 團隊(team_admin) → 組別(leader/member)；角色是關係不是屬性。
 */
import { pgTable, uuid, text, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";

/* ── 認證與組織 ────────────────────────────────── */

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  isSuperAdmin: boolean("is_super_admin").notNull().default(false),
  status: text("status", { enum: ["active", "disabled"] }).notNull().default("active"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const teams = pgTable("teams", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const groups = pgTable("groups", {
  id: uuid("id").primaryKey().defaultRandom(),
  teamId: uuid("team_id").notNull(),
  name: text("name").notNull(),
  /** 每人每週點數上限（null＝用全域預設；0＝不限）——組長/管理員可調 */
  weeklyPointsPerUser: integer("weekly_points_per_user"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const teamMembers = pgTable("team_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  teamId: uuid("team_id").notNull(),
  userId: uuid("user_id").notNull(),
  role: text("role", { enum: ["admin", "member"] }).notNull().default("member"),
});

export const groupMembers = pgTable("group_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  groupId: uuid("group_id").notNull(),
  userId: uuid("user_id").notNull(),
  role: text("role", { enum: ["leader", "member"] }).notNull().default("member"),
  /** 個人週額度覆寫（null＝跟組；0＝不限）——組長可對個別成員調 */
  weeklyPointsOverride: integer("weekly_points_override"),
});

/** 全域點數設定（單列 key='global'）——不寫死在程式，管理員隨時可調 */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  /** 總預算點數（null/0＝不限） */
  totalBudgetPoints: integer("total_budget_points"),
  /** 預設每人每週上限（null/0＝不限） */
  defaultWeeklyPoints: integer("default_weekly_points"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/** 邀請制（無公開註冊）：連結用 LINE 傳即可，72 小時過期、一次性 */
export const invites = pgTable("invites", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  teamId: uuid("team_id").notNull(),
  teamRole: text("team_role", { enum: ["admin", "member"] }).notNull().default("member"),
  groupId: uuid("group_id"),
  groupRole: text("group_role", { enum: ["leader", "member"] }).notNull().default("member"),
  /** 存 SHA-256 雜湊（非原文）：與 sessions.tokenHash 同級保護，DB 外洩不可直接兌換邀請 */
  token: text("token").notNull().unique(),
  invitedBy: uuid("invited_by").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  acceptedAt: timestamp("accepted_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/** Session：DB 存 SHA-256 雜湊、cookie 放原始 token（httpOnly）、30 天 */
export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tokenHash: text("token_hash").notNull().unique(),
  userId: uuid("user_id").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/* ── 業務內容（全部掛 group_id 隔離） ─────────────── */

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  groupId: uuid("group_id").notNull(),
  ownerId: uuid("owner_id").notNull(),
  title: text("title").notNull(),
  kind: text("kind").notNull(),
  platform: text("platform").notNull(),
  format: text("format").notNull(),
  worldview: jsonb("worldview").notNull().default({}),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const generations = pgTable("generations", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull(),
  groupId: uuid("group_id").notNull(),
  userId: uuid("user_id").notNull(),
  modelId: text("model_id").notNull(),
  kind: text("kind").notNull(),
  prompt: text("prompt").notNull(),
  params: jsonb("params").notNull().default({}),
  status: text("status", { enum: ["queued", "running", "done", "failed"] }).notNull().default("queued"),
  pointsEst: integer("points_est").notNull().default(0),
  pointsActual: integer("points_actual"),
  pointsRefunded: integer("points_refunded").notNull().default(0),
  requestId: text("request_id"),
  resultUrl: text("result_url"),
  /** 文字型輸出(LLM/圖轉文/語音轉文字/訓練結果資訊)直接存這裡 */
  resultText: text("result_text"),
  /** 來源輸入(圖生圖底圖、待轉錄音訊等) */
  sourceUrl: text("source_url"),
  error: text("error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/** 點數帳本 — 花費紀錄（先扣預估、失敗退回） */
export const costLedger = pgTable("cost_ledger", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  groupId: uuid("group_id").notNull(),
  delta: integer("delta").notNull(),
  reason: text("reason").notNull(),
  generationId: uuid("generation_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const assets = pgTable("assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull(),
  groupId: uuid("group_id").notNull(),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  url: text("url").notNull(),
  tags: jsonb("tags").notNull().default([]),
  isAiGenerated: boolean("is_ai_generated").notNull().default(false),
  meta: jsonb("meta").notNull().default({}),
  /** 本地儲存相對路徑（Volume /data/assets 下；null＝僅外部網址） */
  storagePath: text("storage_path"),
  mime: text("mime"),
  sizeBytes: integer("size_bytes"),
  /** 手動上傳者（AI 生成的為 null） */
  uploadedBy: uuid("uploaded_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const scenes = pgTable("scenes", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull(),
  orderIndex: integer("order_index").notNull().default(0),
  title: text("title").notNull(),
  durationSec: integer("duration_sec").notNull().default(5),
  status: text("status").notNull().default("todo"),
  assetId: uuid("asset_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const approvals = pgTable("approvals", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull(),
  sceneId: uuid("scene_id"),
  version: integer("version").notNull().default(1),
  status: text("status", { enum: ["pending", "needs_work", "approved"] }).notNull().default("pending"),
  submittedBy: uuid("submitted_by").notNull(),
  decidedBy: uuid("decided_by"),
  reason: text("reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  decidedAt: timestamp("decided_at"),
});

/** 測試回饋（評估七項＋文字） */
export const feedback = pgTable("feedback", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  groupId: uuid("group_id"),
  scores: jsonb("scores").notNull().default({}),
  best: text("best"),
  worst: text("worst"),
  note: text("note"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

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

export const messages = pgTable("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  groupId: uuid("group_id").notNull(),
  projectId: uuid("project_id"),
  userId: uuid("user_id").notNull(),
  kind: text("kind").notNull().default("text"),
  body: text("body").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
