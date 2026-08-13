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
    .replace(/[「」『』【】\[\]()（）"'""'']/g, "")
    .replace(/\s+/g, "");
}

export function selectedDatabaseIds(pageContext?: AssistantWirePageContext, selectedTableId?: string): string[] {
  const ids: string[] = [];
  const push = (id?: string) => {
    if (id && UUID_RE.test(id) && !ids.includes(id)) ids.push(id);
  };
  push(selectedTableId);
  if (pageContext?.entityType === "database") push(pageContext.entityId);
  if (pageContext?.pageType === "database") {
    for (const id of pageContext.selectedEntityIds ?? []) push(id);
  }
  return ids;
}

export function isSelectedTablePhrase(value: string): boolean {
  return SELECTED_RE.test(value.trim());
}

function parseOrdinal(value: string): number | null {
  const match = value.match(ORDINAL_RE);
  if (!match) return null;
  const raw = match[1] ?? "";
  if (/^\d+$/.test(raw)) return Number(raw);
  return CN_ORDINAL[raw] ?? null;
}

function toResolved(item: McpDatabaseListItem): ResolvedDatabaseTable {
  return {
    tableId: item.tableId,
    name: item.name,
    fields: item.fields,
    rowCount: item.rowCount,
    canWriteRows: item.canWriteRows,
    agentAccess: item.agentAccess,
    boundToProject: item.boundToProject,
    linkedToProject: item.linkedToProject,
  };
}

function scoreName(query: string, name: string): number {
  const needle = normalizeDatabaseName(query);
  const hay = normalizeDatabaseName(name);
  if (!needle || !hay) return 0;
  if (hay === needle) return 1;
  if (hay.includes(needle) || needle.includes(hay)) return 0.86;
  return lexicalOverlap(query, name);
}

/**
 * Put the page-selected database first so ASK/ACT on /databases reads the
 * table the user is looking at. Unknown / unreadable ids are ignored.
 */
export function prioritizeAssistantDatabases<T extends { id: string }>(
  databases: readonly T[],
  pageContext?: AssistantWirePageContext,
  selectedTableId?: string,
): T[] {
  if (!databases.length) return [];
  const selectedIds = selectedDatabaseIds(pageContext, selectedTableId);
  if (!selectedIds.length) return [...databases];
  const rank = new Map(selectedIds.map((id, index) => [id, index]));
  return [...databases].sort((left, right) => {
    const leftRank = rank.has(left.id) ? rank.get(left.id)! : Number.POSITIVE_INFINITY;
    const rightRank = rank.has(right.id) ? rank.get(right.id)! : Number.POSITIVE_INFINITY;
    return leftRank - rightRank;
  });
}

export async function resolveAuthorizedDatabase(
  auth: AuthState,
  hint: DatabaseResolveHint = {},
): Promise<DatabaseResolveOutcome> {
  const listed = await listMcpDatabases(auth, {
    projectId: hint.projectId,
    linkedOnly: hint.linkedOnly === true || hint.preferProjectBound === true,
  });
  const authorized = listed.map(toResolved);
  const byId = new Map(authorized.map((table) => [table.tableId, table]));

  const explicitId = hint.tableId && UUID_RE.test(hint.tableId) ? hint.tableId : undefined;
  if (explicitId) {
    const hit = byId.get(explicitId);
    return hit
      ? { status: "resolved", table: hit, reason: "explicit_id" }
      : { status: "not_found", message: "找不到這個資料庫" };
  }

  const raw = (hint.table ?? hint.tableRef ?? "").trim();
  if (raw && UUID_RE.test(raw)) {
    const hit = byId.get(raw);
    return hit
      ? { status: "resolved", table: hit, reason: "explicit_id" }
      : { status: "not_found", message: "找不到這個資料庫" };
  }

  if (raw && DB_REF_RE.test(raw)) {
    const index = Number(raw.replace(/^db/i, "")) - 1;
    const hit = Number.isInteger(index) && index >= 0 ? authorized[index] : undefined;
    return hit
      ? { status: "resolved", table: hit, reason: "explicit_ref" }
      : { status: "not_found", message: "找不到這個資料庫" };
  }

  const selectedIds = selectedDatabaseIds(hint.pageContext, hint.selectedTableId);
  if (!raw || isSelectedTablePhrase(raw)) {
    const selected = selectedIds.map((id) => byId.get(id)).filter((table): table is ResolvedDatabaseTable => !!table);
    if (selected.length === 1) return { status: "resolved", table: selected[0]!, reason: "selected_table" };
    if (selected.length > 1) {
      return { status: "ambiguous", candidates: selected, message: "目前選取了多個資料庫，請指定要哪一張" };
    }
    if (raw && isSelectedTablePhrase(raw)) {
      return { status: "not_found", message: "目前沒有選取的資料表" };
    }
  }

  if (raw && RECENT_TABLE_RE.test(raw)) {
    const recentId = hint.recent?.[0]?.tableId;
    const hit = recentId ? byId.get(recentId) : undefined;
    return hit
      ? { status: "resolved", table: hit, reason: "recent_table" }
      : { status: "not_found", message: "沒有可對應的剛剛那個資料庫" };
  }

  if (!raw || PROJECT_DATA_RE.test(raw) || hint.preferProjectBound) {
    const projectHits = authorized.filter((table) => table.boundToProject || table.linkedToProject);
    if (projectHits.length === 1) return { status: "resolved", table: projectHits[0]!, reason: "project_bound" };
    if (projectHits.length > 1 && (hint.preferProjectBound || (raw && PROJECT_DATA_RE.test(raw)))) {
      return {
        status: "ambiguous",
        candidates: projectHits.slice(0, 8),
        message: "這個專案有多個資料庫，請指定要哪一張",
      };
    }
    if (raw && PROJECT_DATA_RE.test(raw) && projectHits.length === 0) {
      return { status: "not_found", message: "這個專案沒有可讀的資料庫" };
    }
  }

  if (!raw) {
    if (authorized.length === 1) return { status: "resolved", table: authorized[0]!, reason: "single_visible" };
    if (!authorized.length) return { status: "not_found", message: "目前沒有可讀的資料庫" };
    return { status: "ambiguous", candidates: authorized.slice(0, 8), message: "請指定要查哪一個資料庫" };
  }

  const ordinal = parseOrdinal(raw);
  if (ordinal != null) {
    const hit = authorized[ordinal - 1];
    return hit
      ? { status: "resolved", table: hit, reason: "ordinal" }
      : { status: "not_found", message: "找不到這個資料庫" };
  }

  const exact = authorized.filter((table) => normalizeDatabaseName(table.name) === normalizeDatabaseName(raw));
  if (exact.length === 1) return { status: "resolved", table: exact[0]!, reason: "exact_name" };
  if (exact.length > 1) {
    return { status: "ambiguous", candidates: exact, message: `有多個叫「${raw}」的資料庫，請指定要哪一張` };
  }

  const ranked = authorized
    .map((table) => ({ table, score: scoreName(raw, table.name) }))
    .filter((item) => item.score >= 0.6)
    .sort((left, right) => right.score - left.score);
  if (ranked.length === 1) return { status: "resolved", table: ranked[0]!.table, reason: "lexical_match" };
  if (ranked.length > 1 && ranked[0]!.score - ranked[1]!.score < 0.12) {
    return {
      status: "ambiguous",
      candidates: ranked.slice(0, 8).map((item) => item.table),
      message: `「${raw}」對應到多個資料庫，請指定要哪一張`,
    };
  }
  if (ranked[0]) return { status: "resolved", table: ranked[0].table, reason: "lexical_match" };

  const recentHit = hint.recent?.map((item) => byId.get(item.tableId)).find((table): table is ResolvedDatabaseTable => !!table);
  if (recentHit && scoreName(raw, recentHit.name) >= 0.4) {
    return { status: "resolved", table: recentHit, reason: "recent_table" };
  }

  return { status: "not_found", message: "找不到這個資料庫" };
}

export function resolveDatabaseFieldValues(
  fields: readonly Pick<DataField, "key" | "label" | "type" | "options">[],
  values: Record<string, unknown>,
): FieldResolveOutcome {
  const knownKeys = new Set(fields.map((field) => field.key));
  const byLabel = new Map<string, typeof fields[number][]>();
  for (const field of fields) {
    const label = normalizeDatabaseName(field.label);
    byLabel.set(label, [...(byLabel.get(label) ?? []), field]);
  }

  const data: Record<string, unknown> = {};
  const unknown: string[] = [];
  const ambiguous: Array<{ input: string; candidates: Array<{ key: string; label: string }> }> = [];

  for (const [rawKey, rawVal] of Object.entries(values)) {
    const trimmed = rawKey.trim();
    if (!trimmed) continue;
    let field = knownKeys.has(trimmed) ? fields.find((item) => item.key === trimmed) : undefined;
    if (!field) {
      const matches = byLabel.get(normalizeDatabaseName(trimmed)) ?? [];
      if (matches.length > 1) {
        ambiguous.push({
          input: trimmed,
          candidates: matches.map((item) => ({ key: item.key, label: item.label })),
        });
        continue;
      }
      field = matches[0];
    }
    if (!field) {
      unknown.push(trimmed);
      continue;
    }
    data[field.key] = coerceDatabaseFieldValue(field, rawVal);
  }

  if (unknown.length) {
    return {
      status: "unknown_fields",
      unknown,
      known: fields.map((field) => ({ key: field.key, label: field.label })),
    };
  }
  if (ambiguous.length) return { status: "ambiguous_fields", ambiguous };
  return { status: "resolved", data };
}

export function coerceDatabaseFieldValue(
  field: Pick<DataField, "type" | "options" | "label">,
  raw: unknown,
): unknown {
  if (raw === undefined || raw === null || raw === "") return raw;
  if (field.type === "number" && typeof raw === "string") {
    const trimmed = raw.trim();
    return /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(trimmed) ? Number(trimmed) : raw;
  }
  if (field.type === "checkbox") {
    const coerced = coerceBoolean(raw);
    return coerced === null ? raw : coerced;
  }
  if (field.type === "select" && typeof raw === "string") {
    const matched = (field.options ?? []).find((option) => option.trim() === raw.trim());
    return matched?.trim() ?? raw;
  }
  return raw;
}

/**
 * LLM proposal sanitizer: drop unknown keys so a hallucinated column cannot
 * invent schema on a confirmation card. Agent writes must use the strict
 * resolver above instead — silent discard is not allowed on the execute path.
 */
export function mapLabeledDatabaseRowValues(
  fields: readonly Pick<DataField, "key" | "label">[],
  values: Record<string, string>,
): Record<string, string> {
  const keyByLabel = new Map(fields.map((field) => [field.label, field.key]));
  const knownKeys = new Set(fields.map((field) => field.key));
  const data: Record<string, string> = {};
  for (const [rawKey, rawVal] of Object.entries(values)) {
    const key = knownKeys.has(rawKey) ? rawKey : keyByLabel.get(rawKey);
    if (!key) continue;
    const val = String(rawVal).trim();
    if (!val) continue;
    data[key] = val;
  }
  return data;
}

export function resolveRecentDatabaseRow(
  recent: readonly DatabaseRecentRef[] | undefined,
  phrase: string,
): RecentRowResolveOutcome {
  const latest = recent?.[0];
  if (!latest?.rowIds.length) return { status: "not_found", message: "沒有可對應的剛剛那一筆" };
  const ordinalMatch = phrase.match(/第\s*([一二三四五六七八九十\d]+)\s*筆/);
  if (ordinalMatch) {
    const raw = ordinalMatch[1] ?? "";
    const index = (/^\d+$/.test(raw) ? Number(raw) : CN_ORDINAL[raw] ?? 0) - 1;
    const rowId = latest.rowIds[index];
    return rowId
      ? { status: "resolved", tableId: latest.tableId, rowId, reason: "recent_ordinal" }
      : { status: "not_found", message: "找不到剛剛結果裡的那一筆" };
  }
  if (/(?:那些|這幾筆|剛才找到的)/.test(phrase) && latest.rowIds.length > 1) {
    return {
      status: "ambiguous",
      tableId: latest.tableId,
      rowIds: latest.rowIds,
      message: "剛剛找到多筆，請指定要改哪一筆",
    };
  }
  if (latest.rowIds.length === 1 || /剛剛(?:新增)?那[筆一]|剛才那[筆一]/.test(phrase)) {
    return { status: "resolved", tableId: latest.tableId, rowId: latest.rowIds[0]!, reason: "recent_row" };
  }
  return {
    status: "ambiguous",
    tableId: latest.tableId,
    rowIds: latest.rowIds,
    message: "剛剛找到多筆，請指定要改哪一筆",
  };
}

export function canonicalRowValuesEqual(
  actual: DataRowData | Record<string, unknown> | null | undefined,
  expected: Record<string, unknown>,
): boolean {
  if (!actual || typeof actual !== "object") return false;
  for (const [key, value] of Object.entries(expected)) {
    if (!sameRowValue(actual[key] as DataRowValue, value)) return false;
  }
  return true;
}

function sameRowValue(actual: unknown, expected: unknown): boolean {
  if (actual === expected) return true;
  if (typeof actual === "number" && typeof expected === "number") {
    return Number.isFinite(actual) && actual === expected;
  }
  if (actual == null && (expected === null || expected === undefined || expected === "")) return true;
  return String(actual) === String(expected);
}
