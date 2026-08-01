import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

/**
 * Migrations that were historically applied by ad-hoc SQL / earlier deploy scripts
 * before the Drizzle journal existed, or that are safe to bridge because they are
 * pure additive IF NOT EXISTS changes that do not alter existing data.
 *
 * The bridge is only allowed when the *exact* pending set matches this list
 * (order and membership). Any other combination of pending migrations forces a
 * full journal-driven apply so we never silently skip a real schema change.
 *
 * When a new pure-additive migration is added and we want the same zero-downtime
 * bridge behaviour on already-deployed environments, append its tag here *and*
 * keep the SQL strictly IF NOT EXISTS / ADD COLUMN IF NOT EXISTS.
 */
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
] as const;

/**
 * Content hashes of migrations whose SQL was corrected after release.
 *
 * The ledger stores the sha256 of the migration file, so correcting a released
 * file would otherwise make every database that already applied the original
 * look like tampered history. A hash may only be listed here when the corrected
 * file is provably equivalent on every database where the original succeeded,
 * so accepting it cannot hide real divergence.
 *
 * 0005 created its unique indexes without first removing the duplicate rows
 * that made them fail on live data. Wherever the original succeeded there were
 * no duplicates, so the de-duplication added to the corrected file deletes
 * nothing and both versions leave exactly the same schema and rows.
 *
 * 0004 created its indexes without IF NOT EXISTS. Wherever the original
 * succeeded the indexes did not yet exist, so adding the guard produces the
 * same two indexes by the same definitions.
 */
export const KNOWN_CORRECTED_MIGRATION_HASHES: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  [
    "0005_membership_read_uniqueness",
    new Set([
      // original (pre-dedup)
      "a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456",
    ]),
  ],
]);

export type MigrationDrift = {
  hasDataLoss: boolean;
  statements: string[];
};

/**
 * The single row-changing statement in 0023_asset_durability that is allowed
 * through the drift gate. It only writes the newly-added land_* tracking
 * columns, only for rows that truly have no local file and still point at an
 * external URL, and is idempotent on re-run. Any other UPDATE is still blocked.
 */
export function isReviewedLandingBackfillStatement(statement: string): boolean {
  const normalized = statement.replace(/\s+/g, " ").trim().toLowerCase();
  return (
    normalized.startsWith("update assets set land_state='pending'") &&
    normalized.includes("land_next_try_at=now()") &&
    normalized.includes("origin_url=url") &&
    normalized.includes("storage_path is null") &&
    normalized.includes("url like 'http%'") &&
    normalized.includes("is_ai_generated = true")
  );
}

export function filterDangerousStatements(statements: string[]): string[] {
  return statements.filter(
    (statement) =>
      /\b(drop|truncate|delete|alter\s+table.*drop|update)\b/i.test(statement) &&
      !isReviewedLandingBackfillStatement(statement),
  );
}

export function assertLegacyBridgeAllowed(
  pendingTags: string[],
  drift: MigrationDrift,
): string[] {
  const errors: string[] = [];
  if (
    pendingTags.length !== LEGACY_ADOPTION_PENDING_TAGS.length ||
    pendingTags.some((tag, index) => tag !== LEGACY_ADOPTION_PENDING_TAGS[index])
  ) {
    errors.push(
      `legacy bridge 僅適用 pending=${LEGACY_ADOPTION_PENDING_TAGS.join(",")}；目前為 ${pendingTags.join(",") || "(none)"}`,
    );
  }
  if (drift.hasDataLoss) errors.push("schema drift 被 Drizzle 標記為可能資料損失");
  const dangerous = filterDangerousStatements(drift.statements);
  if (dangerous.length > 0) {
    errors.push(
      `drift 計畫含有未審查的危險語句：${dangerous.slice(0, 3).join(" | ")}${dangerous.length > 3 ? " …" : ""}`,
    );
  }
  return errors;
}

export function hashMigrationFile(tag: string, sqlRoot = "drizzle"): string {
  const path = join(sqlRoot, `${tag}.sql`);
  if (!existsSync(path)) return "";
  const body = readFileSync(path);
  return createHash("sha256").update(body).digest("hex");
}

export function isKnownCorrectedHash(tag: string, hash: string): boolean {
  const allowed = KNOWN_CORRECTED_MIGRATION_HASHES.get(tag);
  return allowed ? allowed.has(hash) : false;
}

export async function readAppliedMigrationTags(
  db: PostgresJsDatabase<any>,
): Promise<string[]> {
  const rows = await db.execute(
    sql`SELECT tag FROM drizzle.__drizzle_migrations ORDER BY created_at ASC`,
  );
  return (rows as unknown as { tag: string }[]).map((r) => r.tag);
}

export function redactDatabaseUrl(url: string | undefined): string {
  if (!url) return "(DATABASE_URL 未設定)";
  try {
    const u = new URL(url);
    if (u.password) u.password = "***";
    return `${u.protocol}//${u.username ? u.username + ":***@" : ""}${u.host}${u.pathname}${u.search}`;
  } catch {
    return "(DATABASE_URL 格式無法安全顯示)";
  }
}
