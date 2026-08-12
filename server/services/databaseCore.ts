/**
 * 資料庫列寫入的單一路徑（tRPC / MCP / AI 代理 / REST API 共用）：
 * 驗證欄位型別 → 量級保險絲 → 插入 → 觸碰資料庫 updatedAt。
 * ★ 存取權（canWriteRows）由呼叫端各自解析後傳入布林——因為「人」走 resolveTableAccess、
 *   「AI 介面」走 resolveAgentAccess，語義不同；此核心只負責「已授權之後」的驗證與落地，
 *   讓四個入口的驗證與保險絲行為永遠一致（避免各寫各的漂移，審查曾點名的重複風險）。
 */
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { validateRowData, type DataField, type DataRowData } from "../../shared/databaseFields";
import { lockDatabaseRowCap } from "./locks";

export const MAX_ROWS_PER_TABLE = 20_000;
/** 單一 INSERT 的列數；避免超大參數包，同時把 5,000 列匯入壓到最多 10 次 INSERT。 */
export const DATA_ROW_INSERT_CHUNK = 500;

export type DataTableRow = typeof schema.dataTables.$inferSelect;
export type DataRowRow = typeof schema.dataRows.$inferSelect;

export interface PreparedDataRow {
  index: number;
  checked: { ok: true; data: DataRowData } | { ok: false; error: string };
}

export interface DataRowBatchError {
  /** 對應呼叫端 rawRows 的 0-based 索引；匯入端再換成實體 CSV/JSON 行號。 */
  index: number;
  error: string;
}

export interface PlannedDataRowBatch {
  values: Array<{ index: number; data: DataRowData }>;
  attempted: number;
  failed: number;
  skipped: number;
  errors: DataRowBatchError[];
  capacityReached: boolean;
}

export interface AddDataRowsResult extends Omit<PlannedDataRowBatch, "values"> {
  insertedCount: number;
  /** 大量匯入不需要把整批 JSON 再由 Postgres 傳回；僅 returnRows=true 時填入。 */
  rows: DataRowRow[];
}

/** The concrete Drizzle transaction used by callers that need atomic composition. */
export type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** 先在交易／advisory lock 外完成 CPU 驗證，避免鎖住同表的互動式單列寫入。 */
export function prepareDataRowBatch(fields: DataField[], rawRows: unknown[]): PreparedDataRow[] {
  return rawRows.map((rawData, index) => ({
    index,
    checked: validateRowData(fields, rawData),
  }));
}

function rowCapError(): string {
  return `這個資料庫已達 ${MAX_ROWS_PER_TABLE.toLocaleString()} 列上限，請分庫或清理舊資料`;
}

/**
 * 依目前剩餘容量規劃批次。
 * 語意刻意與舊版逐列迴圈一致：
 * - 驗證失敗只記該列，後續仍繼續。
 * - 第一個「合法但已無容量」的列記失敗後停止，後續列算 skipped。
 * - errors 只截顯示數；failed/attempted 仍是完整計數。
 */
export function planPreparedDataRowBatch(
  prepared: PreparedDataRow[],
  availableRows: number,
  errorLimit = 50,
): PlannedDataRowBatch {
  const values: PlannedDataRowBatch["values"] = [];
  const errors: DataRowBatchError[] = [];
  const capacity = Math.max(0, Math.floor(availableRows));
  const maxErrors = Math.max(0, Math.floor(errorLimit));
  let attempted = 0;
  let failed = 0;
  let capacityReached = false;

  const noteError = (error: DataRowBatchError) => {
    failed += 1;
    if (errors.length < maxErrors) errors.push(error);
  };

  for (const item of prepared) {
    attempted += 1;
    if (!item.checked.ok) {
      noteError({ index: item.index, error: item.checked.error });
      continue;
    }
    if (values.length >= capacity) {
      noteError({ index: item.index, error: rowCapError() });
      capacityReached = true;
      break;
    }
    values.push({ index: item.index, data: item.checked.data });
  }

  return {
    values,
    attempted,
    failed,
    skipped: prepared.length - attempted,
    errors,
    capacityReached,
  };
}

function emptyBatchResult(): AddDataRowsResult {
  return {
    insertedCount: 0,
    rows: [],
    attempted: 0,
    failed: 0,
    skipped: 0,
    errors: [],
    capacityReached: false,
  };
}

function allInvalidBatchResult(
  prepared: PreparedDataRow[],
  errorLimit: number,
): AddDataRowsResult {
  const planned = planPreparedDataRowBatch(
    prepared,
    Number.MAX_SAFE_INTEGER,
    errorLimit,
  );
  return {
    insertedCount: 0,
    rows: [],
    attempted: planned.attempted,
    failed: planned.failed,
    skipped: planned.skipped,
    errors: planned.errors,
    capacityReached: planned.capacityReached,
  };
}

async function insertPreparedDataRows(
  tx: DatabaseTransaction,
  table: Pick<DataTableRow, "id">,
  userId: string,
  prepared: PreparedDataRow[],
  options: { errorLimit: number; returnRows: boolean },
): Promise<AddDataRowsResult> {
  // count→整批 insert 在同一 per-table advisory lock 內；同表的單列／批次併發都不會突破列上限。
  await lockDatabaseRowCap(tx, table.id);
  const [{ n }] = await tx
    .select({ n: sql<number>`count(*)` })
    .from(schema.dataRows)
    .where(eq(schema.dataRows.tableId, table.id));

  const currentRows = Number(n);
  if (!Number.isFinite(currentRows) || currentRows < 0) {
    throw new Error("無法確認資料庫目前列數，請稍後再試");
  }
  const planned = planPreparedDataRowBatch(
    prepared,
    MAX_ROWS_PER_TABLE - currentRows,
    options.errorLimit,
  );

  const rows: DataRowRow[] = [];
  for (let offset = 0; offset < planned.values.length; offset += DATA_ROW_INSERT_CHUNK) {
    const chunk = planned.values.slice(offset, offset + DATA_ROW_INSERT_CHUNK);
    const values = chunk.map((item) => ({
      tableId: table.id,
      data: item.data,
      createdBy: userId,
    }));
    if (options.returnRows) {
      const inserted = await tx.insert(schema.dataRows).values(values).returning();
      rows.push(...inserted);
    } else {
      await tx.insert(schema.dataRows).values(values);
    }
  }
  if (planned.values.length > 0) {
    await tx
      .update(schema.dataTables)
      .set({ updatedAt: new Date() })
      .where(eq(schema.dataTables.id, table.id));
  }

  return {
    insertedCount: planned.values.length,
    rows,
    attempted: planned.attempted,
    failed: planned.failed,
    skipped: planned.skipped,
    errors: planned.errors,
    capacityReached: planned.capacityReached,
  };
}

/**
 * Compose a validated batch write into an existing transaction. This is the
 * no-commit-gap boundary used by idempotency records and is also suitable for
 * real PostgreSQL integration/fault-injection tests.
 */
export async function addDataRowsValidatedInTransaction(
  tx: DatabaseTransaction,
  table: Pick<DataTableRow, "id" | "fields">,
  userId: string,
  rawRows: unknown[],
  options: { errorLimit?: number; returnRows?: boolean } = {},
): Promise<AddDataRowsResult> {
  if (rawRows.length === 0) return emptyBatchResult();
  const prepared = prepareDataRowBatch(table.fields as DataField[], rawRows);
  const errorLimit = options.errorLimit ?? 50;
  if (!prepared.some((item) => item.checked.ok)) {
    return allInvalidBatchResult(prepared, errorLimit);
  }
  return insertPreparedDataRows(tx, table, userId, prepared, {
    errorLimit,
    returnRows: options.returnRows ?? false,
  });
}

/**
 * 已授權後批次新增：批外驗證 → 單次交易／鎖／count → 分塊 multi-insert → updatedAt 一次。
 * DB 寫入是原子的；「部分失敗」專指可預期的逐列驗證錯誤，資料庫錯誤不留下半批資料。
 */
export async function addDataRowsValidated(
  table: Pick<DataTableRow, "id" | "fields">,
  userId: string,
  rawRows: unknown[],
  options: { errorLimit?: number; returnRows?: boolean } = {},
): Promise<AddDataRowsResult> {
  if (rawRows.length === 0) return emptyBatchResult();

  const prepared = prepareDataRowBatch(table.fields as DataField[], rawRows);
  const errorLimit = options.errorLimit ?? 50;

  // 全部都是格式錯誤時，舊版也不會進交易；直接回完整逐列結果。
  if (!prepared.some((item) => item.checked.ok)) {
    return allInvalidBatchResult(prepared, errorLimit);
  }

  return db.transaction((tx) => insertPreparedDataRows(tx, table, userId, prepared, {
    errorLimit,
    returnRows: options.returnRows ?? false,
  }));
}

/** 已授權後新增一列：驗證＋保險絲＋插入＋觸碰 updatedAt。錯誤以人話 Error 拋出。 */
export async function addDataRowValidated(
  table: Pick<DataTableRow, "id" | "fields">,
  userId: string,
  rawData: unknown,
  rowId?: string,
): Promise<DataRowRow> {
  // Agent effects persist rowId before executing this function. If the
  // process dies after COMMIT but before its step is marked done, replay
  // returns the committed row rather than consuming another table slot.
  if (rowId) {
    return db.transaction(async (tx) => {
      await lockDatabaseRowCap(tx, table.id);
      const [existing] = await tx
        .select()
        .from(schema.dataRows)
        .where(eq(schema.dataRows.id, rowId));
      if (existing) {
        if (existing.tableId !== table.id || existing.createdBy !== userId) {
          throw new Error("資料列冪等識別碼已被其他資料庫或建立者使用");
        }
        return existing;
      }

      const checked = validateRowData(table.fields as DataField[], rawData);
      if (!checked.ok) throw new Error(checked.error);

      const [{ n }] = await tx
        .select({ n: sql<number>`count(*)` })
        .from(schema.dataRows)
        .where(eq(schema.dataRows.tableId, table.id));
      const currentRows = Number(n);
      if (!Number.isFinite(currentRows) || currentRows < 0) {
        throw new Error("無法確認資料庫目前列數，請稍後再試");
      }
      if (currentRows >= MAX_ROWS_PER_TABLE) throw new Error(rowCapError());

      const [row] = await tx
        .insert(schema.dataRows)
        .values({
          id: rowId,
          tableId: table.id,
          data: checked.data,
          createdBy: userId,
        })
        .returning();
      if (!row) throw new Error("新增資料列失敗");
      await tx
        .update(schema.dataTables)
        .set({ updatedAt: new Date() })
        .where(eq(schema.dataTables.id, table.id));
      return row;
    });
  }

  const checked = validateRowData(table.fields as DataField[], rawData);
  if (!checked.ok) throw new Error(checked.error);
  const [recent] = await db
    .select()
    .from(schema.dataRows)
    .where(and(
      eq(schema.dataRows.tableId, table.id),
      eq(schema.dataRows.createdBy, userId),
      gte(schema.dataRows.createdAt, new Date(Date.now() - 120_000)),
      sql`${schema.dataRows.data} = ${JSON.stringify(checked.data)}::jsonb`,
    ))
    .orderBy(desc(schema.dataRows.createdAt))
    .limit(1);
  if (recent) return recent;

  const result = await addDataRowsValidated(table, userId, [rawData], { errorLimit: 1, returnRows: true });
  if (result.errors[0]) throw new Error(result.errors[0].error);
  const row = result.rows[0];
  if (!row) throw new Error("新增資料列失敗");
  return row;
}

/** 觸碰所屬資料庫 updatedAt（insert／update／delete 共用，list 排序才跟得上） */
async function touchTableUpdatedAt(
  tx: DatabaseTransaction | typeof db,
  tableId: string,
): Promise<void> {
  await tx
    .update(schema.dataTables)
    .set({ updatedAt: new Date() })
    .where(eq(schema.dataTables.id, tableId));
}

/**
 * 已授權後更新一列（整列覆寫）：驗證＋寫入＋觸碰表 updatedAt。
 * 授權（canWriteRows）由呼叫端決定——與 addDataRowValidated 同模式。
 */
export async function updateDataRowValidated(
  table: Pick<DataTableRow, "id" | "fields">,
  rowId: string,
  userId: string,
  rawData: unknown,
): Promise<DataRowRow> {
  const checked = validateRowData(table.fields as DataField[], rawData);
  if (!checked.ok) throw new Error(checked.error);

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.dataRows)
      .where(eq(schema.dataRows.id, rowId));
    if (!existing || existing.tableId !== table.id) {
      throw new Error("找不到這一列");
    }
    const [updated] = await tx
      .update(schema.dataRows)
      .set({ data: checked.data, updatedBy: userId, updatedAt: new Date() })
      .where(eq(schema.dataRows.id, rowId))
      .returning();
    if (!updated) throw new Error("更新資料列失敗");
    await touchTableUpdatedAt(tx, table.id);
    return updated;
  });
}

/**
 * 已授權後刪列＋觸碰表 updatedAt。
 * 授權（建立者或 canManage）由呼叫端決定。
 */
export async function removeDataRow(
  tableId: string,
  rowId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: schema.dataRows.id, tableId: schema.dataRows.tableId })
      .from(schema.dataRows)
      .where(eq(schema.dataRows.id, rowId));
    if (!existing || existing.tableId !== tableId) {
      throw new Error("找不到這一列");
    }
    await tx.delete(schema.dataRows).where(eq(schema.dataRows.id, rowId));
    await touchTableUpdatedAt(tx, tableId);
  });
}
