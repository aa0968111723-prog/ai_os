/**
 * Auth & organization schema
 * 組織模型：開發者 → 團隊(team_admin) → 組別(leader/member)；角色是關係不是屬性。
 */
import { pgTable, uuid, text, integer, boolean, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";

/* ── 認證與組織 ────────────────────────────────── */

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  isSuperAdmin: boolean("is_super_admin").notNull().default(false),
  status: text("status", { enum: ["active", "disabled"] }).notNull().default("active"),
  /** 管理員重設密碼後為 true：首次登入強制改密碼（changePassword 成功即清除） */
  mustChangePassword: boolean("must_change_password").notNull().default(false),
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
  /** 組總點數預算（累計上限，非每週重置） */
  budgetPoints: integer("budget_points"),
  /** 成本審核門檻 */
  approvalThresholdPoints: integer("approval_threshold_points"),
  optionsSeeded: boolean("options_seeded").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const teamMembers = pgTable("team_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  teamId: uuid("team_id").notNull(),
  userId: uuid("user_id").notNull(),
  role: text("role", { enum: ["admin", "member"] }).notNull().default("member"),
}, (t) => ({
  teamUserUq: uniqueIndex("team_members_team_user_uq").on(t.teamId, t.userId),
}));

export const groupMembers = pgTable("group_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  groupId: uuid("group_id").notNull(),
  userId: uuid("user_id").notNull(),
  role: text("role", { enum: ["leader", "member"] }).notNull().default("member"),
  weeklyPointsOverride: integer("weekly_points_override"),
  budgetPoints: integer("budget_points"),
  canDispatchAgent: boolean("can_dispatch_agent"),
}, (t) => ({
  groupUserUq: uniqueIndex("group_members_group_user_uq").on(t.groupId, t.userId),
}));

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  totalBudgetPoints: integer("total_budget_points"),
  defaultWeeklyPoints: integer("default_weekly_points"),
  defaultDailyPoints: integer("default_daily_points"),
  fileQuotaGb: integer("file_quota_gb"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const invites = pgTable("invites", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  teamId: uuid("team_id").notNull(),
  teamRole: text("team_role", { enum: ["admin", "member"] }).notNull().default("member"),
  groupId: uuid("group_id"),
  groupRole: text("group_role", { enum: ["leader", "member"] }).notNull().default("member"),
  token: text("token").notNull().unique(),
  invitedBy: uuid("invited_by").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  acceptedAt: timestamp("accepted_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tokenHash: text("token_hash").notNull().unique(),
  userId: uuid("user_id").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  lastSeenAt: timestamp("last_seen_at"),
  userAgent: text("user_agent"),
  ipHash: text("ip_hash"),
});

export const rateLimitBuckets = pgTable("rate_limit_buckets", {
  keyHash: text("key_hash").primaryKey(),
  scope: text("scope").notNull(),
  state: jsonb("state").$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  updatedIdx: index("rate_limit_buckets_updated_idx").on(t.updatedAt),
}));

export const idempotencyRecords = pgTable("idempotency_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  actorId: uuid("actor_id").notNull(),
  scope: text("scope").notNull(),
  keyHash: text("key_hash").notNull(),
  requestHash: text("request_hash").notNull(),
  response: jsonb("response").$type<Record<string, unknown>>().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  actorScopeKeyUq: uniqueIndex("idempotency_records_actor_scope_key_uq")
    .on(t.actorId, t.scope, t.keyHash),
  expiresIdx: index("idempotency_records_expires_idx").on(t.expiresAt),
}));

export const mcpTokens = pgTable("mcp_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  label: text("label").notNull(),
  readOnly: boolean("read_only").notNull().default(false),
  expiresAt: timestamp("expires_at"),
  lastUsedAt: timestamp("last_used_at"),
  revokedAt: timestamp("revoked_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  userIdx: index("mcp_tokens_user_idx").on(t.userId),
}));

export const uploadGrants = pgTable("upload_grants", {
  id: uuid("id").primaryKey().defaultRandom(),
  tokenHash: text("token_hash").notNull().unique(),
  userId: uuid("user_id").notNull(),
  projectId: uuid("project_id").notNull(),
  groupId: uuid("group_id").notNull(),
  sourceAssetId: uuid("source_asset_id"),
  handoffId: text("handoff_id"),
  maxBytes: integer("max_bytes").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  revokedAt: timestamp("revoked_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  userIdx: index("upload_grants_user_idx").on(t.userId),
  expiresIdx: index("upload_grants_expires_idx").on(t.expiresAt),
}));

/** 敏感操作信箱 step-up（方案 B）：一般登入不需；改密碼等需 6 碼 */
export const emailStepUpChallenges = pgTable("email_step_up_challenges", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  purpose: text("purpose", { enum: ["change_password", "invite_member"] }).notNull(),
  codeHash: text("code_hash").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  consumedAt: timestamp("consumed_at"),
  attemptCount: integer("attempt_count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  userIdx: index("email_step_up_challenges_user_idx").on(t.userId),
  expiresIdx: index("email_step_up_challenges_expires_idx").on(t.expiresAt),
}));
