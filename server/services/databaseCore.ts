/**
 * 資料庫列寫入的單一路徑（tRPC / MCP / AI 代理 / REST API 共用）：
 * 驗證欄位型別 → 量級保險絲 → 插入 → 觸碰資料庫 updatedAt。
 * ★ 存取權（canWriteRows）由呼叫端各自解析後傳入布林——因為「人」走 resolveTableAccess、
 *   「AI 介面」走 resolveAgentAccess，語義不同；此核心只負責「已授權之後」的驗證與落地，
 *   讓四個入口的驗證與保險絲行為永遠一致（避免各寫各的漂移，審查曾點名的重複風險）。
 */
import { eq, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { validateRowData, type DataField } from "../../shared/databaseFields";
import { lockDatabaseRowCap } from "./locks";

export const MAX_ROWS_PER_TABLE = 20_000;

export type DataTableRow = typeof schema.dataTables.$inferSelect;
export type DataRowRow = typeof schema.dataRows.$inferSelect;

/** 已授權後新增一列：驗證＋保險絲＋插入＋觸碰 updatedAt。錯誤以人話 Error 拋出。 */
export async function addDataRowValidated(
  table: Pick<DataTableRow, "id" | "fields">,
  userId: string,
  rawData: unknown,
): Promise<DataRowRow> {
  const checked = validateRowData(table.fields as DataField[], rawData);
  if (!checked.ok) throw new Error(checked.error);
  // 「count→insert」在交易＋per-table advisory lock 內原子完成：否則併發寫入近上限時兩個請求都讀到
  // 同一 count 而雙雙插入，突破 MAX_ROWS_PER_TABLE（tRPC／MCP／REST／AI 代理都可同時打同一表）。
  // 全程用同一條連線（tx），不向連線池借第二條，無 points.ts 註明的滿池死鎖面。
  return db.transaction(async (tx) => {
    await lockDatabaseRowCap(tx, table.id);
    const [{ n }] = await tx
      .select({ n: sql<number>`count(*)` })
      .from(schema.dataRows)
      .where(eq(schema.dataRows.tableId, table.id));
    if (Number(n) >= MAX_ROWS_PER_TABLE) {
      throw new Error(`這個資料庫已達 ${MAX_ROWS_PER_TABLE.toLocaleString()} 列上限，請分庫或清理舊資料`);
    }
    const [row] = await tx
      .insert(schema.dataRows)
      .values({ tableId: table.id, data: checked.data, createdBy: userId })
      .returning();
    await tx.update(schema.dataTables).set({ updatedAt: new Date() }).where(eq(schema.dataTables.id, table.id));
    return row;
  });
}
