/**
 * Project domain schema（專案內容：分鏡、知識庫、角色、筆記、排程、組選項…）
 */
import { pgTable, uuid, text, integer, boolean, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";

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
  /**
   * 注入優先：釘選列在 buildKnowledgeContext 永遠先於「僅依建立時間」。
   * 解決「新筆記擠掉舊腳本／開示」——使用者可釘住本片主腳本。
   */
  pinned: boolean("pinned").notNull().default(false),
  /**
   * 抽取摘要（更新內容時自動寫入；預算緊時可注入摘要取代全文尾巴）。
   * null＝尚未產生（舊列或空內容）。
   */
  summary: text("summary"),
  createdBy: uuid("created_by").notNull(),
  /** 軟刪除（回收桶）：非 null＝已丟進回收桶（保留逐字稿／見證，可還原）。
   *  ★ buildKnowledgeContext 必以 isNull(deletedAt) 過濾——已刪的逐字稿絕不可再注入 AI 導演 LLM。 */
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  projectPinnedCreatedIdx: index("knowledge_project_pinned_created_idx")
    .on(t.projectId, t.pinned, t.createdAt),
}));

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
  /** 最後一次用這則咒語生成時的模型/角色/場景/素材卡（null＝純文字舊列）——「再用」還原完整設定，不只文字 */
  modelId: text("model_id"),
  characterIds: jsonb("character_ids").$type<string[]>(),
  scenePresetIds: jsonb("scene_preset_ids").$type<string[]>(),
  propIds: jsonb("prop_ids").$type<string[]>(),
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

/**
 * 素材設定卡（角色·場景一致性的「物件」面）：
 * 反覆出現的道具／標誌物件（紅傘、佛珠、活動主視覺牌）外觀材質一次鎖定，
 * 生成勾選時注入錨點——同一把傘不會這鏡是紅的、下鏡變酒紅格紋。
 *
 * 與「素材庫（assets）」不同：assets 是已經存在的檔案，這裡是還沒被畫出來的物件設定。
 */
export const props = pgTable("props", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull(),
  groupId: uuid("group_id").notNull(),
  name: text("name").notNull(),
  /** 外觀・材質・顏色・尺寸——這段會直接注入生成提示詞 */
  appearance: text("appearance").notNull(),
  /** 用途・出現場合・Do/Don't（供 AI 導演與腳本參考；不注入視覺生成，避免被畫成文字） */
  notes: text("notes"),
  /** 素材參考圖（可選；上傳或從素材庫綁定，之後圖生圖可用作底） */
  referenceAssetId: uuid("reference_asset_id"),
  /**
   * 歸屬（可選）：這件物件屬於哪張卡——"character"＝某角色的隨身物品、
   * "scene"＝某場景的場上物件；null＝誰都不屬於的獨立物件。
   * 勾了主人時，它的物件會自動一起帶入生成（見 shared/propOwnership.ts）。
   */
  ownerKind: text("owner_kind", { enum: ["character", "scene"] }),
  /** 主人的卡片 id（characters.id 或 scene_presets.id；與 ownerKind 同進同出） */
  ownerId: uuid("owner_id"),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  // list 走 WHERE project_id ORDER BY created_at；建表當下就補索引，不等它慢了才修
  projectCreatedIdx: index("props_project_created_idx").on(t.projectId, t.createdAt),
  // 自動帶入要用「這批主人有哪些物件」反查：每次視覺生成都會跑，補索引
  ownerIdx: index("props_owner_idx").on(t.projectId, t.ownerKind, t.ownerId),
}));

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
