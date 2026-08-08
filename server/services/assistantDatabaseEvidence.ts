import { and, desc, eq, or, sql } from "drizzle-orm";
import { db, schema } from "../db";
import type { DataField } from "../../shared/databaseFields";
import { lexicalOverlap } from "./intelligenceCore";
import { escapeLikeLiteral } from "./databaseRowSearch";

export interface AssistantReadableDatabase {
  ref: string;
  id: string;
  name: string;
  fields: DataField[];
  rowCount: number;
  canWrite: boolean;
}

export interface AssistantDatabaseEvidenceRow {
  tableId: string;
  tableRef: string;
  tableName: string;
  rowId: string;
  text: string;
  score: number;
}

export const ASSISTANT_DATABASE_EVIDENCE_BUDGET = 12_000;

const QUERY_STOP_WORDS = new Set([
  "ai", "資料", "資料庫", "資料表", "表格", "內容", "目前", "所有", "一下", "請問",
  "幫我", "幫忙", "查詢", "搜尋", "找到", "找出", "告訴", "顯示", "裡面", "其中",
  "what", "which", "show", "find", "search", "database", "table", "data", "please",
]);

/**
 * Extract conservative lookup terms from a natural-language question.
 * Terms are only used inside parameterized ILIKE expressions; they never
 * become SQL identifiers or executable fragments.
 */
export function assistantDatabaseQueryTerms(query: string, maxTerms = 8): string[] {
  const normalized = query.normalize("NFKC").toLocaleLowerCase("zh-TW").replace(/\0/g, " ");
  const terms: string[] = [];
  const push = (value: string) => {
    const term = value.trim();
    if (term.length < 2 || QUERY_STOP_WORDS.has(term) || terms.includes(term)) return;
    terms.push(term.slice(0, 40));
  };
  for (const token of normalized.match(/[a-z0-9][a-z0-9_.@-]{1,}/g) ?? []) push(token);
  for (const run of normalized.match(/[\u3400-\u9fff]{2,}/g) ?? []) {
    const cleaned = run
      .replace(/^(?:請問|麻煩|幫我|幫忙|查詢|搜尋|找到|找出|告訴我|顯示)/, "")
      .replace(/(?:的資料|的內容|資料庫|資料表|表格|裡面|目前|所有|一下)$/g, "");
    if (cleaned.length <= 4) push(cleaned);
    for (let index = 0; index < cleaned.length - 1; index += 1) {
      const pair = cleaned.slice(index, index + 2);
      if (/[的了是在有與和及請問]/.test(pair)) continue;
      push(pair);
    }
  }
  return terms.slice(0, Math.max(1, maxTerms));
}

function rowText(fields: DataField[], data: Record<string, unknown>): string {
  return fields.slice(0, 30).flatMap((field) => {
    const value = data[field.key];
    if (value === null || value === undefined || value === "") return [];
    const rendered = typeof value === "object" ? JSON.stringify(value) : String(value);
    return [`${field.label}: ${rendered.slice(0, 500)}`];
  }).join(" | ") || "（空白資料列）";
}

/**
 * Eagerly retrieves row evidence before the LLM is called. This closes the
 * reliability gap where a model had to guess that it should call
 * query_database before it could know a matching row existed.
 */
export async function retrieveAssistantDatabaseEvidence(
  databases: readonly AssistantReadableDatabase[],
  query: string,
  options: { limit?: number; candidateLimit?: number; budgetChars?: number } = {},
): Promise<AssistantDatabaseEvidenceRow[]> {
  const terms = assistantDatabaseQueryTerms(query);
  if (!databases.length || !terms.length) return [];
  const tableById = new Map(databases.map((table) => [table.id, table]));
  const patterns = terms.map((term) => `%${escapeLikeLiteral(term)}%`);
  const candidateLimit = Math.min(300, Math.max(20, options.candidateLimit ?? 120));
  // Keep a bounded, relevance-ranked slice from every authorized table. A
  // single busy table must not fill a global updatedAt-first cap and hide an
  // older exact match in another table (or even in the same table).
  const perTableCandidateLimit = Math.min(40, Math.max(
    5,
    Math.ceil(candidateLimit / Math.min(8, databases.length)),
  ));
  const rows = (await Promise.all(databases.map(async (table) => {
    const relevance = sql<number>`(${sql.join(terms.map((term, index) => (
      sql`case when ${schema.dataRows.data}::text ilike ${patterns[index]!} escape ${"\\"} then ${Math.min(40, term.length)} else 0 end`
    )), sql` + `)})`;
    return db.select({
      id: schema.dataRows.id,
      tableId: schema.dataRows.tableId,
      data: schema.dataRows.data,
      updatedAt: schema.dataRows.updatedAt,
    }).from(schema.dataRows).where(and(
      eq(schema.dataRows.tableId, table.id),
      or(...patterns.map((pattern) => sql`${schema.dataRows.data}::text ilike ${pattern} escape ${"\\"}`)),
    )).orderBy(desc(relevance), desc(schema.dataRows.updatedAt)).limit(perTableCandidateLimit);
  }))).flat();

  const candidates = rows.flatMap((row) => {
    const table = tableById.get(row.tableId);
    if (!table) return [];
    const text = rowText(table.fields, row.data as Record<string, unknown>);
    const lower = text.normalize("NFKC").toLocaleLowerCase("zh-TW");
    const termHits = terms.filter((term) => lower.includes(term)).length / terms.length;
    const score = Math.max(termHits, lexicalOverlap(query, `${table.name} ${text}`));
    return [{
      tableId: table.id,
      tableRef: table.ref,
      tableName: table.name,
      rowId: row.id,
      text,
      score: Number(score.toFixed(4)),
    }];
  }).sort((left, right) => right.score - left.score);

  const selected: AssistantDatabaseEvidenceRow[] = [];
  const perTable = new Map<string, number>();
  const budget = Math.min(30_000, Math.max(1_000, options.budgetChars ?? ASSISTANT_DATABASE_EVIDENCE_BUDGET));
  let used = 0;
  for (const candidate of candidates) {
    if (selected.length >= Math.min(40, Math.max(1, options.limit ?? 16))) break;
    if ((perTable.get(candidate.tableId) ?? 0) >= 5) continue;
    const remaining = budget - used;
    if (remaining <= 0) break;
    const text = candidate.text.slice(0, remaining);
    if (!text) break;
    selected.push({ ...candidate, text });
    perTable.set(candidate.tableId, (perTable.get(candidate.tableId) ?? 0) + 1);
    used += text.length;
  }
  return selected;
}

export function formatAssistantDatabaseEvidence(rows: readonly AssistantDatabaseEvidenceRow[]): string {
  if (!rows.length) return "";
  return rows.map((row, index) => (
    `[資料庫來源 ${index + 1}｜${row.tableRef} ${row.tableName}｜row ${row.rowId}｜score ${row.score}]\n${row.text}`
  )).join("\n\n");
}
