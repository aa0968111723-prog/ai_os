/**
 * pg advisory xact lock 的鍵空間註冊表——classifier 撞號等於鎖失效,集中管理:
 * - 0:points per-user(services/points.ts reserveQuota)
 * - 1:approvals per-scene(routers/approvals.ts submit/decide 序列化)
 * - 2:scenes orderIndex per-project(本檔)——「讀 max→插入/互換/重排」的 read-modify-write
 *   在 READ COMMITTED 下併發會算到同一個 max、寫出重複 orderIndex(核心缺陷審查:排序不定、move 失準)。
 * 交易結束自動釋放,呼叫端必須在 db.transaction 內使用。
 */
import { sql } from "drizzle-orm";

/** 交易執行器的最小形狀(db 或 tx 都符合) */
type Executor = { execute: (query: ReturnType<typeof sql>) => Promise<unknown> };

/** 序列化同一專案的分鏡順序寫入(建格/移動/重排);不同專案不互卡 */
export async function lockSceneOrder(tx: Executor, projectId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${projectId}), 2)`);
}
