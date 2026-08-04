/**
 * pg advisory xact lock 的鍵空間註冊表——classifier(第二引數)撞號等於鎖失效,集中管理。
 * 同一 class 內以第一引數(多為 hashtext(某 uuid))區分;不同 class 完全獨立、永不互卡。
 * - 0:points per-user(services/points.ts reserveQuota, hashtext(userId))
 *     ＋固定鍵 864205＝全域總預算閘(reserveQuota;與 per-user 同 class 但鍵為固定整數,撞 hashtext 機率 ~1/2³²)
 * - 1:approvals per-scene(routers/approvals.ts submit/decide 序列化, hashtext(sceneId))
 *     ＋points per-group 組預算閘(services/points.ts reserveQuota, hashtext(groupId))——兩者鍵空間不同
 *     (sceneId vs groupId),hashtext 撞號機率 ~1/2³² 且僅致無害過度序列化,非死鎖/正確性缺陷。
 *     (approvals 從不在持有此鎖時呼叫 reserveQuota,故無交叉取得的死鎖面。)
 * - 2:scenes orderIndex per-project(本檔)——「讀 max→插入/互換/重排」的 read-modify-write
 *   在 READ COMMITTED 下併發會算到同一個 max、寫出重複 orderIndex(核心缺陷審查:排序不定、move 失準)。
 * - 3:agent runs 核准 per-(project,user)(本檔 lockAgentApprove)——「查活躍→CAS 起跑」的 check-then-set,
 *   兩份不同的待核准計畫被同時核准會雙雙起跑(單併發守門失效);上鎖後同人同專案核准全序列化。
 *   ＋workflow 起跑 per-(project,user)(routers/workflows.ts 內聯,同 project:user 鍵)——同 class 同鍵形狀,
 *   彼此互斥序列化(同人同專案的「核准代理」與「起跑工作流」不會交錯),屬無害的刻意共用、非撞號。
 * - 4:database row-cap per-table(本檔)——addDataRowValidated 的「count(*)→insert」read-modify-write,
 *   併發寫入近上限時兩者都讀到同一 count 而雙雙插入、突破 MAX_ROWS_PER_TABLE。
 * - 5:export job 去重 per-(project,assetKey)(本檔 lockExportDedup)——「查進行中 job→無則建」的 check-then-insert,
 *   雙擊/併發下兩者都讀到「無進行中」而各插一筆,產出兩份相同交付包(export-job-dedup-not-atomic);
 *   上鎖後同專案同素材選擇的建 job 全序列化。
 * - 6:file quota per-user(本檔 lockFileQuota)——「查已用→insert data_files」的 read-modify-write,
 *   併發上傳可同時讀到「還夠」而雙雙插入、突破每人配額(B9 TOCTOU)。
 * - 7:MCP token cap per-user(本檔 lockMcpTokenCap)——「count active→insert」check-then-insert,
 *   併發建立可突破 MCP_TOKEN_MAX_PER_USER。
 * 交易結束自動釋放,呼叫端必須在 db.transaction 內使用。
 */
import { sql } from "drizzle-orm";

/** 交易執行器的最小形狀(db 或 tx 都符合) */
type Executor = { execute: (query: ReturnType<typeof sql>) => Promise<unknown> };

/** 序列化同一專案的分鏡順序寫入(建格/移動/重排);不同專案不互卡 */
export async function lockSceneOrder(tx: Executor, projectId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${projectId}), 2)`);
}

/** 序列化同人同專案的 AI 代理核准(agents.approve):防兩份不同計畫同時核准雙雙起跑 */
export async function lockAgentApprove(tx: Executor, projectId: string, userId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${projectId}:${userId}`}), 3)`);
}

/** 序列化同一資料表的列數上限檢查(addDataRowValidated 的 count→insert):防併發插入突破 MAX_ROWS_PER_TABLE */
export async function lockDatabaseRowCap(tx: Executor, tableId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${tableId}), 4)`);
}

/** 序列化同專案同素材選擇的匯出 job 建立(exportJobs.create 的「查進行中→無則建」):防雙擊產出兩份相同交付包 */
export async function lockExportDedup(tx: Executor, projectId: string, assetKey: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${projectId}:${assetKey}`}), 5)`);
}

/** 序列化同一使用者的文件配額檢查＋寫入(data_files insert/擴大):防併發上傳突破配額 */
export async function lockFileQuota(tx: Executor, userId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}), 6)`);
}

/** 序列化同一使用者的 MCP 金鑰建立(count→insert):防併發突破 MCP_TOKEN_MAX_PER_USER */
export async function lockMcpTokenCap(tx: Executor, userId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}), 7)`);
}
