/**
 * Storage durability schema（素材保全：卷身分、對帳、備份）
 *
 * 三張表的共同存在理由：素材是使用者花點數換來的成品，而「檔案不見」是整個系統裡最晚才會被
 * 發現的故障——通常是幾週後有人點開舊專案看到破圖才知道。事後要回答「什麼時候開始不見的」
 * 「當時有沒有備份可救」，就必須把每一次檢查與備份的結果落庫；只寫 log 的話重啟即失憶，
 * 等於出事時完全沒有證據可以回推。
 */
import { pgTable, uuid, text, integer, bigint, boolean, timestamp, jsonb, index } from "drizzle-orm/pg-core";

/**
 * 儲存層鍵值狀態（目前只用一把鑰匙："volume-id"＝卷身分指紋）。
 *
 * 為什麼需要：Volume 有沒有被換掉，從磁碟本身看不出來——新掛上的空卷，跟「檔案全被刪光的舊卷」
 * 在檔案系統層長得一模一樣。做法是把一份隨機指紋同時寫在 Volume 根目錄與這張表，開機時兩邊對照：
 * 對不起來就代表卷被換過或被清空，必須立刻降級示警，而不是安靜地把所有素材當成「本來就不存在」。
 *
 * 用鍵值表而不是固定欄位的單列表，是因為後續還會有別的儲存層狀態（例如上次成功寫入時間）要放，
 * 不值得為了多一個欄位再開一張新表、再寫一份 migration。
 */
export const storageState = pgTable("storage_state", {
  /** 狀態鍵；目前只有 "volume-id" 一個值在用 */
  key: text("key").primaryKey(),
  /** 狀態值（純文字。volume-id 存的是隨機指紋字串，不含任何使用者資料） */
  value: text("value").notNull(),
  /** 最後寫入時間——用來判斷這份指紋是哪一次開機寫下的，追查換卷時間點時是關鍵線索 */
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * DB↔磁碟對帳結果（每跑一次留一列）。
 *
 * 為什麼需要：缺檔現況只會回一個安靜的 404，沒有任何地方記得「什麼時候開始少的、少了幾筆」。
 * 把每次對帳的檢查數／缺檔數／損壞數落庫之後，事故時才能把時間軸拉出來——例如「7/12 那次還是 0，
 * 7/13 突然 300」就直接把嫌疑範圍縮到這兩次之間的部署或掛載變更，不必再靠人腦回想。
 *
 * 保留 sample 是為了讓人不必連進機器、不必開 psql，就能直接看到「到底是哪幾筆不見」。
 */
export const storageAuditRuns = pgTable("storage_audit_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** 開始時間。先插列再開跑，中途被殺也留得下「跑到一半」的痕跡（finishedAt 為 null） */
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  /** 完成時間；null＝沒跑完（被殺／當掉）。系統自檢據此避免把未完成的結果當成「最近一次成功對帳」 */
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  /** sample＝抽樣（例行快檢）、full＝全量（人工觸發或事故調查）。兩者數字口徑差很多，不標明會誤讀 */
  mode: text("mode", { enum: ["sample", "full"] }).notNull().default("sample"),
  /** 這次實際檢查了幾筆（抽樣模式下遠小於總量；沒有它就無法判讀 missing 的嚴重程度） */
  checked: integer("checked").notNull().default(0),
  /** DB 有列、磁碟沒檔：使用者點下去會破圖的筆數，也是這張表最重要的一個數字 */
  missing: integer("missing").notNull().default(0),
  /** 檔案在、但大小與 DB 紀錄對不上：多半是寫到一半被中斷的半截檔，同樣不能播放 */
  corrupt: integer("corrupt").notNull().default(0),
  /** 這次因缺檔而被排進補抓佇列的筆數——區分「壞掉」與「壞掉但已安排自動救回」 */
  recoveredQueued: integer("recovered_queued").notNull().default(0),
  /** 反向孤兒：磁碟有檔、DB 沒有對應列。不會讓使用者看到破圖，但會默默吃掉 Volume 容量 */
  orphanFiles: integer("orphan_files").notNull().default(0),
  /** 孤兒檔佔用位元組（bigint：影音孤兒累積起來輕易超過 int4 上限 2.1GB） */
  orphanBytes: bigint("orphan_bytes", { mode: "number" }).notNull().default(0),
  /** 問題樣本（前幾筆 { entity, id, rel, reason }）；只存識別用的相對路徑，不存檔案內容 */
  sample: jsonb("sample").$type<{ entity: string; id: string; rel: string; reason: string }[]>(),
}, (t) => ({
  // 系統自檢每次都要問「最近一次跑完的對帳是什麼時候、結果如何」＝ ORDER BY finished_at DESC LIMIT 1。
  // 這張表每跑一次長一列，長期累積後沒索引就是全表掃＋排序。
  finishedIdx: index("storage_audit_runs_finished_idx").on(t.finishedAt),
}));

/**
 * 素材備份結果（每跑一次留一列）。
 *
 * 為什麼需要：備份最常見的死法不是「沒做」，而是「以為有做」——排程壞掉、目標空間滿了、
 * 憑證過期，而沒有任何人發現。系統自檢要能回答「上次成功備份是多久以前」，就必須有一份
 * 存在資料庫、重啟不會消失的紀錄；把失敗的那次也留下來（ok=false＋error），才看得出是
 * 「從來沒跑」還是「跑了一直失敗」，這兩者的處理方式完全不同。
 */
export const backupRuns = pgTable("backup_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** 開始時間。同樣先插列再開跑，中途被殺會留下 ok=false 且 finishedAt 為 null 的列 */
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  /** 完成時間；null＝沒跑完。判斷「上次成功備份」時必須同時看 ok 與這個欄位 */
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  /** 備份種類；目前只有 full（整包快照）。先留欄位，將來加 incremental 不必再動 schema */
  kind: text("kind").notNull().default("full"),
  /** 是否成功。預設 false 是刻意的：開跑時先寫 false，全部搬完才改 true，程序被砍不會留下假成功 */
  ok: boolean("ok").notNull().default(false),
  /** 這次備份的檔案數——與對帳的 checked 對照，能看出備份是否漏掉一整塊 */
  fileCount: integer("file_count").notNull().default(0),
  /** 這次備份的總位元組（bigint：素材庫整包遠超過 int4 上限 2.1GB） */
  totalBytes: bigint("total_bytes", { mode: "number" }).notNull().default(0),
  /** 備份落點（本機路徑或遠端 bucket 前綴）。事故當下最先要問的就是「那份備份在哪」 */
  target: text("target"),
  /** 失敗原因（ok=false 時）。要能直接顯示給非技術使用者看懂下一步該做什麼 */
  error: text("error"),
  /** 觸發來源：排程、開機自動、或人工按下按鈕。判斷「排程是不是根本沒在跑」的依據 */
  triggeredBy: text("triggered_by"),
}, (t) => ({
  // 系統自檢的問題永遠是「最近一次『成功』備份是什麼時候」＝ WHERE ok ORDER BY finished_at DESC。
  // ok 放前綴才能先濾掉失敗列，再靠索引直接取最新一筆。
  okFinishedIdx: index("backup_runs_ok_finished_idx").on(t.ok, t.finishedAt),
}));
