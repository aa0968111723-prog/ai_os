import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { MIGRATION_REVISIONS } from "./migrationRevisions";
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
  "0004_query_indexes",
  "0005_membership_read_uniqueness",
  "0006_agent_plan_effects",
  "0007_project_human_tasks",
  "0008_complete_plan_summary",
  "0009_agent_events_and_indexes",
  // 0010：純新增 model_live_catalog 表＋索引（皆 IF NOT EXISTS），可安全納入 bridge
  "0010_model_live_catalog",
  // 0011：純新增 guarded JSONB 欄位，可安全納入 bridge
  "0011_agent_planner_telemetry",
  // 0012：sessions 裝置 meta 欄位（皆 ADD COLUMN IF NOT EXISTS），可安全納入 bridge
  "0012_session_device_meta",
  // 0013：純新增 upload_grants 表＋索引（皆 IF NOT EXISTS），可安全納入 bridge
  "0013_upload_grants",
  // 0014：純新增 email_step_up_challenges 表＋索引（皆 IF NOT EXISTS），可安全納入 bridge
  "0014_email_step_up",
  // 0015：users 加 nullable ui_density 欄位（ADD COLUMN IF NOT EXISTS），可安全納入 bridge
  "0015_ui_density",
  // 0016：純新增 external_accounts 表＋唯一索引（皆 IF NOT EXISTS），可安全納入 bridge
  "0016_external_accounts",
  // 0017：純新增 agent_runs 索引（CREATE INDEX IF NOT EXISTS），可安全納入 bridge
  "0017_group_agent_overview_idx",
  // 0018：knowledge.pinned（ADD COLUMN IF NOT EXISTS）＋索引，可安全納入 bridge
  "0018_knowledge_pinned",
  // 0019：knowledge.summary nullable text（ADD COLUMN IF NOT EXISTS），可安全納入 bridge
  "0019_knowledge_summary",
  // 0020：純新增 group_agent_runs／group_agent_events 表＋索引，與 group_members 一個 nullable
  //       欄位（皆 IF NOT EXISTS），不動任何既有資料，可安全納入 bridge
  "0020_group_agent_commander",
  // 0021：純新增 user_presence 表（CREATE TABLE IF NOT EXISTS），不動任何既有資料，可安全納入 bridge
  "0021_user_presence",
  // 0022：純新增 user_devices／device_challenges 兩張表＋索引，與 sessions／users 各一個
  //       nullable 欄位（皆 IF NOT EXISTS），不動任何既有資料，可安全納入 bridge。
  //       所有欄位都寫在 CREATE TABLE 裡、不在同一批 pending 內用 ALTER 補欄位——
  //       否則 bridge 比對的整表 DDL（含全部欄位的單一 CREATE TABLE）會對不起來。
  "0022_device_trust",
  // 0023：素材保全——三張新表＋assets 八個 nullable/有 default 欄位＋部分索引（皆 IF NOT EXISTS），
  //       外加一句經審查的落地狀態回填 UPDATE（只寫新加入的 land_* 追蹤欄位、只挑「本地無檔、
  //       url 仍是外部網址、AI 生成」的列；不碰 url/storage_path/使用者內容，重跑冪等）。
  //       row-changing 語句不會出現在 drift 計畫中，比照 0005 的去重前例以 idiom 白名單放行
  //      （見 isReviewedLandingBackfillStatement），其餘 UPDATE 仍一律擋下要求人工審查。
  "0023_asset_durability",
  // 0024：純新增 asset_revisions 表＋索引（皆 IF NOT EXISTS），不動任何既有資料，可安全納入 bridge
  "0024_asset_revisions",
  // 0025：純新增 props 表＋索引，與 generations／prompts 各一個 nullable jsonb 欄位
  //       （皆 IF NOT EXISTS），不動任何既有資料，可安全納入 bridge
  "0025_project_props",
  // 0026：純新增 AI 應用層運作軌跡表與索引，工作流／代理各加 nullable 欄位；
  //       全部使用 IF NOT EXISTS，不改寫既有資料，可安全納入 bridge。
  "0026_ai_trace",
  // 0027：generations 加一個 nullable jsonb 快照欄位（ADD COLUMN IF NOT EXISTS），不改寫既有資料。
  "0027_generation_continuity",
  // 0028：workflow_runs 加 nullable jsonb 快照欄位（ADD COLUMN IF NOT EXISTS），舊 run 維持原本逐步解析行為。
  "0028_workflow_continuity_snapshot",
  // 0029：props 歸屬索引，外加給「已套用舊版 0025」資料庫補的兩個 nullable 欄位
  //       （皆 IF NOT EXISTS；欄位本體已在 0025 的 CREATE TABLE 內）。
  "0029_prop_ownership",
  // 0030：scenes 加三個 nullable jsonb 卡片引用欄位（ADD COLUMN IF NOT EXISTS）；
  //       scenes 是 baseline 既有表，用 ALTER 補欄位正是這裡的正解（不同於 0025 的 props）。
  "0030_scene_cards",
  // 0031：純新增 user_ai_provider_keys 表＋唯一索引（皆 IF NOT EXISTS）。個人 AI 金鑰是新資料，
  //       不動任何既有表。檔尾另有一句 ADD COLUMN IF NOT EXISTS "updated_at" 補給「套過不完整早期版本」
  //       的資料庫；欄位本體已寫在 CREATE TABLE 內，所以在乾淨的 bridge 批次裡它必然是 no-op——
  //       比照 0029 之於 0025 的前例，會落在「預期但 drift 沒有」且可安全重跑的那一類。
  "0031_user_ai_provider_keys",
  // 0032：純新增 community_posts 表＋四個索引與一個部分唯一索引（皆 IF NOT EXISTS）。
  //       發布快照自成一表，不改寫 prompts／generations／assets 任何一列。
  "0032_community_posts",
  // 0033：users 加一個 nullable avatar_url（ADD COLUMN IF NOT EXISTS），既有帳號預設無頭像。
  "0033_user_avatar",
  // 0034：純新增 note_comments 表＋兩個索引（皆 IF NOT EXISTS），不動 notes 既有資料。
  "0034_note_comments",
] as const;

/**
 * True when `hash` is a retired-but-equivalent revision of `tag`: a hash the
 * file carried before a correction that MIGRATION_REVISIONS records as provably
 * equivalent on every database where the original succeeded.
 *
 * Every revision but the last is superseded by definition, so the accepted set
 * is derived from the same table the invariant tests pin the files against.
 * Nothing has to be registered by hand at correction time — an omission there is
 * what left 0029 reading as tampered history and stopped the service booting.
 */
export function isSupersededMigrationHash(tag: string, hash: string): boolean {
  const revisions = MIGRATION_REVISIONS[tag];
  return revisions !== undefined && revisions.slice(0, -1).includes(hash);
}

export interface LegacyAdoptionCheck {
  ok: boolean;
  errors: string[];
  throughIndex: number;
  adoptionFingerprint: string;
  /** Reviewed statements whose object the legacy database already carries. */
  alreadyPresent: number;
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
    .replace(/^(CREATE (?:UNIQUE )?INDEX) IF NOT EXISTS /i, "$1 ")
    .replace(/^(CREATE TABLE) IF NOT EXISTS /i, "$1 ")
    .replace(/^(ALTER TABLE "[^"]+" ADD COLUMN) IF NOT EXISTS /i, "$1 ")
    .replace(/\s+/g, " ")
    // 逗號後的空白也一併正規化。drizzle-kit 產生的欄位清單沒有空白（`("a","b")`），
    // 手寫的 migration 幾乎一定會為了可讀性加上（`("a", "b")`）——只收斂空白「run」的話，
    // 兩者永遠對不上，於是一句完全等價的 CREATE INDEX 會同時被判成「非預期 drift」與「缺漏」。
    // 這在識別字之間不是語意差異，正規化掉才不會逼每一份手寫 migration 去猜產生器的排版。
    .replace(/,\s+/g, ",");
}

function migrationStatements(entry: MigrationFile): string[] {
  return entry.sql
    .split("--> statement-breakpoint")
    .map(canonicalMigrationStatement)
    .filter(Boolean);
}

/**
 * Canonical form plus the original text. Canonicalization deliberately drops
 * `IF NOT EXISTS` so a statement can be compared against a generated drift
 * plan, which never emits it — but whether the guard was written is exactly
 * what decides if the statement can be safely re-run, so the raw text has to
 * survive alongside it.
 */
function migrationStatementPairs(entry: MigrationFile): { raw: string; canonical: string }[] {
  return entry.sql
    .split("--> statement-breakpoint")
    .map((part) => ({
      raw: part
        .split(/\r?\n/)
        .filter((line) => !line.trimStart().startsWith("--"))
        .join("\n")
        .trim()
        .replace(/;+\s*$/, "")
        .replace(/\s+/g, " "),
      canonical: canonicalMigrationStatement(part),
    }))
    .filter((pair) => pair.canonical);
}

/** Additive schema DDL — the only statement kinds that may appear as drift. */
function isAdditiveSchemaStatement(statement: string): boolean {
  return /^CREATE TABLE /i.test(statement)
    || /^CREATE (?:UNIQUE )?INDEX /i.test(statement)
    || /^ALTER TABLE "[^"]+" ADD COLUMN /i.test(statement);
}

/**
 * True when re-running the statement against an object that already exists is
 * a no-op, so the migration can still be recorded as applied on a database the
 * former pushSchema path had already created that object in.
 */
export function isReRunnableCreateStatement(statement: string): boolean {
  return /^CREATE (?:TABLE|(?:UNIQUE )?INDEX) IF NOT EXISTS /i.test(statement)
    || /^ALTER TABLE "[^"]+" ADD COLUMN IF NOT EXISTS /i.test(statement);
}

/**
 * Matches only the row de-duplication idiom that must precede a new unique
 * index: a self-join DELETE keeping one row per key. Any other DELETE — an
 * unconditional purge, or one joining a different table — is not matched and
 * still fails the bridge's manual-review gate.
 */
export function isRowDeduplicationStatement(statement: string): boolean {
  const match = /^DELETE FROM "([^"]+)" a USING "([^"]+)" b WHERE .+/i.exec(statement);
  return match !== null && match[1] === match[2];
}

/**
 * The single reviewed, idempotent UPDATE that 0023_asset_durability is allowed to
 * run as part of the legacy-adoption bridge: it only writes the land_* tracking
 * columns that same migration just added, and only for rows that genuinely have
 * no local file, still point at an external URL, and were AI-generated (manual
 * uploads have no re-fetchable origin). Every other row-changing statement stays
 * blocked by the manual-review gate.
 *
 * Kept as a pure predicate so the gate — and its unit tests — can call it without
 * importing the migration runner.
 */
export function isReviewedLandingBackfillStatement(statement: string): boolean {
  const normalized = statement.replace(/\s+/g, " ").trim().toLowerCase();
  return (
    normalized.startsWith("update assets set")
    && normalized.includes("land_state")
    && normalized.includes("land_next_try_at")
    && normalized.includes("origin_url")
    && normalized.includes("storage_path is null")
    && normalized.includes("url like 'http%'")
    && normalized.includes("is_ai_generated = true")
    && !normalized.includes("delete")
    && !normalized.includes("drop")
    && !normalized.includes("truncate")
  );
}

/**
 * Proves a legacy database is exactly the historical 0001 schema:
 * current-schema drift must be precisely the additive CREATE TABLE/INDEX DDL
 * in the reviewed bridge migrations—nothing missing, extra, destructive,
 * or warning-producing.
 *
 * Bridge migrations may also carry the reviewed row de-duplication that a new
 * unique index needs. Those statements change rows rather than schema, so they
 * never surface as drift and are excluded from the comparison; every other
 * statement kind still trips the review gate.
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
  let alreadyPresent = 0;

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

  const pairs = pending.flatMap(migrationStatementPairs);
  const expected = pairs.map((pair) => pair.canonical);
  const unsafe = expected.filter((statement) =>
    !isAdditiveSchemaStatement(statement)
    && !isRowDeduplicationStatement(statement)
    && !isReviewedLandingBackfillStatement(statement),
  );
  if (unsafe.length > 0) {
    errors.push("bridge migration 不再是純新增 table/index 或去重；必須重新人工審查");
  }

  // The former pushSchema path created whatever schema.ts held at the time, so
  // a legacy database can already carry objects belonging to a later bridge
  // migration. Those show up as expected DDL that is absent from drift, which
  // is safe precisely when re-running the statement is a no-op — the migration
  // then records as applied without touching the existing object, and the
  // post-migration drift gate still proves the end state. Drift the bridge did
  // not predict stays fatal: that is unreviewed divergence.
  const reRunnable = new Set(
    pairs.filter((pair) => isReRunnableCreateStatement(pair.raw)).map((pair) => pair.canonical),
  );
  const expectedCanonical = expected.filter(isAdditiveSchemaStatement).sort();
  const actualCanonical = drift.statements.map(canonicalMigrationStatement).filter(Boolean).sort();
  if (
    expectedCanonical.length !== actualCanonical.length
    || expectedCanonical.some((statement, index) => statement !== actualCanonical[index])
  ) {
    const expectedSet = new Set(expectedCanonical);
    const actualSet = new Set(actualCanonical);
    const unexpected = actualCanonical.filter((statement) => !expectedSet.has(statement));
    const missing = expectedCanonical.filter((statement) => !actualSet.has(statement));
    const missingUnsafe = missing.filter((statement) => !reRunnable.has(statement));
    if (unexpected.length > 0) errors.push(`legacy schema 有 ${unexpected.length} 項非 bridge 預期 drift`);
    if (missingUnsafe.length > 0) {
      errors.push(
        `legacy schema 少了 ${missingUnsafe.length} 項 bridge 預期 drift，且該 migration 無法安全重跑`,
      );
    }
    if (missing.length > missingUnsafe.length) {
      alreadyPresent = missing.length - missingUnsafe.length;
    }
    if (unexpected.length === 0 && missing.length === 0) errors.push("legacy drift 有重複或數量不符");
  }

  return {
    ok: errors.length === 0,
    errors,
    throughIndex,
    adoptionFingerprint,
    alreadyPresent,
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
    if (row.hash !== expected.hash && !isSupersededMigrationHash(expected.tag, row.hash)) {
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
