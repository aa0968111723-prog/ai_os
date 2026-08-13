/**
 * Natural-language → authorized database/table/field/row resolver.
 *
 * Page context and client-supplied ids are hints, never authorization.
 * Unauthorized and missing tables collapse to the same not_found outcome
 * so the model cannot probe tenant boundaries.
 */
import type { AssistantWirePageContext } from "../../shared/assistantPageContext";
import {
  coerceBoolean,
  type DataField,
  type DataRowData,
  type DataRowValue,
} from "../../shared/databaseFields";
import { lexicalOverlap } from "./intelligenceCore";
import {
  listMcpDatabases,
  type McpDatabaseListItem,
} from "./databaseMcp";
import type { AuthState } from "./auth";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DB_REF_RE = /^db(?:focus)?(\d+)?$/i;
const ORDINAL_RE = /第\s*([一二三四五六七八九十百\d]+)\s*(?:個|張)?\s*(?:資料庫|資料表|表)/;
const SELECTED_RE = /^(?:這張表|這一張|目前資料表|目前這張|這個資料庫|這張資料庫|這裡|這裡呢|這張)$/;
const RECENT_TABLE_RE = /剛剛那個資料庫|剛才那個資料庫|剛剛那張|剛才那張|剛剛那個/;
const PROJECT_DATA_RE = /這個專案的資料|這個專案|本專案資料|專案裡的資料/;

const CN_ORDINAL: Record<string, number> = {
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
};

export type DatabaseRecentRef = {
  tableId: string;
  tableName: string;
  rowIds: string[];
  query?: string;
  timestamp: string;
};

export type DatabaseResolveHint = {
  tableId?: string;
  tableRef?: string;
  table?: string;
  selectedTableId?: string;
  pageContext?: AssistantWirePageContext;
  projectId?: string;
  linkedOnly?: boolean;
  recent?: readonly DatabaseRecentRef[];
  preferProjectBound?: boolean;
};

export type ResolvedDatabaseTable = {
  tableId: string;
  name: string;
  fields: DataField[];
  rowCount: number;
  canWriteRows: boolean;
  agentAccess: "none" | "read" | "write";
  boundToProject?: boolean;
  linkedToProject?: boolean;
};

export type DatabaseResolveOutcome =
  | { status: "resolved"; table: ResolvedDatabaseTable; reason: string }
  | { status: "ambiguous"; candidates: ResolvedDatabaseTable[]; message: string }
  | { status: "not_found"; message: string };

export type FieldResolveOutcome =
  | { status: "resolved"; data: Record<string, unknown> }
  | { status: "unknown_fields"; unknown: string[]; known: Array<{ key: string; label: string }> }
  | { status: "ambiguous_fields"; ambiguous: Array<{ input: string; candidates: Array<{ key: string; label: string }> }> };

export type RecentRowResolveOutcome =
  | { status: "resolved"; tableId: string; rowId: string; reason: string }
  | { status: "ambiguous"; rowIds: string[]; tableId: string; message: string }
  | { status: "not_found"; message: string };

export function normalizeDatabaseName(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("zh-TW")
    .replace(/[「」『』【】\[\]()（）"'“”‘’]/g, "")
    .replace(/\s+/g, "");
}
