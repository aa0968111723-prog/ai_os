/**
 * AI Director OS — 資料庫 schema（單一真相來源）
 * PostgreSQL · Drizzle（pg 方言）
 * 組織模型：開發者 → 團隊(team_admin) → 組別(leader/member)；角色是關係不是屬性。
 */
import { pgTable, uuid, text, integer, bigint, boolean, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { CompletePlanSummary } from "../../shared/plan";

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
  /** awaiting_approval/rejected（需求 2.1 成本審核）：達組門檻的組員生成先待核，核准才扣點送 fal；
   *  enum 只是 TS 層註記（DB 欄位為 text），不需要 DB 型別 migration */
  status: text("status", { enum: ["queued", "running", "done", "failed", "awaiting_approval", "rejected"] }).notNull().default("queued"),
  pointsEst: integer("points_est").notNull().default(0),
  pointsActual: integer("points_actual"),
  pointsRefunded: integer("points_refunded").notNull().default(0),
  requestId: text("request_id"),
  /** 綁定的分鏡格（可為 null）：草稿分鏡「就地生成」時填入，完成後把成品回填該格 scenes.assetId */
  sceneId: uuid("scene_id"),
  /** 這筆生成要回填分鏡的哪個角色："visual"＝畫面（回填 scenes.assetId）、"narration"＝旁白音檔（回填 scenes.narrationAssetId）；null＝視為 visual */
  sceneRole: text("scene_role", { enum: ["visual", "narration"] }),
  /** 送出時帶入的角色定裝卡 id（null＝沒帶）——重試/「再用此設定」要能還原錨點，注入不再是黑盒 */
  characterIds: jsonb("character_ids").$type<string[]>(),
  /** 送出時帶入的場景設定卡 id（null＝沒帶） */
  scenePresetIds: jsonb("scene_preset_ids").$type<string[]>(),
  /** 來源工作流執行（null＝非工作流產物）：生成紀錄可回看「這筆是哪條工作流跑出來的」 */
  workflowRunId: uuid("workflow_run_id"),
  /** 來源 AI 代理執行（null＝非代理產物） */
  agentRunId: uuid("agent_run_id"),
  resultUrl: text("result_url"),
  /** 文字型輸出(LLM/圖轉文/語音轉文字/訓練結果資訊)直接存這裡 */
  resultText: text("result_text"),
  /** 來源輸入(圖生圖底圖、待轉錄音訊等) */
  sourceUrl: text("source_url"),
  error: text("error"),
  /** 使用者為生成物取的名字（null＝用 prompt 當標題）——生成紀錄好找片（#20） */
  name: text("name"),
  /** 收藏標記：標星的生成物可篩「只看收藏」（#20）。nullable+default false 讓 migration 可確定回填既有列 */
  favorite: boolean("favorite").default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  // listByProject 對每個分鏡各跑兩支 scene_id 相關子查詢；補索引避免生成量成長後全表掃描。
  // 非 unique 純索引，由可審核 migration 建立。
  sceneIdIdx: index("generations_scene_id_idx").on(t.sceneId),
  // 修 R3-SQL-02（與並行 PR #105 相同結論）：熱路徑 listByProject（WHERE project_id ORDER BY created_at
  // DESC LIMIT 30）與 keyset 分頁——每位開著專案的檢視者頻繁輪詢，無此索引＝全表掃＋排序。(project_id,
  // created_at) 讓 Postgres 反向掃即得最新 N 筆；另補依組過濾（跨組統計）索引。
  projectCreatedIdx: index("generations_project_created_idx").on(t.projectId, t.createdAt),
  // 執行器只掃在途工作；partial index 現在納入 schema/migration 單一真相，
  // 不再由應用程式開機時偷偷補 DDL。
  activeIdx: index("generations_active_idx")
    .on(t.updatedAt)
    .where(sql`${t.status} in ('queued','running')`),
  projectActiveIdx: index("generations_project_active_idx")
    .on(t.projectId, t.updatedAt)
    .where(sql`${t.status} in ('queued','running')`),
  groupIdx: index("generations_group_idx").on(t.groupId),
}));

/** 點數帳本 — 花費紀錄（先扣預估、失敗退回） */
export const costLedger = pgTable("cost_ledger", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  groupId: uuid("group_id").notNull(),
  delta: integer("delta").notNull(),
  reason: text("reason").notNull(),
  generationId: uuid("generation_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  // 額度守門的 SUM 聚合都掃這張表（reserveQuota 還在持 advisory lock 的交易內掃），
  // 且 quota.my 徽章每次頁面載入都跑——全非唯一索引（帳本是 append-only，扣點/退點/回收
  // 對同一 generationId 各插一列，唯一索引會 23505 擋死退點）。由正式 migration 套用。
  userGroupIdx: index("cost_ledger_user_group_idx").on(t.userId, t.groupId), // usedByMember + reserveQuota 個人預算；user_id 前綴另供 usedToday/usedThisWeek/週日守門
  groupCreatedIdx: index("cost_ledger_group_created_idx").on(t.groupId, t.createdAt), // usedByGroup/groupUsage（group_id 前綴）＋ consumptionStats 組×日期範圍
  createdIdx: index("cost_ledger_created_idx").on(t.createdAt), // consumptionStats 全站（開發者）日期範圍掃描
  generationIdx: index("cost_ledger_generation_id_idx").on(t.generationId), // 週/日/組聚合對 generations 的 LEFT JOIN 鍵；退點對帳按生成查列
}));

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
  /** 固定素材模式（簡報 slide 19）：師父原音／開示文字／配樂設「鎖定·不可更動」，
   *  交付包會把鎖定素材原封保留在 00_鎖定原素材/，剪輯時圍繞它組裝、不改動 */
  locked: boolean("locked").notNull().default(false),
  /** 軟刪除（回收桶）：非 null＝已丟進回收桶。點數＝真金，刪除不退點、不刪 Volume 檔，可還原。
   *  所有「列出／匯出／注入」查詢都以 isNull(deletedAt) 過濾，還原＝清回 null。 */
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  // 素材庫列表／來源下拉每次以 project_id 撈（生成完成也會即時 invalidate 重打）；補索引避免全表掃。
  projectCreatedIdx: index("assets_project_created_idx").on(t.projectId, t.createdAt),
}));

/**
 * 專案知識庫（願景核心「真的懂我們素材」v1）：
 * 開示稿／見證稿／腳本等文字素材，全文注入 AI 導演的上下文——夥伴不必每次重講背景。
 * 內容存 DB（不是檔案），供 LLM 直接讀；長文於注入時截斷（見 knowledge router）。
 */
export const knowledge = pgTable("knowledge", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull(),
  groupId: uuid("group_id").notNull(),
  /** transcript=師父開示稿・testimony=見證故事・script=腳本・note=其他筆記 */
  kind: text("kind", { enum: ["transcript", "testimony", "script", "note"] }).notNull().default("note"),
  title: text("title").notNull(),
  content: text("content").notNull(),
  /** 若由上傳的文字素材自動建立，記來源 asset（供去重與回溯） */
  sourceAssetId: uuid("source_asset_id"),
  createdBy: uuid("created_by").notNull(),
  /** 軟刪除（回收桶）：非 null＝已丟進回收桶（保留逐字稿／見證，可還原）。
   *  ★ buildKnowledgeContext 必以 isNull(deletedAt) 過濾——已刪的逐字稿絕不可再注入 AI 導演 LLM。 */
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/**
 * 長文版本歷史（#29）：知識庫逐字稿等長文每次更新前存一版快照，可檢視／還原。
 * 目前 kind='knowledge'（refId=knowledge.id）；未來可擴 'worldview'。新表由正式 migration 建立。
 */
export const textVersions = pgTable("text_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull(),
  groupId: uuid("group_id").notNull(),
  kind: text("kind").notNull(),
  refId: uuid("ref_id").notNull(),
  title: text("title"),
  content: text("content").notNull(),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/**
 * 提示詞庫（簡報「打過的咒語自動存起來，下次一鍵再用」）：
 * 成功生成的提示詞自動入庫（同專案去重、記使用次數），供一鍵再生成/插入。
 */
export const prompts = pgTable("prompts", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull(),
  groupId: uuid("group_id").notNull(),
  text: text("text").notNull(),
  /** 最後一次用這則咒語生成時的模型/角色/場景卡（null＝純文字舊列）——「再用」還原完整設定，不只文字 */
  modelId: text("model_id"),
  characterIds: jsonb("character_ids").$type<string[]>(),
  scenePresetIds: jsonb("scene_preset_ids").$type<string[]>(),
  useCount: integer("use_count").notNull().default(1),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/**
 * 角色定裝卡（提案六大核心#3「角色·場景一致性」）：
 * 角色外觀設定一次鎖定，生成時自動注入錨點——跨鏡頭與集數不走樣（安倢=紅傘米白外套…）。
 */
export const characters = pgTable("characters", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull(),
  groupId: uuid("group_id").notNull(),
  name: text("name").notNull(),
  /** 外觀錨點：臉/髮型/服裝/配飾——這段會直接注入生成提示詞 */
  appearance: text("appearance").notNull(),
  /** 個性・語氣・關係・Do/Don't（供 AI 導演與腳本參考；不注入視覺生成，避免被畫出文字） */
  notes: text("notes"),
  /** 定裝參考圖（可選；之後圖生圖可用作底） */
  referenceAssetId: uuid("reference_asset_id"),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/**
 * 場景設定卡（提案六大核心#3「角色·場景一致性」的「場景」面）：
 * 色板・光線建成設定庫，生成勾選時自動注入錨點——同一場景跨鏡光影一致（暖色清晨光…）。
 */
export const scenePresets = pgTable("scene_presets", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull(),
  groupId: uuid("group_id").notNull(),
  name: text("name").notNull(),
  /** 色板：主色調／配色（注入視覺生成） */
  palette: text("palette").notNull(),
  /** 光線：光源方向／氛圍（注入視覺生成） */
  lighting: text("lighting"),
  /** 場景參考圖（可選；上傳或從素材庫綁定，供比對與之後圖生圖用） */
  referenceAssetId: uuid("reference_asset_id"),
  createdBy: uuid("created_by").notNull(),
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
  /** 這一幕的旁白音檔素材（逐鏡配音；null＝尚未生成配音） */
  narrationAssetId: uuid("narration_asset_id"),
  /** 導演 AI 拆分鏡填入：這一幕的建議生成提示詞（草稿分鏡用，一鍵帶入生成台） */
  prompt: text("prompt"),
  /** 這一幕的配音詞／旁白（拆腳本時由 AI 分句；固定素材模式為原音逐句） */
  voiceover: text("voiceover"),
  /** 軟刪除（回收桶）：非 null＝已丟進回收桶（保留使用者手打的 prompt/voiceover，可還原）。
   *  所有分鏡讀取（列表／移動／重排／匯出）都以 isNull(deletedAt) 過濾。 */
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  // 修 R3-SQL-03（與並行 PR #105 相同結論）：listByProject（WHERE project_id ORDER BY order_index）
  // 每 10 秒輪詢，原本無索引→全表掃＋排序。補複合索引。
  projectOrderIdx: index("scenes_project_order_idx").on(t.projectId, t.orderIndex),
}));

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
}, (t) => ({
  // 修 R3-SQL-03：審批一律「依專案（＋狀態）」查，原本無索引→全表掃描。補複合索引。
  projectStatusIdx: index("approvals_project_status_idx").on(t.projectId, t.status),
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
  // 協作強化（留言 2.0）：回覆串／組長釘選／引用專案內作品（分鏡・素材・生成）／@提及
  replyToId: uuid("reply_to_id"),
  pinned: boolean("pinned").notNull().default(false),
  refType: text("ref_type", { enum: ["scene", "asset", "generation", "note", "schedule"] }),
  refId: uuid("ref_id"),
  mentions: jsonb("mentions").$type<string[]>(),
  // 留言第一梯隊：語音留言（kind='voice'，音檔存 ref asset，voiceStatus 轉錄狀態，body 收轉錄稿）
  // 與 @助手回覆（kind='assistant'，body 為 LLM 回答，userId 記觸發者）。
  // running＝已被某個 tick 認領並「已扣點、轉錄中」的原子狀態：崩潰後留在 running（非 pending），
  // 下一輪掃描只撈 pending 故不會重撿重扣（見 services/voiceTranscribe 的 CAS 認領）。純 text 欄、無 DB
  // CHECK 約束，新增列舉值不需遷移。
  voiceStatus: text("voice_status", { enum: ["pending", "running", "done", "failed"] }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  projectIdx: index("messages_project_idx").on(t.projectId, t.createdAt),
  voicePendingIdx: index("messages_voice_pending_idx").on(t.voiceStatus),
}));

/**
 * 站內私訊（通訊錄 1:1 聊天）：獨立於專案留言（messages 掛組/專案、組內可見），
 * 私訊只有收發雙方看得到——查詢一律以「本人是 sender 或 recipient」為界，管理員也不例外。
 * 可私訊對象＝同組夥伴（含團隊管理展開；開發者可與全站互訊），見 services/dmCore.ts。
 * 內容不落審計明文（trpc.ts 對 dm.send 脫敏 body），維持「私」的承諾。新表由正式 migration 建立。
 */
export const dmMessages = pgTable("dm_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  senderId: uuid("sender_id").notNull(),
  recipientId: uuid("recipient_id").notNull(),
  body: text("body").notNull(),
  // 私訊 2.0：kind 區分一般訊息與 AI 代理回覆（'assistant'——@助手 觸發，sender 記提問者、雙方可見）。
  kind: text("kind").notNull().default("text"),
  // 標注（跨組指標）：可把「專案／資料庫／排程／筆記」帶進私訊變成可點卡片。送出時以「發訊者本人權限」
  // 驗證可存取（dmCore.assertDmRef）；卡片只是指標，對方點擊時各目標頁再自行做存取守衛。
  refType: text("ref_type", { enum: ["project", "database", "schedule", "note"] }),
  refId: uuid("ref_id"),
  // 圖／影片／檔案附件：指向 dm_attachments（上傳時建立、送訊時綁定）。允許「只有附件、body 為空」。
  attachmentId: uuid("attachment_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  // 對話串雙向查詢：sender 前綴查「我發給某人」、recipient 前綴查「某人發給我」＋未讀計數
  senderIdx: index("dm_messages_sender_idx").on(t.senderId, t.recipientId, t.createdAt),
  recipientIdx: index("dm_messages_recipient_idx").on(t.recipientId, t.senderId, t.createdAt),
}));

/**
 * 私訊附件（圖／影片／檔案）：獨立於專案素材（assets 掛組、組內可見）——私訊附件只有收發雙方看得到，
 * 檔案服務端點以「本人是上傳者，或本人是所屬訊息的收訊者」為界（見 index.ts /api/dm/attachments/:id/file）。
 * 上傳先建列（messageId 為 null＝尚未綁定），dm.send 帶 attachmentId 時才把 messageId 補上並驗擁有＋未用。
 * 落地檔走既有 storage（storagePath）。未送出的孤兒列（挑了檔又沒送）罕見且小，暫不自動清掃。
 */
export const dmAttachments = pgTable("dm_attachments", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** 上傳者（＝送訊者）。綁定前只有本人讀得到；綁定後所屬訊息的對方也讀得到。 */
  ownerId: uuid("owner_id").notNull(),
  /** 綁定到的私訊（null＝上傳後尚未送出）。 */
  messageId: uuid("message_id"),
  kind: text("kind").notNull(), // image | video | audio | doc（沿用 storage.kindFromMime）
  title: text("title").notNull(),
  storagePath: text("storage_path").notNull(),
  mime: text("mime").notNull(),
  sizeBytes: integer("size_bytes").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  ownerIdx: index("dm_attachments_owner_idx").on(t.ownerId),
  messageIdx: index("dm_attachments_message_idx").on(t.messageId),
}));

/** 私訊已讀水位：每人對每位對話者一筆 lastReadAt，未讀數＝晚於水位的對方來訊數（dmCore upsert 維護） */
export const dmReads = pgTable("dm_reads", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  peerId: uuid("peer_id").notNull(),
  lastReadAt: timestamp("last_read_at").defaultNow().notNull(),
}, (t) => ({
  userPeerIdx: index("dm_reads_user_peer_idx").on(t.userId, t.peerId),
  userPeerUq: uniqueIndex("dm_reads_user_peer_uq").on(t.userId, t.peerId),
}));

/** 留言表情回應：每人對每則每種表情最多一筆（再按一次＝收回），白名單見 messages router */
export const messageReactions = pgTable("message_reactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  messageId: uuid("message_id").notNull(),
  userId: uuid("user_id").notNull(),
  emoji: text("emoji").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  msgIdx: index("message_reactions_msg_idx").on(t.messageId),
  msgUserEmojiUq: uniqueIndex("message_reactions_msg_user_emoji_uq").on(t.messageId, t.userId, t.emoji),
}));

/** 留言已讀水位：每人每專案一筆 lastReadAt，未讀數＝晚於水位的他人留言數（router upsert 維護） */
export const messageReads = pgTable("message_reads", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  projectId: uuid("project_id").notNull(),
  lastReadAt: timestamp("last_read_at").defaultNow().notNull(),
}, (t) => ({
  userProjectIdx: index("message_reads_user_project_idx").on(t.userId, t.projectId),
  userProjectUq: uniqueIndex("message_reads_user_project_uq").on(t.userId, t.projectId),
}));

/** 工作流執行紀錄：後端執行器逐步推進（關頁不中斷）；steps 為每步狀態快照 */
export const workflowRuns = pgTable("workflow_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull(),
  groupId: uuid("group_id").notNull(),
  userId: uuid("user_id").notNull(),
  presetId: text("preset_id").notNull(),
  prompt: text("prompt").notNull(),
  /** 啟動時沿用生成台勾選的角色/場景卡（null＝沒帶）——runner 每 tick 從 run 列重建輸入，必須落庫才能貫穿每一步 */
  characterIds: jsonb("character_ids").$type<string[]>(),
  scenePresetIds: jsonb("scene_preset_ids").$type<string[]>(),
  status: text("status", { enum: ["running", "done", "failed", "stopped"] }).notNull().default("running"),
  currentStep: integer("current_step").notNull().default(0),
  /** 每步：{ note, status: "pending"|"running"|"done"|"failed"|"stopped", generationId?, detail? } */
  steps: jsonb("steps").notNull(),
  error: text("error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/**
 * 交付包匯出 job（QA-005）：同步 ZIP 下載改為「建 job → 背景打包到 Volume → 輪詢進度 → 完成後下載」。
 * 大包（遠端素材多）打包可達數分鐘，同步串流讓瀏覽器看似卡死、使用者重複點擊做出重複包。
 * 新表由正式 migration 建立；status 由 exportRunner 以 CAS 推進；cancelled 由取消 mutation 設定，
 * runner 在進度回報時讀到即中止。done 的 zip 檔留在 Volume（storagePath），過期由 runner 定期清理。
 */
export const exportJobs = pgTable("export_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull(),
  groupId: uuid("group_id").notNull(),
  userId: uuid("user_id").notNull(),
  /** 素材庫多選打包的素材 id 清單；null＝全量打包 */
  assetIds: jsonb("asset_ids"),
  status: text("status", { enum: ["queued", "running", "done", "failed", "cancelled"] }).notNull().default("queued"),
  /** 下載時的 Content-Disposition 檔名（依專案標題產生） */
  zipName: text("zip_name"),
  /** 完成後 zip 在 Volume 的相對路徑（assets 樹下）；未完成/失敗為 null */
  storagePath: text("storage_path"),
  doneEntries: integer("done_entries").notNull().default(0),
  totalEntries: integer("total_entries").notNull().default(0),
  /** 已寫出位元組（bigint：多媒體大包可能超過 int4 上限 2.1GB） */
  bytesWritten: bigint("bytes_written", { mode: "number" }).notNull().default(0),
  error: text("error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  projectIdx: index("export_jobs_project_idx").on(t.projectId, t.createdAt),
  statusIdx: index("export_jobs_status_idx").on(t.status, t.updatedAt),
}));

/**
 * AI 代理執行紀錄（代理系統核心）：一句目標 → LLM 規劃多步計畫 → 使用者核准 → 伺服器背景逐步執行。
 * 慣例與 workflowRuns 對齊：steps jsonb 快照、runner 是 steps 的單一寫者、停止只改 run 狀態。
 * 與工作流的差別：步驟由 LLM 針對目標動態規劃（非固定 preset），且要「核准後」才開始花點數。
 */
export const agentRuns = pgTable("agent_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull(),
  groupId: uuid("group_id").notNull(),
  userId: uuid("user_id").notNull(),
  /** 使用者的一句目標（例：把知識庫的腳本拆成分鏡並逐鏡出圖） */
  goal: text("goal").notNull(),
  /** LLM 的計畫摘要（核准畫面顯示） */
  summary: text("summary").notNull().default(""),
  /** 結構化完整計畫摘要：成功條件、缺少資訊、假設、風險、里程碑、成本與時程。 */
  planSummary: jsonb("plan_summary").$type<CompletePlanSummary>(),
  status: text("status", { enum: ["awaiting_approval", "running", "waiting", "done", "failed", "stopped", "discarded"] })
    .notNull()
    .default("awaiting_approval"),
  currentStep: integer("current_step").notNull().default(0),
  /** 每步：見 services/agentRunner 的 AgentStep（kind/note/status/估點/執行期 generationId 等） */
  steps: jsonb("steps").notNull(),
  /** 核准畫面顯示的估點總額；實際扣點仍由各步驟既有守門逐筆進行 */
  estPoints: integer("est_points").notNull().default(0),
  error: text("error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/**
 * 非建立型代理副作用的永久冪等憑證。
 * create_note/create_schedule 直接以 effectId 當目標資料列 UUID；append_note/update_schedule
 * 則把「內容變更」與此紀錄放在同一交易，避免 COMMIT 後、step 寫回前崩潰造成重複追加／修改。
 */
export const agentStepEffects = pgTable("agent_step_effects", {
  id: uuid("id").primaryKey(),
  runId: uuid("run_id").notNull(),
  stepId: text("step_id").notNull(),
  kind: text("kind").notNull(),
  outputType: text("output_type").notNull(),
  outputId: uuid("output_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  runStepUq: uniqueIndex("agent_step_effects_run_step_uq").on(t.runId, t.stepId),
  runIdx: index("agent_step_effects_run_idx").on(t.runId),
}));

/** AI 與團隊共用的正式人類任務；不是只存在 agent_runs.steps JSON 裡的顯示文字。 */
export const projectTasks = pgTable("project_tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  groupId: uuid("group_id").notNull(),
  projectId: uuid("project_id").notNull(),
  planRunId: uuid("plan_run_id"),
  planStepId: text("plan_step_id"),
  /** wait_for_human/request_approval 掛上後，完成／核准會以此喚醒指定步驟。 */
  wakeRunId: uuid("wake_run_id"),
  wakeStepId: text("wake_step_id"),
  taskType: text("task_type", { enum: ["task", "approval"] }).notNull().default("task"),
  title: text("title").notNull(),
  description: text("description"),
  assigneeId: uuid("assignee_id"),
  approverRole: text("approver_role", { enum: ["project_owner", "group_leader", "admin"] }),
  status: text("status", { enum: ["todo", "doing", "waiting", "review", "done", "cancelled"] })
    .notNull()
    .default("todo"),
  priority: text("priority", { enum: ["low", "normal", "high", "urgent"] }).notNull().default("normal"),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  dueAt: timestamp("due_at", { withTimezone: true }),
  createdBy: uuid("created_by").notNull(),
  completedBy: uuid("completed_by"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  sourceMessageId: uuid("source_message_id"),
  mentions: jsonb("mentions").$type<string[]>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  planStepUq: uniqueIndex("project_tasks_plan_step_uq").on(t.planRunId, t.planStepId),
  projectStatusIdx: index("project_tasks_project_status_idx").on(t.projectId, t.status),
  groupStatusIdx: index("project_tasks_group_status_idx").on(t.groupId, t.status),
  assigneeStatusIdx: index("project_tasks_assignee_status_idx").on(t.assigneeId, t.status),
  wakeRunIdx: index("project_tasks_wake_run_idx").on(t.wakeRunId),
}));

/**
 * 每組自訂選項（R23）：內容類型/發布平台/世界觀(調性·主軸·視覺風格)由各組組長自行增修。
 * 首次讀取時以 shared/options 的預設 lazy-seed；(groupId,type,value) 唯一，讓 seed 冪等。
 * worldview 類（tone/theme/style）value===label（直接是注入生成的字串）；kind/platform 的 value 是穩定 id。
 */
export const groupOptions = pgTable("group_options", {
  id: uuid("id").primaryKey().defaultRandom(),
  groupId: uuid("group_id").notNull(),
  type: text("type", { enum: ["kind", "platform", "tone", "theme", "style"] }).notNull(),
  value: text("value").notNull(),
  label: text("label").notNull(),
  /** 僅 platform 用：畫面比例 16:9 / 9:16 / 1:1（生成時帶入） */
  format: text("format"),
  sortOrder: integer("sort_order").notNull().default(0),
  /** 停用＝不再出現在挑選清單，但既有專案已存的值仍可顯示（不硬刪，保資料完整） */
  active: boolean("active").notNull().default(true),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  // 由可審核 migration 建立；既有資料若重複，必須先走 baseline 前置清理，
  // 不再在每次應用程式開機時刪資料。
  groupTypeValueUq: uniqueIndex("group_options_group_type_value_uq")
    .on(t.groupId, t.type, t.value),
}));

/**
 * 元件級回饋（R23）：使用者點選頁面元件自動標定 → 分類 + 文字 + 可選截圖。
 * 有別於 feedback 表（定期六題滿意度問卷），這裡是「針對某頁某元件的即時回報」。
 * pages＝可複選頁面；target*＝被點選的元件描述（page-level 回饋時為 null）。
 */
/**
 * 專案級權限（需求 2.3 v1）：預設「組內全員可編輯」（無列＝editor，完全向後相容）；
 * 組長可把個別成員明確設為 viewer（唯讀：不能生成/改分鏡/改知識庫，仍可看、留言、下載）。
 * 組長/團隊管理員/開發者永遠可編輯（不受列影響）。新表由正式 migration 建立。
 */
export const projectMembers = pgTable("project_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull(),
  userId: uuid("user_id").notNull(),
  role: text("role", { enum: ["editor", "viewer"] }).notNull().default("editor"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  projectIdx: index("project_members_project_idx").on(t.projectId),
  projectUserUq: uniqueIndex("project_members_project_user_uq").on(t.projectId, t.userId),
}));

/**
 * 筆記（需求 10）：會議紀錄等長文。掛組（可選掛專案）；
 * 更新前由 notes router 存 text_versions 快照（kind='note'，refId=note id），與知識庫同一版本機制。
 */
export const notes = pgTable("notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  groupId: uuid("group_id").notNull(),
  /** 掛在某專案下（null＝組層級筆記） */
  projectId: uuid("project_id"),
  title: text("title").notNull(),
  content: text("content").notNull(),
  createdBy: uuid("created_by").notNull(),
  /** 由某則留言「轉筆記」建立時記來源留言 id，供 Planner 反向「來自留言」跳回 */
  sourceMessageId: uuid("source_message_id"),
  /** @提及同組成員（Planner 也能 @人；與留言 mentions 同語意） */
  mentions: jsonb("mentions").$type<string[]>(),
  /** 由 AI 執行計畫建立／更新時記錄來源，供 Planner 與工作台雙向跳轉。 */
  planRunId: uuid("plan_run_id"),
  planStepId: text("plan_step_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  groupIdx: index("notes_group_idx").on(t.groupId),
  planRunIdx: index("notes_plan_run_idx").on(t.planRunId),
}));

/**
 * 排程（需求 10）：組行事曆項目（會議、交付死線…）。
 * 不做 Google OAuth 雙向同步——以 /api/schedule/:groupId/calendar.ics 匯出，
 * 使用者自行匯入/訂閱到個人 Google 日曆（零 OAuth 基建達八成價值，見優化評估報告）。
 */
export const scheduleItems = pgTable("schedule_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  groupId: uuid("group_id").notNull(),
  /** 關聯專案（null＝組層級行程） */
  projectId: uuid("project_id"),
  title: text("title").notNull(),
  startsAt: timestamp("starts_at").notNull(),
  /** null＝無明確結束（ics 匯出時以 1 小時計） */
  endsAt: timestamp("ends_at"),
  /** 負責人（可選） */
  ownerId: uuid("owner_id"),
  note: text("note"),
  createdBy: uuid("created_by").notNull(),
  /** 由某則留言「轉待辦」建立時記來源留言 id，供 Planner 反向「來自留言」跳回 */
  sourceMessageId: uuid("source_message_id"),
  /** @提及同組成員（Planner 排程也能 @人） */
  mentions: jsonb("mentions").$type<string[]>(),
  /** 由 AI 執行計畫建立／更新時記錄來源，供 Planner 與工作台雙向跳轉。 */
  planRunId: uuid("plan_run_id"),
  planStepId: text("plan_step_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  groupStartIdx: index("schedule_items_group_start_idx").on(t.groupId, t.startsAt),
  planRunIdx: index("schedule_items_plan_run_idx").on(t.planRunId),
}));

/**
 * Google 日曆直連同步（OAuth）：每人一條連線。系統在對方 Google 帳戶建立一本專屬日曆
 * （calendar.app.created 最小權限——只能管理自建日曆，碰不到使用者原有日曆），
 * 之後排程的增刪改自動推送，不再需要手動匯出/匯入 .ics。
 * refresh token 以 AES-256-GCM 加密落庫（金鑰見 services/googleCalendar.ts）。
 */
export const googleCalendarConnections = pgTable("google_calendar_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** 一人一條連線（重新連結＝覆蓋） */
  userId: uuid("user_id").notNull().unique(),
  /** 連結的 Google 帳號 email（自 id_token 取得，僅供 UI 顯示辨識） */
  googleEmail: text("google_email"),
  /** AES-256-GCM 加密後的 refresh token（iv:tag:cipher，hex） */
  refreshTokenEnc: text("refresh_token_enc").notNull(),
  /** 系統在對方帳戶建立的專屬日曆 id（首次同步時建立） */
  calendarId: text("calendar_id"),
  /** error＝授權失效（例如使用者在 Google 端撤銷），UI 引導重新連結 */
  status: text("status", { enum: ["active", "error"] }).notNull().default("active"),
  lastError: text("last_error"),
  lastSyncAt: timestamp("last_sync_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/**
 * 個人整合連接（每個使用者自己連自己的外部服務）：
 * - google-drive＝Google 雲端硬碟 OAuth（scope 僅 drive.readonly，secretEnc＝refresh token）；
 * - notion＝個人 Notion integration token（使用者在 notion.so/my-integrations 自建）；
 * - api＝外部資料庫/API 連接（Airtable/Supabase/自建服務，secretEnc＝認證標頭值）。
 * secretEnc 一律 AES-256-GCM 加密（iv:tag:cipher hex，金鑰見 services/integrations.ts——與 DB 分離，
 * DB 外洩不可解密）；憑證原文永不回傳前端（meta 只存 email/workspace/末四碼等顯示用資訊）。
 * google-drive/notion 一人一條（name=""）；api 可多條具名連線。新表由正式 migration 建立。
 */
export const userIntegrations = pgTable("user_integrations", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  kind: text("kind", { enum: ["google-drive", "notion", "api"] }).notNull(),
  /** api 連接的顯示名稱（如「總會 Airtable」）；google-drive/notion 固定空字串 */
  name: text("name").notNull().default(""),
  /** AES-256-GCM 加密後的憑證（refresh token／integration token／API 金鑰） */
  secretEnc: text("secret_enc").notNull(),
  /** api 連接的基底網址：抓取時固定同主機，憑證不會被送去別的主機 */
  baseUrl: text("base_url"),
  /** api 連接的認證標頭名（預設 Authorization；值即 secretEnc 解密原文） */
  authHeader: text("auth_header"),
  /** 顯示用中繼資料（非敏感）：google email／notion workspace／金鑰末四碼 */
  meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
  /** error＝授權失效或解密失敗（金鑰輪替），UI 引導重新連結 */
  status: text("status", { enum: ["active", "error"] }).notNull().default("active"),
  lastError: text("last_error"),
  lastUsedAt: timestamp("last_used_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  userKindNameIdx: uniqueIndex("user_integrations_user_kind_name_idx").on(t.userId, t.kind, t.name),
  userIdx: index("user_integrations_user_idx").on(t.userId),
}));

/** 排程項 ↔ Google 事件對應（每條連線一份），fingerprint 記上次推送內容摘要——沒變就跳過，省 API 配額 */
export const googleEventLinks = pgTable("google_event_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  connectionId: uuid("connection_id").notNull(),
  scheduleItemId: uuid("schedule_item_id").notNull(),
  googleEventId: text("google_event_id").notNull(),
  fingerprint: text("fingerprint").notNull(),
}, (t) => ({
  connItemIdx: uniqueIndex("google_event_links_conn_item_idx").on(t.connectionId, t.scheduleItemId),
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
});

/**
 * 回饋代理巡檢紀錄（每 3 天一次；亦可開發者手動觸發）：每次巡檢寫一列，
 * 記這輪看了幾筆、寄出幾封信、成功與否——管理頁「回饋代理」卡以最新一列顯示狀態。
 * 只插入不更新完局後不再改（running→done/failed 於同列 update），新表由正式 migration 建立。
 */
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

/* ── Web Push 跨裝置通知 ────────────────────────── */

/**
 * Web Push 訂閱（手機＋電腦跨裝置通知）：每位使用者每個「瀏覽器裝置」一筆——
 * 使用者在通知設定啟用後，瀏覽器發的 PushSubscription（endpoint＋加密金鑰）存這裡，
 * 伺服器事件（審批/私訊/@提及/生成與代理完成）經 services/webPush 推到所有已連結裝置，
 * 關頁、關瀏覽器也收得到（相對於既有的頁內桌面通知只在分頁開著時有效）。
 * endpoint 唯一＝同裝置重複啟用是 upsert 不長重複列；推送回 404/410 即自動清掉失效列。
 * 新表由正式 migration 建立。
 */
export const pushSubscriptions = pgTable("push_subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  /** 推送服務給的裝置端點網址（capability URL，只有配對的 VAPID 私鑰能對它發推送） */
  endpoint: text("endpoint").notNull().unique(),
  /** 瀏覽器產生的訊息加密公鑰（P-256 ECDH）——推送內容端到端加密到該裝置 */
  p256dh: text("p256dh").notNull(),
  /** 瀏覽器產生的驗證密鑰 */
  auth: text("auth").notNull(),
  /** 裝置標籤（如「iPhone・Safari」「Windows・Chrome」）：前端從 UA 推導，設定頁列裝置清單用 */
  label: text("label"),
  /** 最後同步時刻：每次 App 載入時前端回報一次，供「清最舊裝置」與設定頁排序 */
  lastSeenAt: timestamp("last_seen_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  userIdx: index("push_subscriptions_user_idx").on(t.userId, t.lastSeenAt),
}));

/**
 * VAPID 金鑰對（單列 key='vapid'）：未設 VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY 環境變數時
 * 開機自動生成並存這裡——金鑰必須跨重啟穩定，否則所有既有訂閱全數失效。新表由正式 migration 建立。
 */
export const webPushVapid = pgTable("web_push_vapid", {
  key: text("key").primaryKey(),
  publicKey: text("public_key").notNull(),
  privateKey: text("private_key").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

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
