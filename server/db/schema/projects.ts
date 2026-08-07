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
  /**
   * 專案封面圖（可選）：綁一張本專案素材庫的圖片素材，作業台卡片就顯示它而不是首字色塊。
   * null＝沿用以 id 雜湊出的色塊封面。素材進回收桶時不清綁定（比照角色定裝卡），
   * 列出時以 isNull(assets.deletedAt) 左接——縮圖自動退回色塊，還原素材後又接回來。
   */
  coverAssetId: uuid("cover_asset_id"),
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
  projectCreatedIdx: index("props_project_created_idx").on(t.projectId, t.createdAt),
  ownerIdx: index("props_owner_idx").on(t.projectId, t.ownerKind, t.ownerId),
}));

export const scenes = pgTable("scenes", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull(),
  orderIndex: integer("order_index").notNull().default(0),
  title: text("title").notNull(),
  durationSec: integer("duration_sec").notNull().default(5),
  /**
   * 畫面素材的來源入點（毫秒）——「剪初稿」要切的就是這個。
   * 0＝從素材開頭播。與 trimEndMs 一組，語義見 shared/timeline.ts 的 ShotSource。
   */
  trimStartMs: integer("trim_start_ms").notNull().default(0),
  /**
   * 畫面素材的來源出點（毫秒）；null＝這一鏡沒修剪過，鏡長仍由 durationSec 決定。
   * 存絕對出點而非「尾巴切掉多少」：素材重生成、長度變了時，絕對位置仍指向同一個時間點。
   */
  trimEndMs: integer("trim_end_ms"),
  status: text("status").notNull().default("todo"),
  assetId: uuid("asset_id"),
  narrationAssetId: uuid("narration_asset_id"),
  prompt: text("prompt"),
  voiceover: text("voiceover"),
  /** 這一鏡聽得到什麼（蟲鳴、鐘聲、腳步）——餵給音效／配樂模型的提示詞。與 voiceover 對稱。 */
  ambience: text("ambience"),
  /** 環境音成品音檔。與 narrationAssetId 對稱；null＝這一鏡還沒有環境音。 */
  ambienceAssetId: uuid("ambience_asset_id"),
  characterIds: jsonb("character_ids").$type<string[]>(),
  scenePresetIds: jsonb("scene_preset_ids").$type<string[]>(),
  propIds: jsonb("prop_ids").$type<string[]>(),
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  projectOrderIdx: index("scenes_project_order_idx").on(t.projectId, t.orderIndex),
}));

/**
 * 分鏡送審／裁決機制已移除——這張表現在是**遺留宣告**：沒有任何應用程式碼讀寫它，
 * 保留定義純粹是為了讓 schema 與實際 DB 對齊。
 *
 * 為什麼不直接刪掉宣告：db:check／db:adopt 的漂移檢查走 drizzle-kit pushSchema，
 * 它一看到「DB 有、schema 沒有」的表就會跳互動式提問（rename 還是 drop？），CI 無 TTY 直接炸，
 * migration 與 e2e 兩個 job 全紅。舊表與舊資料要保留，宣告就得留著。
 * 真的要清掉這張表，請另開一支 drop 的 migration，再一併移除這段宣告。
 */
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
  projectStatusIdx: index("approvals_project_status_idx").on(t.projectId, t.status),
}));

export const groupOptions = pgTable("group_options", {
  id: uuid("id").primaryKey().defaultRandom(),
  groupId: uuid("group_id").notNull(),
  type: text("type", { enum: ["kind", "platform", "tone", "theme", "style"] }).notNull(),
  value: text("value").notNull(),
  label: text("label").notNull(),
  format: text("format"),
  sortOrder: integer("sort_order").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  groupTypeValueUq: uniqueIndex("group_options_group_type_value_uq")
    .on(t.groupId, t.type, t.value),
}));

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
 * 專案分享連結（唯讀公開檢視）：把整個專案頁以唯讀形式分享給「還沒有帳號的夥伴」。
 *
 * 安全形狀比照 sessions／invites／upload_grants：DB 只存 token 的 SHA-256，原文只在建立
 * 當下回一次；可設有效期、可隨時撤銷。刻意不做「用過即失效」——分享連結本來就要能重複開。
 *
 * ★ 這是全庫唯一不需登入就能讀到專案內容的路徑。任何新增的公開欄位都等同對外公開，
 *   請一律經由 services/projectShare.ts 的 buildSharedProjectView 決定，不要另開讀取點。
 */
export const projectShareLinks = pgTable("project_share_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull(),
  /** 冗餘存一份：撤銷／稽核時不必再回查專案，專案被刪也還看得出原本屬於哪一組 */
  groupId: uuid("group_id").notNull(),
  /** SHA-256（非原文）；.unique() → CONSTRAINT project_share_links_token_hash_unique（對齊 0038） */
  tokenHash: text("token_hash").notNull().unique(),
  /** 建立者自填的備註（給誰看的），純內部顯示，不出現在公開檢視頁 */
  label: text("label"),
  createdBy: uuid("created_by").notNull(),
  /** null＝不設期限（建立者要自己記得撤銷） */
  expiresAt: timestamp("expires_at"),
  revokedAt: timestamp("revoked_at"),
  /** 最近一次被開啟的時間與累計次數：讓建立者看得出這條連結還活著、有沒有被亂傳 */
  lastViewedAt: timestamp("last_viewed_at"),
  viewCount: integer("view_count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  projectCreatedIdx: index("project_share_links_project_created_idx").on(t.projectId, t.createdAt),
}));

export const notes = pgTable("notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  groupId: uuid("group_id").notNull(),
  projectId: uuid("project_id"),
  title: text("title").notNull(),
  content: text("content").notNull(),
  createdBy: uuid("created_by").notNull(),
  sourceMessageId: uuid("source_message_id"),
  mentions: jsonb("mentions").$type<string[]>(),
  planRunId: uuid("plan_run_id"),
  planStepId: text("plan_step_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  groupIdx: index("notes_group_idx").on(t.groupId),
  planRunIdx: index("notes_plan_run_idx").on(t.planRunId),
}));

/**
 * 筆記／知識庫的檔案附件（0043_content_attachments）：
 * 會議紀錄要能夾照片、簽到表掃描檔、講義 PDF；知識庫的開示稿本來就常是一份 PDF/Word。
 * 原檔落在同一套素材儲存（storage_path，與素材庫／私訊附件共用 Volume 與備份），
 * text_content 存抽出的純文字——知識庫附件的文字會跟著注入 AI 導演，PDF 不再是「只能下載的死檔」。
 *
 * 刻意不加 FK：ref_id 依 kind 指向不同表（note／knowledge），刪除一律由 core 服務同交易清乾淨。
 * group_id 冗餘存一份，讓檔案服務不必先 join 母表就能做多組隔離的第一道守門。
 */
export const contentAttachments = pgTable("content_attachments", {
  id: uuid("id").primaryKey().defaultRandom(),
  groupId: uuid("group_id").notNull(),
  /** note=筆記附件（ref_id→notes.id）・knowledge=知識庫附件（ref_id→knowledge.id） */
  kind: text("kind", { enum: ["note", "knowledge"] }).notNull(),
  refId: uuid("ref_id").notNull(),
  name: text("name").notNull(),
  mime: text("mime").notNull(),
  sizeBytes: integer("size_bytes").notNull().default(0),
  storagePath: text("storage_path").notNull(),
  /** 抽出的純文字（pdf/docx/txt…）：知識庫注入與未來全文搜尋讀這裡；null＝圖片/影音或抽取失敗 */
  textContent: text("text_content"),
  uploadedBy: uuid("uploaded_by").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  refIdx: index("content_attachments_ref_idx").on(t.kind, t.refId, t.createdAt),
  groupIdx: index("content_attachments_group_idx").on(t.groupId),
}));

/** 筆記留言（討論串）— 0034_note_comments */
export const noteComments = pgTable("note_comments", {
  id: uuid("id").primaryKey().defaultRandom(),
  noteId: uuid("note_id").notNull(),
  groupId: uuid("group_id").notNull(),
  userId: uuid("user_id").notNull(),
  body: text("body").notNull(),
  replyToId: uuid("reply_to_id"),
  mentions: jsonb("mentions").$type<string[]>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  noteCreatedIdx: index("note_comments_note_created_idx").on(t.noteId, t.createdAt),
  groupIdx: index("note_comments_group_idx").on(t.groupId),
}));

export const scheduleItems = pgTable("schedule_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  groupId: uuid("group_id").notNull(),
  projectId: uuid("project_id"),
  title: text("title").notNull(),
  startsAt: timestamp("starts_at").notNull(),
  endsAt: timestamp("ends_at"),
  ownerId: uuid("owner_id"),
  note: text("note"),
  createdBy: uuid("created_by").notNull(),
  sourceMessageId: uuid("source_message_id"),
  mentions: jsonb("mentions").$type<string[]>(),
  planRunId: uuid("plan_run_id"),
  planStepId: text("plan_step_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  groupStartIdx: index("schedule_items_group_start_idx").on(t.groupId, t.startsAt),
  planRunIdx: index("schedule_items_plan_run_idx").on(t.planRunId),
}));
