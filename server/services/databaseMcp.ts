/**
 * MCP 自訂資料庫工具的業務層（Zeabur 友善）：
 * - 權限一律 resolveAgentAccess（與 tRPC／REST 同口徑，只會更嚴）
 * - 列表可依 projectId 標註／過濾「關聯本專案」
 * - 查詢支援 offset、欄位等值篩、回傳截斷（省 token／記憶體）
 * - 加列可預填 project 型欄位
 * - 文件列表不灌 textContent 全文、不回傳 sourceUrl（防 token／內網 URL 外洩）
 *
 * mcp.ts 只做 JSON-RPC 編排；本檔可單元測試、不碰 #133 plan/runner。
 */
import { and, desc, eq, isNull, or, sql, type SQL } from "drizzle-orm";
import { db, schema } from "../db";
import type { AuthState } from "./auth";
import {
  listVisibleTables,
  resolveAgentAccess,
  type DataTableRow,
  type DbAccess,
} from "./databaseAcl";
import { findProjectLinkedRows } from "./databaseProjectLinks";
import {
  escapeLikeLiteral,
  normalizeDatabaseSearchKeyword,
} from "./databaseRowSearch";
import { mediaKindOf } from "./databaseMedia";
import type { DataField, DataRowData } from "../../shared/databaseFields";

export const MCP_DB_QUERY_LIMIT_DEFAULT = 50;
export const MCP_DB_QUERY_LIMIT_MAX = 200;
export const MCP_DB_QUERY_OFFSET_MAX = 20_000;
/** MCP 回傳單格字串上限，避免 jsonb 長文灌爆外部模型上下文 */
export const MCP_DB_CELL_MAX = 200;
export const MCP_DB_FILE_LIST_LIMIT = 100;
export const MCP_DB_FILE_KEYWORD_LIMIT = 80;
export const MCP_DB_AI_DESCRIPTION_MAX = 300;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AgentReadableTable = {
  table: DataTableRow;
  access: DbAccess;
};

/** 無讀取權／不存在一律 null（呼叫端變 NOT_FOUND，不洩漏存在性） */
export async function getAgentReadableTable(
  auth: AuthState,
  tableId: string,
): Promise<AgentReadableTable | null> {
  if (!UUID_RE.test(tableId)) return null;
  const [table] = await db
    .select()
    .from(schema.dataTables)
    .where(and(eq(schema.dataTables.id, tableId), isNull(schema.dataTables.deletedAt)));
  if (!table) return null;
  const access = resolveAgentAccess(auth, table);
  if (!access.canRead) return null;
  return { table, access };
}

function projectFieldKeys(fields: DataField[]): string[] {
  return fields.filter((f) => f.type === "project").map((f) => f.key);
}

export function hasProjectLinkField(fields: unknown): boolean {
  return Array.isArray(fields) && (fields as DataField[]).some((f) => f?.type === "project");
}

/** 把外部模型／工具給的 data 與專案 id 合併：表上每個 project 欄若缺值則預填 */
export function mergeProjectIntoRowData(
  fields: DataField[],
  rawData: unknown,
  projectId: string | undefined | null,
): unknown {
  if (!projectId || !UUID_RE.test(projectId)) return rawData;
  const base =
    rawData != null && typeof rawData === "object" && !Array.isArray(rawData)
      ? { ...(rawData as Record<string, unknown>) }
      : {};
  for (const key of projectFieldKeys(fields)) {
    const cur = base[key];
    if (cur === undefined || cur === null || cur === "") base[key] = projectId;
  }
  return base;
}

export function clampMcpLimit(raw: unknown, fallback = MCP_DB_QUERY_LIMIT_DEFAULT): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), 1), MCP_DB_QUERY_LIMIT_MAX);
}

export function clampMcpOffset(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  return Math.min(Math.max(Math.trunc(n), 0), MCP_DB_QUERY_OFFSET_MAX);
}

/** 截斷列資料字串欄，縮 MCP 回應體積（數字／布林不動） */
export function compactRowDataForMcp(data: unknown, maxLen = MCP_DB_CELL_MAX): DataRowData {
  if (data == null || typeof data !== "object" || Array.isArray(data)) return {};
  const out: DataRowData = {};
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    if (typeof v === "string" && v.length > maxLen) {
      out[k] = `${v.slice(0, maxLen)}…`;
    } else if (typeof v === "string" || typeof v === "number" || typeof v === "boolean" || v === null) {
      out[k] = v;
    } else {
      out[k] = String(v).slice(0, maxLen);
    }
  }
  return out;
}

export type McpDatabaseListItem = {
  tableId: string;
  name: string;
  scope: string;
  description: string | null;
  fields: DataField[];
  rowCount: number;
  canWriteRows: boolean;
  /** none/read/write——外部模型可判斷能不能寫 */
  agentAccess: "none" | "read" | "write";
  /** 欄位定義是否含 project 型（可關聯專案） */
  hasProjectLink: boolean;
  /** 若呼叫帶 projectId：此表是否有列關聯該專案 */
  linkedToProject?: boolean;
  linkedRowCount?: number;
};

/**
 * 列出 AI 可讀庫；可選 projectId：
 * - 標註 linkedToProject / linkedRowCount
 * - linkedOnly=true 時只回有關聯列的表（專案燃料視角）
 */
export async function listMcpDatabases(
  auth: AuthState,
  opts: { projectId?: string; linkedOnly?: boolean } = {},
): Promise<McpDatabaseListItem[]> {
  const tables = await listVisibleTables(auth);
  const readable = tables
    .map((t) => ({ t, access: resolveAgentAccess(auth, t) }))
    .filter((x) => x.access.canRead);

  let linkedCountByTable = new Map<string, number>();
  const projectId = opts.projectId && UUID_RE.test(opts.projectId) ? opts.projectId : undefined;
  if (projectId) {
    const targets = readable
      .map(({ t }) => ({
        tableId: t.id,
        fieldKeys: projectFieldKeys(t.fields as DataField[]),
      }))
      .filter((x) => x.fieldKeys.length > 0);
    if (targets.length) {
      const rows = await findProjectLinkedRows(projectId, targets);
      linkedCountByTable = new Map<string, number>();
      for (const r of rows) {
        linkedCountByTable.set(r.tableId, (linkedCountByTable.get(r.tableId) ?? 0) + 1);
      }
    }
  }

  const out: McpDatabaseListItem[] = [];
  for (const { t, access } of readable) {
    const linkedRowCount = projectId ? (linkedCountByTable.get(t.id) ?? 0) : undefined;
    const linkedToProject = projectId ? linkedRowCount! > 0 : undefined;
    if (opts.linkedOnly && projectId && !linkedToProject) continue;
    out.push({
      tableId: t.id,
      name: t.name,
      scope: t.scope,
      description: t.description,
      fields: t.fields as DataField[],
      rowCount: t.rowCount,
      canWriteRows: access.canWriteRows,
      agentAccess: (t.agentAccess as "none" | "read" | "write") ?? "write",
      hasProjectLink: hasProjectLinkField(t.fields),
      ...(projectId
        ? { linkedToProject: !!linkedToProject, linkedRowCount: linkedRowCount ?? 0 }
        : {}),
    });
  }
  // 有專案上下文時：已關聯的排前面，方便外部模型先讀燃料
  if (projectId) {
    out.sort((a, b) => Number(b.linkedToProject) - Number(a.linkedToProject) || b.rowCount - a.rowCount);
  }
  return out;
}

export type McpQueryResult = {
  table: string;
  tableId: string;
  fields?: DataField[];
  keyword: string;
  limit: number;
  offset: number;
  returned: number;
  hasMore: boolean;
  rows: Array<{ id: string; data: DataRowData; updatedAt: Date }>;
};

/**
 * 查列：keyword 全文粗篩 + 可選欄位等值（data->>key）+ offset 分頁 + 儲存格截斷。
 * 多取 1 列判斷 hasMore，不另跑 count(*)（省 Zeabur PG CPU）。
 */
export async function queryMcpDatabase(
  table: DataTableRow,
  opts: {
    keyword?: string;
    limit?: unknown;
    offset?: unknown;
    /** 欄位 key → 等值（字串化比對 jsonb ->>） */
    equals?: Record<string, string>;
    includeFields?: boolean;
  } = {},
): Promise<McpQueryResult> {
  const keyword = normalizeDatabaseSearchKeyword(opts.keyword ?? "");
  const limit = clampMcpLimit(opts.limit);
  const offset = clampMcpOffset(opts.offset);
  const conds: SQL[] = [eq(schema.dataRows.tableId, table.id)];
  if (keyword) {
    conds.push(
      sql`${schema.dataRows.data}::text ilike ${`%${escapeLikeLiteral(keyword)}%`} escape ${"\\"}`,
    );
  }
  if (opts.equals && typeof opts.equals === "object") {
    const fields = table.fields as DataField[];
    const allowed = new Set(fields.map((f) => f.key));
    for (const [key, value] of Object.entries(opts.equals)) {
      if (!allowed.has(key)) continue;
      if (typeof value !== "string") continue;
      // 參數化 ->> 比對，避免注入
      conds.push(sql`${schema.dataRows.data} ->> ${key} = ${value}`);
    }
  }

  const rows = await db
    .select({
      id: schema.dataRows.id,
      data: schema.dataRows.data,
      updatedAt: schema.dataRows.updatedAt,
    })
    .from(schema.dataRows)
    .where(and(...conds))
    .orderBy(desc(schema.dataRows.createdAt))
    .limit(limit + 1)
    .offset(offset);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  return {
    table: table.name,
    tableId: table.id,
    ...(opts.includeFields !== false ? { fields: table.fields as DataField[] } : {}),
    keyword,
    limit,
    offset,
    returned: page.length,
    hasMore,
    rows: page.map((r) => ({
      id: r.id,
      data: compactRowDataForMcp(r.data),
      updatedAt: r.updatedAt,
    })),
  };
}

export type McpFileListItem = {
  fileId: string;
  name: string;
  mime: string;
  kind: string;
  sizeBytes: number;
  readableChars: number;
  category: string | null;
  aiDescription: string | null;
  snippet?: string;
};

/** 文件列表：SQL 投影字數／snippet，不回 sourceUrl */
export async function listMcpDatabaseFiles(
  table: DataTableRow,
  opts: { keyword?: string; category?: string; limit?: unknown } = {},
): Promise<McpFileListItem[]> {
  const keyword = normalizeDatabaseSearchKeyword(opts.keyword ?? "", MCP_DB_FILE_KEYWORD_LIMIT);
  const keywordLower = keyword.toLowerCase();
  const categoryFilter = (opts.category ?? "").trim().slice(0, 30);
  const limit = Math.min(
    Math.max(Number.isFinite(Number(opts.limit)) ? Math.trunc(Number(opts.limit)) : MCP_DB_FILE_LIST_LIMIT, 1),
    MCP_DB_FILE_LIST_LIMIT,
  );

  const conds: SQL[] = [eq(schema.dataFiles.tableId, table.id)];
  if (categoryFilter) conds.push(eq(schema.dataFiles.category, categoryFilter));
  if (keyword) {
    const like = `%${escapeLikeLiteral(keyword)}%`;
    conds.push(
      or(
        sql`${schema.dataFiles.name} ilike ${like} escape ${"\\"}`,
        sql`coalesce(${schema.dataFiles.category}, '') ilike ${like} escape ${"\\"}`,
        sql`coalesce(${schema.dataFiles.aiDescription}, '') ilike ${like} escape ${"\\"}`,
        sql`coalesce(${schema.dataFiles.textContent}, '') ilike ${like} escape ${"\\"}`,
      )!,
    );
  }

  const snippetExpr = keyword
    ? sql<string | null>`case
        when position(lower(${keywordLower}) in lower(coalesce(${schema.dataFiles.textContent}, ''))) > 0
        then substr(
          ${schema.dataFiles.textContent},
          greatest(1, position(lower(${keywordLower}) in lower(${schema.dataFiles.textContent})) - 80),
          200
        )
        else null
      end`
    : sql<string | null>`null`;

  const files = await db
    .select({
      id: schema.dataFiles.id,
      name: schema.dataFiles.name,
      mime: schema.dataFiles.mime,
      sizeBytes: schema.dataFiles.sizeBytes,
      category: schema.dataFiles.category,
      aiDescription: schema.dataFiles.aiDescription,
      readableChars: sql<number>`coalesce(length(${schema.dataFiles.textContent}), 0)`,
      snippet: snippetExpr,
    })
    .from(schema.dataFiles)
    .where(and(...conds))
    .orderBy(desc(schema.dataFiles.createdAt))
    .limit(limit);

  return files.map((f) => ({
    fileId: f.id,
    name: f.name,
    mime: f.mime,
    kind: mediaKindOf(f.mime),
    sizeBytes: f.sizeBytes,
    readableChars: Number(f.readableChars) || 0,
    category: f.category,
    aiDescription: f.aiDescription ? f.aiDescription.slice(0, MCP_DB_AI_DESCRIPTION_MAX) : null,
    ...(f.snippet ? { snippet: f.snippet } : {}),
  }));
}
