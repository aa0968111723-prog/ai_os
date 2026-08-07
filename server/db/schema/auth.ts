/**
 * Auth & organization schema
 * 組織模型：開發者 → 團隊(team_admin) → 組別(leader/member)；角色是關係不是屬性。
 */
import { pgTable, uuid, text, integer, boolean, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import type { DeviceDetails } from "../../../shared/deviceDetails";

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
  /** 介面密度偏好（0015）。「引導／精簡」兩種模式已於全站統一後撤除，欄位不再讀寫。
   *  留著是因為 DROP COLUMN 得再發一次破壞性 migration，而多一個永遠是 null 的
   *  文字欄位不影響任何查詢；schema 保留宣告則讓 drift 檢查對得上實際資料庫。 */
  uiDensity: text("ui_density", { enum: ["guide", "concise"] }),
  /** 個人頭像相對路徑（如 avatars/{userId}.jpg）；null＝尚未設定。0033_user_avatar */
  avatarUrl: text("avatar_url"),
  /**
   * 裝置驗證豁免期限（管理員預先授信）：此時刻前，這個帳號在陌生裝置登入免信箱驗證碼。
   * 用途是救援「同事人在國外／信箱壞掉收不到驗證碼」——否則 enforce 模式下會把人鎖在門外。
   * 管理員按一次給 30 分鐘、用掉即清除，並寫審計。null＝無豁免（正常狀態）。
   */
  deviceGraceUntil: timestamp("device_grace_until"),
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
  /**
   * 組代理指揮權等級（none/dispatch/supervise/command）——取代單一布林的分級授權。
   *
   * 為什麼不繼續用 canDispatchAgent：那個布林只回答「能不能生出一份待核計畫」，
   * 但「能不能替別人核准並開始花點」「能不能讓組代理在無人盯著時自己補救」是完全不同量級的
   * 授權，折在同一個布林裡等於把最貴的權限偷偷送出去。
   * null＝沒設過，退回讀舊布林（見 shared/groupAgent 的 resolveCommandLevel），既有授權不會
   * 在 migration 當下無聲失效。組長以上不看此欄（恆為 command）。
   */
  agentCommandLevel: text("agent_command_level", { enum: ["none", "dispatch", "supervise", "command"] }),
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
  /** 最近活躍（sliding touch / resolve 節流更新）；nullable 向前相容 */
  lastSeenAt: timestamp("last_seen_at"),
  /** User-Agent 截斷 240；列表 UI 顯示裝置提示，不存完整指紋 */
  userAgent: text("user_agent"),
  /** sha256(ip + pepper)；永不存 raw IP */
  ipHash: text("ip_hash"),
  /**
   * 簽發這筆 session 的已信任裝置（user_devices.id）。nullable：
   * 上線前既有 session／裝置信任關閉（DEVICE_TRUST_MODE=off）時為 null，不會把既有登入者踢出去。
   * 有值時「移除裝置」＝連帶刪除該裝置所有 session（見 services/deviceTrust.revokeDevice）。
   */
  deviceId: uuid("device_id"),
}, (t) => ({
  // revokeDevice 會 DELETE ... WHERE device_id = ?，沒索引就是整表掃描
  deviceIdx: index("sessions_device_idx").on(t.deviceId),
}));

/**
 * 線上狀態（私訊「誰在線上」）：每位使用者一列的「最後活躍時刻」，由 tRPC 中介層在
 * 登入後的 API 呼叫上節流寫入（見 services/presence）。
 *
 * 為什麼不掛在 users 上：users 是全站最熱的讀取表，心跳每分鐘都在 UPDATE 會讓每一列
 * 不斷產生新版本（表膨脹＋每次讀都要走更多 dead tuple），而這份資料短命到隨時可以整張丟掉。
 * 為什麼不放記憶體：多 replica 部署時各自只看得到自己那份連線，同一個人在 A 機器活躍、
 * B 機器上的夥伴就看不到——線上狀態必須是共享狀態。
 */
export const userPresence = pgTable("user_presence", {
  /** 一人一列（PK 即 upsert 的衝突鍵）；沒有列＝從未活躍過＝離線 */
  userId: uuid("user_id").primaryKey(),
  /** 最後一次有動作的時刻；三態判定（上線中／剛離開／離線）見 shared/presence.ts */
  lastActiveAt: timestamp("last_active_at", { withTimezone: true }).defaultNow().notNull(),
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

/**
 * AUTH-03 上傳授權（單次、可撤銷、可 audit）：桌面 handoff／長時間上傳可與 session cookie 解耦。
 * DB 只存 SHA-256（前綴 aidup_）；原文只在 createUploadGrant 回一次。成功寫入 asset 後 used_at 標記。
 */
export const uploadGrants = pgTable("upload_grants", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** SHA-256（非原文）；.unique() → CONSTRAINT upload_grants_token_hash_unique（對齊 0013） */
  tokenHash: text("token_hash").notNull().unique(),
  userId: uuid("user_id").notNull(),
  projectId: uuid("project_id").notNull(),
  groupId: uuid("group_id").notNull(),
  /** 可選：來源素材（lineage；上傳時可寫入 assets.meta.sourceAssetId） */
  sourceAssetId: uuid("source_asset_id"),
  /** 可選：桌面 handoff 識別（非 UUID 也可；上限由 service 截斷） */
  handoffId: text("handoff_id"),
  /** 此 grant 允許的最大位元組（通常＝全域上傳上限） */
  maxBytes: integer("max_bytes").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  /** 成功入庫後標記；失敗不寫，允許重試 */
  usedAt: timestamp("used_at"),
  revokedAt: timestamp("revoked_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  userIdx: index("upload_grants_user_idx").on(t.userId),
  expiresIdx: index("upload_grants_expires_idx").on(t.expiresAt),
}));


/**
 * 方案 B 敏感操作信箱 step-up 挑戰（#218）：request → 信箱 6 碼 → 敏感 API 帶 challengeId+code。
 * 只存驗證碼的 SHA-256（非原文）；欄位對齊 drizzle/0014_email_step_up.sql。
 */
export const emailStepUpChallenges = pgTable("email_step_up_challenges", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  /** change_password／invite_member（語意由 services/emailStepUp 的 STEP_UP_PURPOSES 定義） */
  purpose: text("purpose").notNull(),
  /** SHA-256（非原文）——驗證碼外洩不可還原 */
  codeHash: text("code_hash").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  /** 用掉即標記；同一挑戰不可重放 */
  consumedAt: timestamp("consumed_at"),
  attemptCount: integer("attempt_count").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  userIdx: index("email_step_up_challenges_user_idx").on(t.userId),
  expiresIdx: index("email_step_up_challenges_expires_idx").on(t.expiresAt),
}));

/**
 * 已信任的「人＋裝置」配對（裝置綁定登入）。
 *
 * 設計要點見 docs/device-trust-design.md：
 * - 網頁讀不到硬體序號（IMEI／主機板序號／MAC 是瀏覽器安全模型的硬限制），
 *   故「這台裝置」＝伺服器發出的長效隨機憑證（cookie aidos_device），DB 只存 SHA-256。
 * - fingerprintHash 只作異常訊號與裝置命名，**不作主識別**：瀏覽器版本／螢幕會漂移，
 *   拿它當封鎖條件會製造大量假警報，反而訓練使用者無腦輸驗證碼。
 * - 是 (user, device) 配對不是單純裝置：同一台辦公室電腦上 A 驗過不代表 B 免驗。
 * - 信任「永久直到手動移除」（Bruce 2026-07-31 決定），故無 expiresAt 欄位；
 *   撤銷走 revokedAt（軟刪，保留審計歸屬），且連帶刪除該裝置的所有 session。
 */
export const userDevices = pgTable("user_devices", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  /**
   * SHA-256（非原文）：比照 sessions.tokenHash，DB 外洩不可直接冒用裝置。
   * 唯一性以具名 uniqueIndex 宣告（見下方 index 設定）而非欄位 .unique()：
   * 後者會讓 drizzle 期待一個名為 *_token_hash_unique 的 CONSTRAINT，
   * 而 CONSTRAINT 不支援 IF NOT EXISTS，migration 就無法保持冪等。
   */
  tokenHash: text("token_hash").notNull(),
  /** 給人看的裝置名稱，如「iPhone · Safari」「Windows · Chrome」 */
  label: text("label").notNull(),
  /** 穩定被動特徵的雜湊（OS/瀏覽器家族、機型、架構、螢幕、時區；刻意不含任何版本號） */
  fingerprintHash: text("fingerprint_hash").notNull(),
  /**
   * 裝置細節（廠牌／機型／OS 版本／CPU／記憶體／顯示卡），給人在「我的裝置」清單辨認用。
   * ★與 fingerprintHash 分開：這裡的值會隨系統與驅動更新漂移，
   *   若拿去比對會每個月要求全公司重驗一次。細節給人看、指紋給機器比。
   * ★刻意與 fingerprintHash 分開：這裡的值會隨系統與驅動更新漂移，
   *   若拿去比對會每個月要求全公司重驗一次。細節給人看、指紋給機器比。
   * 每次以該裝置成功登入時更新（系統升級後清單顯示的是最新狀態）。
   * nullable：裝置信任啟用前建立的列、或前端沒送特徵時為 null。
   */
  details: jsonb("details").$type<DeviceDetails>(),
  /** 最近一次以此裝置成功登入 */
  lastSeenAt: timestamp("last_seen_at"),
  /** sha256(ip + pepper)：沿用 sessions 同一套，永不存 raw IP */
  lastSeenIpHash: text("last_seen_ip_hash"),
  /** 通過信箱驗證而受信任的時刻 */
  trustedAt: timestamp("trusted_at").defaultNow().notNull(),
  /** 撤銷時刻——非 null 即拒；不硬刪，保留審計歸屬 */
  revokedAt: timestamp("revoked_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  tokenHashUq: uniqueIndex("user_devices_token_hash_uq").on(t.tokenHash),
  userIdx: index("user_devices_user_idx").on(t.userId),
}));

/**
 * 陌生裝置的信箱驗證挑戰。
 *
 * 刻意獨立於 email_step_up_challenges，不去擴充那張表：
 * 1. 語意不同——step-up 是「已登入者要做敏感操作」，這裡是「還沒有 session 的登入關卡」。
 *    兩者的降級策略必須相反：step-up 在信箱未設定時放行是合理的優雅降級，
 *    登入若照做就等於「信箱一壞全世界免驗證進站」。
 * 2. 這張挑戰要綁定發起裝置的指紋，step-up 沒有這個概念。
 * 3. email_step_up_challenges 是已發布的 migration 建立的；在同一批 pending migration 裡
 *    「先 CREATE TABLE 再 ALTER ADD COLUMN」會讓 legacy adoption bridge 的
 *    整表 DDL 比對對不起來（bridge 產生的是含新欄位的完整 CREATE TABLE）。
 */
export const deviceChallenges = pgTable("device_challenges", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  /**
   * 驗證碼的 SHA-256。不用 bcrypt：6 位數只有 100 萬種組合，bcrypt 擋不住有 DB 的離線暴力，
   * 卻讓每次線上驗證多花 100ms。真正的防線是 10 分鐘過期＋最多 5 次嘗試＋限流，
   * 線上猜中機率 5/1,000,000。雜湊的目的只是「DB 外洩者讀不到明碼」，SHA-256 足夠。
   */
  codeHash: text("code_hash").notNull(),
  /** 綁定發起裝置：防「攻擊者在自己機器觸發挑戰、騙受害者唸出信裡的碼、於他處兌換」 */
  fingerprintHash: text("fingerprint_hash").notNull(),
  /** 給人看的裝置描述（「iPhone · Safari」），寫進驗證信與後續 user_devices.label */
  deviceLabel: text("device_label").notNull(),
  /** 裝置細節，兌換成功後原樣寫進 user_devices.details */
  details: jsonb("details").$type<DeviceDetails>(),
  /** 錯誤嘗試次數，達上限即作廢（正確的碼也不再接受，必須重新登入取得新挑戰） */
  attemptCount: integer("attempt_count").notNull().default(0),
  expiresAt: timestamp("expires_at").notNull(),
  /** 用掉即標記；同一挑戰不可重放 */
  consumedAt: timestamp("consumed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  userIdx: index("device_challenges_user_idx").on(t.userId),
  expiresIdx: index("device_challenges_expires_idx").on(t.expiresAt),
}));
