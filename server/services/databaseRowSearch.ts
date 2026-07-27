/**
 * 專案／團隊 AI 助手的自訂資料庫查詢。
 *
 * 權限不在這裡重新推導：呼叫端必須先把 dbRef 解析成已通過 databaseAcl／agentAccess 的 tableId。
 * 這一層只負責把「完整資料集的關鍵字過濾」放進 PostgreSQL，並在 SQL 端硬性限制回傳列數，
 * 避免舊版先抓最新 100 列再於 Node 篩選，讓第 101 列以後永遠搜尋不到。
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "../db";

/** 提示詞最多只接收 20 列；兩個助手共用同一硬上限。 */
export const ASSISTANT_DATABASE_ROW_LIMIT = 20;
/** LLM 工具 schema 已限制 80 字；服務層再守一次，避免未來其他呼叫端繞過。 */
export const ASSISTANT_DATABASE_KEYWORD_LIMIT = 80;
/** 網頁、REST 與 MCP 的通用資料列搜尋上限；避免超長 pattern 放大 DB CPU/記憶體。 */
export const DATABASE_SEARCH_KEYWORD_LIMIT = 200;

export function normalizeAssistantDatabaseKeyword(raw: string | null | undefined): string {
  return normalizeDatabaseSearchKeyword(raw, ASSISTANT_DATABASE_KEYWORD_LIMIT);
}

export function normalizeDatabaseSearchKeyword(
  raw: string | null | undefined,
  maxLength = DATABASE_SEARCH_KEYWORD_LIMIT,
): string {
  return (raw ?? "").replace(/\0/g, "").trim().slice(0, maxLength);
}

/** LIKE 的 %, _ 與跳脫字元本身都視為使用者要找的文字，不讓它們意外擴張成萬用字元。 */
export function escapeLikeLiteral(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * 匯出 query builder 供回歸測試檢查實際 SQL 形狀；呼叫 `.toSQL()` 不會連線。
 * SQL 順序是不變式：table ACL 已解析出的 tableId + 全庫 ILIKE WHERE → ORDER BY → LIMIT 20。
 */
export function buildAssistantDatabaseRowsQuery(tableId: string, rawKeyword?: string | null) {
  const keyword = normalizeAssistantDatabaseKeyword(rawKeyword);
  const conditions = [eq(schema.dataRows.tableId, tableId)];
  if (keyword) {
    const pattern = `%${escapeLikeLiteral(keyword)}%`;
    conditions.push(sql`${schema.dataRows.data}::text ilike ${pattern} escape ${"\\"}`);
  }
  return db
    .select({ data: schema.dataRows.data })
    .from(schema.dataRows)
    .where(and(...conditions))
    .orderBy(desc(schema.dataRows.createdAt))
    .limit(ASSISTANT_DATABASE_ROW_LIMIT);
}

export async function searchAssistantDatabaseRows(
  tableId: string,
  rawKeyword?: string | null,
): Promise<{ keyword: string; rows: Array<{ data: unknown }> }> {
  const keyword = normalizeAssistantDatabaseKeyword(rawKeyword);
  const rows = await buildAssistantDatabaseRowsQuery(tableId, keyword);
  return { keyword, rows };
}
