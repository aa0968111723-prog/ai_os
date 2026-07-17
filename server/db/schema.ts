/**
 * AI Director OS — 資料庫 schema（單一真相來源）
 * PostgreSQL · Drizzle（pg 方言）
 * 組織模型：超管 → 團隊(team_admin) → 組別(leader/member)；角色是關係不是屬性。
 */
import { pgTable, uuid, text, integer, boolean, timestamp, jsonb, index } from "drizzle-orm/pg-core";

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
  /** 每人每日上限（null/0＝不限）——簡報「每人每日上限，不會有人不小心把預算爆掉」 */
  defaultDailyPoints: integer("default_daily_points"),
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
  /** awaiting_approval/rejected（需求 2.1 成本審核）：達組門檻的組員生成先待核，核准才扣點送 fal；
   *  enum 只是 TS 層註記（DB 欄位為 text），pushSchema 對既有表無變更 */
  status: text("status", { enum: ["queued", "running", "done", "failed", "awaiting_approval", "rejected"] }).notNull().default("queued"),
  pointsEst: integer("points_est").notNull().default(0),
  pointsActual: integer("points_actual"),
  pointsRefunded: integer("points_refunded").notNull().default(0),
  requestId: text("request_id"),
  /** 綁定的分鏡格（可為 null）：草稿分鏡「就地生成」時填入，完成後把成品回填該格 scenes.assetId */
  sceneId: uuid("scene_id"),
  /** 這筆生成要回填分鏡的哪個角色："visual"＝畫面（回填 scenes.assetId）、"narration"＝旁白音檔（回填 scenes.narrationAssetId）；null＝視為 visual */
  sceneRole: text("scene_role", { enum: ["visual", "narration"] }),
  resultUrl: text("result_url"),
  /** 文字型輸出(LLM/圖轉文/語音轉文字/訓練結果資訊)直接存這裡 */
  resultText: text("result_text"),
  /** 來源輸入(圖生圖底圖、待轉錄音訊等) */
  sourceUrl: text("source_url"),
  error: text("error"),
  /** 使用者為生成物取的名字（null＝用 prompt 當標題）——生成紀錄好找片（#20） */
  name: text("name"),
  /** 收藏標記：標星的生成物可篩「只看收藏」（#20）。nullable+default false＝pushSchema 安全、既有列回填 false */
  favorite: boolean("favorite").default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  // listByProject 對每個分鏡各跑兩支 scene_id 相關子查詢；補索引避免生成量成長後全表掃描。
  // 非 unique（純索引，pushSchema 建索引不觸發 truncate 提問，安全）
  sceneIdIdx: index("generations_scene_id_idx").on(t.sceneId),
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
  /** 固定素材模式（簡報 slide 19）：師父原音／開示文字／配樂設「鎖定·不可更動」，
   *  交付包會把鎖定素材原封保留在 00_鎖定原素材/，剪輯時圍繞它組裝、不改動 */
  locked: boolean("locked").notNull().default(false),
  /** 軟刪除（回收桶）：非 null＝已丟進回收桶。點數＝真金，刪除不退點、不刪 Volume 檔，可還原。
   *  所有「列出／匯出／注入」查詢都以 isNull(deletedAt) 過濾，還原＝清回 null。 */
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

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
 * 目前 kind='knowledge'（refId=knowledge.id）；未來可擴 'worldview'。新表＝pushSchema 安全。
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
  // 協作強化（留言 2.0）：回覆串／組長釘選／引用專案內作品（分鏡・素材・生成）／@提及
  replyToId: uuid("reply_to_id"),
  pinned: boolean("pinned").notNull().default(false),
  refType: text("ref_type", { enum: ["scene", "asset", "generation"] }),
  refId: uuid("ref_id"),
  mentions: jsonb("mentions").$type<string[]>(),
  // 留言第一梯隊：語音留言（kind='voice'，音檔存 ref asset，voiceStatus 轉錄狀態，body 收轉錄稿）
  // 與 @助手回覆（kind='assistant'，body 為 LLM 回答，userId 記觸發者）。
  voiceStatus: text("voice_status", { enum: ["pending", "done", "failed"] }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  projectIdx: index("messages_project_idx").on(t.projectId, t.createdAt),
  voicePendingIdx: index("messages_voice_pending_idx").on(t.voiceStatus),
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
}));

/** 留言已讀水位：每人每專案一筆 lastReadAt，未讀數＝晚於水位的他人留言數（router upsert 維護） */
export const messageReads = pgTable("message_reads", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  projectId: uuid("project_id").notNull(),
  lastReadAt: timestamp("last_read_at").defaultNow().notNull(),
}, (t) => ({
  userProjectIdx: index("message_reads_user_project_idx").on(t.userId, t.projectId),
}));

/** 工作流執行紀錄：後端執行器逐步推進（關頁不中斷）；steps 為每步狀態快照 */
export const workflowRuns = pgTable("workflow_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull(),
  groupId: uuid("group_id").notNull(),
  userId: uuid("user_id").notNull(),
  presetId: text("preset_id").notNull(),
  prompt: text("prompt").notNull(),
  status: text("status", { enum: ["running", "done", "failed", "stopped"] }).notNull().default("running"),
  currentStep: integer("current_step").notNull().default(0),
  /** 每步：{ note, status: "pending"|"running"|"done"|"failed"|"stopped", generationId?, detail? } */
  steps: jsonb("steps").notNull(),
  error: text("error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/**
 * 每組自訂選項（R23）：內容類型/發布平台/世界觀(調性·主軸·視覺風格)由各組組長自行增修。
 * 首次讀取時以 shared/options 的預設 lazy-seed；(groupId,type,value) 唯一，讓 seed 冪等。
 * worldview 類（tone/theme/style）value===label（直接是注入生成的字串）；kind/platform 的 value 是穩定 id。
 */
// 註：不加 (group_id,type,value) DB 層 unique constraint——drizzle-kit pushSchema 對「已有資料
// 的表新增 unique」會觸發互動式 truncate 提問，在非 TTY 容器直接卡死開機（redeploy 才會爆）。
// 冪等改由應用層保證：groups.optionsSeeded 旗標保證每組只 seed 一次、upsert 自行擋同名，已足夠。
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
});

/**
 * 元件級回饋（R23）：使用者點選頁面元件自動標定 → 分類 + 文字 + 可選截圖。
 * 有別於 feedback 表（定期六題滿意度問卷），這裡是「針對某頁某元件的即時回報」。
 * pages＝可複選頁面；target*＝被點選的元件描述（page-level 回饋時為 null）。
 */
/**
 * 專案級權限（需求 2.3 v1）：預設「組內全員可編輯」（無列＝editor，完全向後相容）；
 * 組長可把個別成員明確設為 viewer（唯讀：不能生成/改分鏡/改知識庫，仍可看、留言、下載）。
 * 組長/團隊管理員/開發者永遠可編輯（不受列影響）。新表＝pushSchema 安全。
 */
export const projectMembers = pgTable("project_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull(),
  userId: uuid("user_id").notNull(),
  role: text("role", { enum: ["editor", "viewer"] }).notNull().default("editor"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  projectIdx: index("project_members_project_idx").on(t.projectId),
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
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  groupIdx: index("notes_group_idx").on(t.groupId),
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
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  groupStartIdx: index("schedule_items_group_start_idx").on(t.groupId, t.startsAt),
}));

/**
 * 審計日誌（需求 2.2「紀錄每一個行動的每一個細節操作」）：
 * 所有登入後 mutation 由 tRPC 中介層集中寫入（見 services/audit.ts）——
 * 誰、何時、做了什麼（procedure 路徑）、對哪個組/專案、輸入摘要（已脫敏）、成功與否。
 * 新表＝pushSchema 安全；只插入不更新，量大時靠索引查詢。
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
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
