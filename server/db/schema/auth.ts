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
  /** 組總點數預算（累計上限，非每週重置）：開發者/團隊管理員「分配給這個組」的點數池；
   *  組累計淨消耗達此值即擋下，開發者到組到組員形成分配樹。null/0＝不限（只受全域/上層限制）。
   *  組長/管理員可看、只有團隊管理員以上能調（點數是由上往下分配的）。nullable，適合向前相容 migration */
  budgetPoints: integer("budget_points"),
  /** 成本審核門檻（需求 2.1）：組員單筆生成估點 ≥ 此值需組長核准才送出；null/0＝不啟用。組長/管理員可調 */
  approvalThresholdPoints: integer("approval_threshold_points"),
  /** 選項預設是否已 seed 過一次（R23）：seed 一次後即使組長把某類選項清空也不再復活，
   *  否則「刪光某類型」下次讀取會被誤判未 seed 而整組還原 */
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
  /** 個人週額度覆寫（null＝跟組；0＝不限）——組長可對個別成員調 */
  weeklyPointsOverride: integer("weekly_points_override"),
  /** 個人總點數預算（累計上限，非每週重置）：組長從「組預算」再分配給這位組員的點數；
   *  該組員在本組的累計淨消耗達此值即擋下。null/0＝不限（只受組/全域上限）。組長可調。nullable，適合向前相容 migration */
  budgetPoints: integer("budget_points"),
  /** 團隊代理派工授權（需求 12 v2）：組彙總 AI 能「提議在某專案發起代理計畫」，實際執行交回
   *  planAgentCore（沿用該專案的 ACL/扣點/併發守門）。派工預設只開放組長以上；組長/管理員可對
   *  個別組員把此欄設 true 授權其派工。組長以上永遠可派、不受此欄影響。null＝未授權（nullable migration） */
  canDispatchAgent: boolean("can_dispatch_agent"),
}, (t) => ({
  groupUserUq: uniqueIndex("group_members_group_user_uq").on(t.groupId, t.userId),
}));

/** 全域點數設定（單列 key='global'）——不寫死在程式，管理員隨時可調 */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  /** 總預算點數（null/0＝不限） */
  totalBudgetPoints: integer("total_budget_points"),
  /** 預設每人每週上限（null/0＝不限） */
  defaultWeeklyPoints: integer("default_weekly_points"),
  /** 每人每日上限（null/0＝不限）——簡報「每人每日上限，不會有人不小心把預算爆掉」 */
  defaultDailyPoints: integer("default_daily_points"),
  /** 資料庫文件每人儲存配額 GB（null＝預設 5；0＝不限）。nullable 新欄可向前相容 */
  fileQuotaGb: integer("file_quota_gb"),
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

/**
 * 跨 replica 的安全／成本限流狀態。
 *
 * keyHash 是 `scope + subject` 經 HMAC-SHA-256（production 強制 RATE_LIMIT_SECRET）後的不可逆鍵；
 * email、IP、user id 等原始識別值一律不落 DB。state 只保存短期時間戳／封鎖期限，
 * 所有讀改寫都由 services/rateLimit.ts 在 PostgreSQL transaction + advisory xact lock 內完成。
 */
export const rateLimitBuckets = pgTable("rate_limit_buckets", {
  keyHash: text("key_hash").primaryKey(),
  /** 非敏感用途名稱，例如 auth:email / mcp:ip / assistant:project */
  scope: text("scope").notNull(),
  /** { hits: number[], blockedUntil?: number } */
  state: jsonb("state").$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  updatedIdx: index("rate_limit_buckets_updated_idx").on(t.updatedAt),
}));

/**
 * Crash-safe idempotency results for externally retried writes.
 * The raw Idempotency-Key is never stored; services persist only a SHA-256
 * digest bound to actor + operation scope. The result row is committed in the
 * same transaction as the protected write.
 */
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

/**
 * MCP 個人連線金鑰（per-user，取代「單一共用 MCP_API_KEY＝人人開發者」）：
 * 每位夥伴自助建立自己的金鑰，外部 AI 客戶端（Claude 等）帶此金鑰連進來時，
 * MCP 一律以「該金鑰的擁有者」身分＋其真實權限執行——組隔離、專案 ACL、點數額度、
 * 成本核准門檻全部沿用網頁端同一套守衛（見 services/mcp.ts）。
 * 與 sessions/invites 同級保護：DB 只存 SHA-256，原文只在建立當下回一次；撤銷＝軟刪保留審計歸屬。
 * 新表由正式 migration 建立。
 */
export const mcpTokens = pgTable("mcp_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  /** SHA-256（非原文）：DB 外洩不可直接兌換金鑰 */
  tokenHash: text("token_hash").notNull().unique(),
  /** 給人看的用途標籤（如「Claude 桌面版」「小美的筆電」），供列表辨識與撤銷 */
  label: text("label").notNull(),
  /** 最小權限：唯讀金鑰只准呼叫讀取類工具（列專案/讀脈絡/找模型/查生成/查資料庫），
   *  一律擋寫入類（送生成、貼留言、寫資料列）——把金鑰交給外部自動化時可只給讀。
   *  預設 false（可讀可寫，行為同舊金鑰）。default 讓 migration 可確定回填既有列。 */
  readOnly: boolean("read_only").notNull().default(false),
  /** 到期時刻（null＝永不過期）：過期即驗證失敗（比照撤銷）。交出去的金鑰可設短效期自動失效。nullable 可向前相容 */
  expiresAt: timestamp("expires_at"),
  /** 最近成功呼叫時刻（fire-and-forget 更新）：供使用者判斷哪把在用、哪把可撤 */
  lastUsedAt: timestamp("last_used_at"),
  /** 撤銷時刻（非 null＝已撤銷，驗證即拒）——不硬刪，保留既有審計列的操作者歸屬 */
  revokedAt: timestamp("revoked_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  userIdx: index("mcp_tokens_user_idx").on(t.userId),
}));
