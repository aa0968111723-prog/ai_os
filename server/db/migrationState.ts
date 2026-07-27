import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

export const MIGRATIONS_SCHEMA = "drizzle";
export const MIGRATIONS_TABLE = "__drizzle_migrations";
export const MIGRATION_LOCK_KEY = "ai-director-os:schema-migrations:v1";

type Database = NodePgDatabase<Record<string, unknown>>;

interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

interface Journal {
  version: string;
  dialect: string;
  entries: JournalEntry[];
}

export interface MigrationFile {
  idx: number;
  tag: string;
  createdAt: number;
  hash: string;
  sql: string;
  statementCount: number;
}

export interface MigrationManifest {
  directory: string;
  fingerprint: string;
  entries: MigrationFile[];
}

export type MigrationStateKind =
  | "empty-unmigrated"
  | "legacy-untracked"
  | "pending"
  | "ready"
  | "invalid";

export interface MigrationState {
  kind: MigrationStateKind;
  ledgerExists: boolean;
  userTables: string[];
  applied: MigrationFile[];
  pending: MigrationFile[];
  errors: string[];
}

export interface SchemaDrift {
  hasDataLoss: boolean;
  statements: string[];
  warnings: string[];
}

export interface MigrationLedgerRow {
  id: number;
  hash: string;
  created_at: string;
}

/**
 * One-time bridge for databases created by the former runtime pushSchema path.
 *
 * This list is intentionally closed. Once another migration is added, the
 * bridge must be reviewed and updated (or retired); a generic "adopt any
 * prefix" switch could hide unrelated legacy drift behind future DDL.
 */
export const LEGACY_ADOPTION_THROUGH_TAG = "0001_managed_indexes";
export const LEGACY_ADOPTION_PENDING_TAGS = [
  "0002_distributed_rate_limits",
  "0003_idempotency_records",
] as const;

export interface LegacyAdoptionCheck {
  ok: boolean;
  errors: string[];
  throughIndex: number;
  adoptionFingerprint: string;
}

function rowsOf<T>(result: unknown): T[] {
  const rows = (result as { rows?: T[] } | undefined)?.rows;
  return Array.isArray(rows) ? rows : [];
}

/** Canonicalize generated DDL without weakening identifiers or string values. */
export function canonicalMigrationStatement(statement: string): string {
  return statement
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n")
    .trim()
    .replace(/;+\s*$/, "")
    .replace(/\s+/g, " ");
}

function migrationStatements(entry: MigrationFile): string[] {
  return entry.sql
    .split("--> statement-breakpoint")
    .map(canonicalMigrationStatement)
    .filter(Boolean);
}

/**
 * Proves a legacy database is exactly the historical 0001 schema:
 * current-schema drift must be precisely the additive CREATE TABLE/INDEX DDL
 * in the two reviewed bridge migrations—nothing missing, extra, destructive,
 * or warning-producing.
 */
export function verifyLegacyAdoptionBridge(
  manifest: MigrationManifest,
  drift: SchemaDrift,
  throughTag: string,
): LegacyAdoptionCheck {
  const throughIndex = manifest.entries.findIndex((entry) => entry.tag === throughTag);
  const fingerprintPayload = [
    manifest.fingerprint,
    throughTag,
    ...manifest.entries.slice(0, Math.max(0, throughIndex + 1)).map((entry) => entry.hash),
  ].join("\0");
  const adoptionFingerprint = createHash("sha256").update(fingerprintPayload).digest("hex").slice(0, 16);
  const errors: string[] = [];

  if (throughTag !== LEGACY_ADOPTION_THROUGH_TAG || throughIndex < 0) {
    errors.push(`只允許經審核的 legacy bridge：--through=${LEGACY_ADOPTION_THROUGH_TAG}`);
  }
  const pending = throughIndex < 0 ? [] : manifest.entries.slice(throughIndex + 1);
  const pendingTags = pending.map((entry) => entry.tag);
  if (
    pendingTags.length !== LEGACY_ADOPTION_PENDING_TAGS.length
    || pendingTags.some((tag, index) => tag !== LEGACY_ADOPTION_PENDING_TAGS[index])
  ) {
    errors.push(
      `legacy bridge 僅適用 pending=${LEGACY_ADOPTION_PENDING_TAGS.join(",")}；目前為 ${pendingTags.join(",") || "(none)"}`,
    );
  }
  if (drift.hasDataLoss) errors.push("schema drift 被 Drizzle 標記為可能資料損失");
  if (drift.warnings.length > 0) errors.push(`schema drift 含 ${drift.warnings.length} 個警告`);

  const expected = pending.flatMap(migrationStatements);
  const unsafe = expected.filter((statement) =>
    !/^CREATE TABLE /i.test(statement)
    && !/^CREATE (?:UNIQUE )?INDEX /i.test(statement),
  );
  if (unsafe.length > 0) {
    errors.push("bridge migration 不再是純新增 table/index；必須重新人工審查");
  }

  const expectedCanonical = [...expected].sort();
  const actualCanonical = drift.statements.map(canonicalMigrationStatement).filter(Boolean).sort();
  if (
    expectedCanonical.length !== actualCanonical.length
    || expectedCanonical.some((statement, index) => statement !== actualCanonical[index])
  ) {
    const expectedSet = new Set(expectedCanonical);
    const actualSet = new Set(actualCanonical);
    const unexpected = actualCanonical.filter((statement) => !expectedSet.has(statement));
    const missing = expectedCanonical.filter((statement) => !actualSet.has(statement));
    if (unexpected.length > 0) errors.push(`legacy schema 有 ${unexpected.length} 項非 bridge 預期 drift`);
    if (missing.length > 0) errors.push(`legacy schema 少了 ${missing.length} 項 bridge 預期 drift`);
    if (unexpected.length === 0 && missing.length === 0) errors.push("legacy drift 有重複或數量不符");
  }

  return {
    ok: errors.length === 0,
    errors,
    throughIndex,
    adoptionFingerprint,
  };
}

export function migrationsDirectory(): string {
  return path.resolve(process.env.DB_MIGRATIONS_DIR || path.join(process.cwd(), "drizzle"));
}

/**
 * Reads and validates the checked-in migration journal. This intentionally does
 * more validation than drizzle's default migrator, which only compares the most
 * recent timestamp and otherwise trusts the folder.
 */
export function loadMigrationManifest(directory = migrationsDirectory()): MigrationManifest {
  const journalPath = path.join(directory, "meta", "_journal.json");
  if (!existsSync(journalPath)) {
    throw new Error(`找不到 migration journal：${journalPath}`);
  }

  let journal: Journal;
  try {
    journal = JSON.parse(readFileSync(journalPath, "utf8")) as Journal;
  } catch (error) {
    throw new Error(`migration journal 無法解析：${error instanceof Error ? error.message : error}`);
  }
  if (journal.dialect !== "postgresql" || !Array.isArray(journal.entries)) {
    throw new Error("migration journal 必須是 PostgreSQL 且包含 entries 陣列");
  }

  const seenTags = new Set<string>();
  let previousWhen = -1;
  const entries = journal.entries.map((entry, position): MigrationFile => {
    if (entry.idx !== position) {
      throw new Error(`migration journal idx 不連續：位置 ${position} 寫成 ${entry.idx}`);
    }
    if (!/^[A-Za-z0-9_-]+$/.test(entry.tag) || seenTags.has(entry.tag)) {
      throw new Error(`migration tag 無效或重複：${entry.tag}`);
    }
    if (!Number.isSafeInteger(entry.when) || entry.when <= previousWhen) {
      throw new Error(`migration 時間戳必須安全且嚴格遞增：${entry.tag}`);
    }
    seenTags.add(entry.tag);
    previousWhen = entry.when;

    const migrationPath = path.join(directory, `${entry.tag}.sql`);
    if (!existsSync(migrationPath)) {
      throw new Error(`journal 指向不存在的 migration：${migrationPath}`);
    }
    const migrationSql = readFileSync(migrationPath, "utf8");
    if (!migrationSql.trim()) {
      throw new Error(`migration 不得為空：${entry.tag}`);
    }
    return {
      idx: entry.idx,
      tag: entry.tag,
      createdAt: entry.when,
      hash: createHash("sha256").update(migrationSql).digest("hex"),
      sql: migrationSql,
      statementCount: migrationSql.split("--> statement-breakpoint").filter((part) => part.trim()).length,
    };
  });

  if (entries.length === 0) {
    throw new Error("migration journal 不得為空");
  }
  const fingerprint = createHash("sha256")
    .update(entries.map((entry) => `${entry.idx}:${entry.tag}:${entry.createdAt}:${entry.hash}`).join("\n"))
    .digest("hex")
    .slice(0, 16);

  return { directory, fingerprint, entries };
}

/**
 * Checks only migration ownership/history. It never creates schemas, tables, or
 * ledger rows and is therefore safe to call during application startup.
 */
export async function inspectMigrationState(
  database: Database,
  manifest = loadMigrationManifest(),
): Promise<MigrationState> {
  const tableResult = await database.execute(sql`
    select tablename
    from pg_catalog.pg_tables
    where schemaname = 'public'
    order by tablename
  `);
  const userTables = rowsOf<{ tablename: string }>(tableResult).map((row) => row.tablename);

  const registryResult = await database.execute(sql`
    select to_regclass('drizzle.__drizzle_migrations')::text as name
  `);
  const ledgerExists = Boolean(rowsOf<{ name: string | null }>(registryResult)[0]?.name);

  let ledgerRows: MigrationLedgerRow[] = [];
  if (ledgerExists) {
    const ledgerResult = await database.execute(sql`
      select id, hash, created_at::text as created_at
      from drizzle.__drizzle_migrations
      order by created_at asc, id asc
    `);
    ledgerRows = rowsOf(ledgerResult);
  }

  return classifyMigrationState(userTables, ledgerExists, ledgerRows, manifest);
}

/**
 * Pure classifier kept separate from catalog I/O so ledger corruption and
 * prefix rules can be tested without a live database.
 */
export function classifyMigrationState(
  userTables: string[],
  ledgerExists: boolean,
  ledgerRows: MigrationLedgerRow[],
  manifest: MigrationManifest,
): MigrationState {
  if (ledgerRows.length === 0) {
    return {
      kind: userTables.length === 0 ? "empty-unmigrated" : "legacy-untracked",
      ledgerExists,
      userTables,
      applied: [],
      pending: manifest.entries,
      errors: [],
    };
  }

  const errors: string[] = [];
  const expectedByCreatedAt = new Map(manifest.entries.map((entry) => [entry.createdAt, entry]));
  const appliedIndexes = new Set<number>();
  const seenCreatedAt = new Set<number>();

  for (const row of ledgerRows) {
    const createdAt = Number(row.created_at);
    if (!Number.isSafeInteger(createdAt)) {
      errors.push(`migration ledger id=${row.id} 的 created_at 無效：${row.created_at}`);
      continue;
    }
    if (seenCreatedAt.has(createdAt)) {
      errors.push(`migration ledger 有重複時間戳：${createdAt}`);
      continue;
    }
    seenCreatedAt.add(createdAt);
    const expected = expectedByCreatedAt.get(createdAt);
    if (!expected) {
      errors.push(`資料庫含本版程式不認識的 migration：created_at=${createdAt}`);
      continue;
    }
    if (row.hash !== expected.hash) {
      errors.push(`migration ${expected.tag} 的 hash 與已套用紀錄不符（檔案可能被事後修改）`);
      continue;
    }
    appliedIndexes.add(expected.idx);
  }

  let prefixLength = 0;
  while (appliedIndexes.has(prefixLength)) prefixLength += 1;
  for (const index of appliedIndexes) {
    if (index >= prefixLength) {
      errors.push(`migration 歷史不是連續前綴：缺少 ${manifest.entries[prefixLength]?.tag ?? prefixLength}`);
      break;
    }
  }

  const applied = manifest.entries.slice(0, prefixLength);
  const pending = manifest.entries.slice(prefixLength);
  return {
    kind: errors.length > 0 ? "invalid" : pending.length > 0 ? "pending" : "ready",
    ledgerExists,
    userTables,
    applied,
    pending,
    errors,
  };
}

/**
 * Computes the SQL Drizzle would need to make the live public schema match
 * schema.ts, but deliberately never calls the returned apply() function.
 */
export async function inspectSchemaDrift(database: Database): Promise<SchemaDrift> {
  const { pushSchema } = await import("drizzle-kit/api");
  const plan = await pushSchema(schema as unknown as Record<string, unknown>, database as never);
  let statements = plan.statementsToExecute ?? [];

  // drizzle-kit 0.31 serializes an expression index differently when reading
  // it back from PostgreSQL, and otherwise reports an endless DROP+CREATE pair.
  // Ignore only that exact pair after independently proving the live index has
  // the required unique definition; any missing/changed index still surfaces.
  const dropsFeedbackIndex = statements.some((statement) =>
    /^\s*drop\s+index\s+"?feedback_user_group_uq"?\s*;?\s*$/i.test(statement),
  );
  const createsFeedbackIndex = statements.some((statement) =>
    /^\s*create\s+unique\s+index\s+"?feedback_user_group_uq"?\s+/i.test(statement),
  );
  if (dropsFeedbackIndex && createsFeedbackIndex && await hasExpectedFeedbackExpressionIndex(database)) {
    statements = statements.filter((statement) =>
      !/^\s*drop\s+index\s+"?feedback_user_group_uq"?\s*;?\s*$/i.test(statement)
      && !/^\s*create\s+unique\s+index\s+"?feedback_user_group_uq"?\s+/i.test(statement),
    );
  }
  return {
    hasDataLoss: plan.hasDataLoss,
    statements,
    warnings: plan.warnings ?? [],
  };
}

async function hasExpectedFeedbackExpressionIndex(database: Database): Promise<boolean> {
  const result = await database.execute(sql`
    select pg_get_indexdef(i.indexrelid) as definition
    from pg_catalog.pg_index i
    join pg_catalog.pg_class index_class on index_class.oid = i.indexrelid
    join pg_catalog.pg_class table_class on table_class.oid = i.indrelid
    join pg_catalog.pg_namespace namespace on namespace.oid = table_class.relnamespace
    where namespace.nspname = 'public'
      and table_class.relname = 'feedback'
      and index_class.relname = 'feedback_user_group_uq'
      and i.indisunique
  `);
  const definition = rowsOf<{ definition: string }>(result)[0]?.definition;
  if (!definition) return false;
  const canonical = definition.toLowerCase().replace(/["\s]/g, "").replace("onpublic.feedback", "onfeedback");
  return canonical ===
    "createuniqueindexfeedback_user_group_uqonfeedbackusingbtree(user_id,coalesce(group_id,'00000000-0000-0000-0000-000000000000'::uuid))";
}

export function redactDatabaseTarget(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    const databaseName = url.pathname.replace(/^\/+/, "") || "(default)";
    return `${url.protocol}//${url.username ? `${url.username}@` : ""}${url.host}/${databaseName}`;
  } catch {
    return "(DATABASE_URL 格式無法安全顯示)";
  }
}
