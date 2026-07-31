/**
 * Generation domain schema（生成、點數帳本、素材、工作流、匯出）
 */
import { pgTable, uuid, text, integer, bigint, boolean, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

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
  /** TD-09 estimated：目錄預估點數（提交前算好；貫穿審核門檻／reserveQuota／失敗退額） */
  pointsEst: integer("points_est").notNull().default(0),
  /** TD-09 actual：完成時實花點數；現況 advanceGeneration 寫入時 = pointsEst，未來可接 provider 真實成本 */
  pointsActual: integer("points_actual"),
  /** TD-09 失敗路徑已退回點數（與 cost_ledger 正 delta 對帳；全退後 settled≈0） */
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

/**
 * 點數帳本（append-only）— TD-09 phase 語意見 docs/architecture/cost-ledger-model.md
 * - delta < 0＝預留／扣點（reserved charge）；delta > 0＝退點／補點
 * - 淨消耗 = -SUM(delta)（與 points.ts 守門／quota 同一口徑）
 * - 先扣預估、失敗退回；成功時 reserved 負列直接視為 settled（現況不另插結算列）
 * - 同一 generation_id 可多列（扣＋退），禁止 unique(generation_id)
 */
export const costLedger = pgTable("cost_ledger", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  groupId: uuid("group_id").notNull(),
  /** 有號點數變動：負＝扣／預留，正＝退／補（見 shared/costLedgerTypes.ledgerDirection） */
  delta: integer("delta").notNull(),
  /** 人話原因（非 enum／非 phase）；常見「生成 …」「…失敗退回」「人工補點」 */
  reason: text("reason").notNull(),
  /** 可空；有則按生成對帳（退點冪等、週歸屬 JOIN） */
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
  /** 落地檔內容雜湊：DB↔磁碟對帳時用來判斷「檔案還在但內容被截斷／覆寫」，光看大小抓不到 */
  sha256: text("sha256"),
  /**
   * 外部來源原始網址（fal 等）。落地成功後「不」抹除，這點是刻意的：
   * 舊版把 url 覆寫成本地路徑，等於在檔案還在的時候親手關掉唯一的補救來源——
   * 真的掉檔時連「原網址還沒過期就再抓一次」都做不到。留著它，補抓才有東西可抓。
   */
  originUrl: text("origin_url"),
  /**
   * 落地狀態：pending＝還沒落地（等補抓）、landed＝已在 Volume、failed＝重試到放棄、skipped＝本來就不需落地。
   * 預設 landed 是刻意的：既有列絕大多數早已落地，預設 pending 會讓整張表被誤判成待補抓，
   * 真正沒落地的少數列改由 migration 最後一句精準改回 pending。
   */
  landState: text("land_state", { enum: ["pending", "landed", "failed", "skipped"] }).notNull().default("landed"),
  /** 已嘗試補抓次數：退避間隔與「幾次之後放棄」都靠它，死列才不會永遠佔著佇列名額 */
  landAttempts: integer("land_attempts").notNull().default(0),
  /** 最近一次補抓失敗原因（人看的）：分辨「來源 404 永遠救不回」與「暫時逾時可再試」 */
  landLastError: text("land_last_error"),
  /** 最近一次嘗試時間——排查「到底有沒有在跑」的第一個依據 */
  landLastTriedAt: timestamp("land_last_tried_at"),
  /** 下次可嘗試時間（退避後的排程點）：佇列以它排序，避免剛失敗的列立刻被重抓、把名額吃光 */
  landNextTryAt: timestamp("land_next_try_at"),
  /** 被某個 worker 取走的時間：多實例／多 tick 併發時避免同一筆被重複下載；逾時未完成即可回收 */
  landClaimedAt: timestamp("land_claimed_at"),
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
  // 補抓佇列的取件查詢（WHERE land_state='pending' AND land_next_try_at <= now() ORDER BY land_next_try_at）
  // 每個 tick 都跑一次。用部分索引而非整表索引：待補抓的永遠只佔素材總量極小一部分，
  // 索引只收那幾列，體積小、掃得快，也不會讓每次上傳素材都去維護一個幾乎全是 landed 的大索引。
  landQueueIdx: index("assets_land_queue_idx").on(t.landNextTryAt).where(sql`land_state = 'pending'`),
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
