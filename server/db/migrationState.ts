import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

/**
 * Tags that the legacy-adoption bridge is allowed to treat as "already applied"
 * when the live schema already matches the expected end-state of those
 * migrations. This is the only safe way to bring an old production database
 * (that was hand-patched before we had a proper migration ledger) under the
 * Drizzle migration system without replaying destructive statements.
 *
 * Rules for adding a tag here:
 *   1. The migration must be pure additive (CREATE TABLE / ADD COLUMN /
 *      CREATE INDEX, all with IF NOT EXISTS) OR a reviewed, idempotent data
 *      backfill that the drift gate explicitly whitelist-allows.
 *   2. Never put a DROP / RENAME / type-change / NOT NULL without default here.
 *   3. After the tag is in this list, the corresponding SQL file is frozen —
 *      correcting it requires a new migration + an entry in
 *      MIGRATION_CONTENT_CORRECTIONS.
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
 * migration would otherwise make the drift gate think the ledger is corrupt.
 * Entries here let the gate accept the new hash for a known tag.
 */
export const MIGRATION_CONTENT_CORRECTIONS: Record<string, string[]> = {
  // example: "0005_membership_read_uniqueness": ["oldhash", "newhash"],
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "../../drizzle");

export function migrationFileHash(tag: string): string {
  const file = path.join(MIGRATIONS_DIR, `${tag}.sql`);
  const body = readFileSync(file, "utf8");
  return createHash("sha256").update(body).digest("hex");
}

/**
 * The single reviewed, idempotent UPDATE that the 0023_asset_durability migration
 * is allowed to run as part of the legacy-adoption bridge. Anything else that
 * looks like a row-changing statement is rejected by the drift gate.
 *
 * Kept as a pure predicate so the gate (and its unit tests) can call it without
 * importing the whole migration runner.
 */
export function isReviewedLandingBackfillStatement(statement: string): boolean {
  const normalized = statement.replace(/\s+/g, " ").trim().toLowerCase();
  // Must touch only the land_* tracking columns + origin_url, only rows that
  // truly have no local file and still point at an external URL, and only AI-
  // generated assets (manual uploads have no re-fetchable origin).
  return (
    normalized.startsWith("update assets set") &&
    normalized.includes("land_state") &&
    normalized.includes("land_next_try_at") &&
    normalized.includes("origin_url") &&
    normalized.includes("storage_path is null") &&
    normalized.includes("url like 'http%'") &&
    normalized.includes("is_ai_generated = true") &&
    !normalized.includes("delete") &&
    !normalized.includes("drop") &&
    !normalized.includes("truncate")
  );
}

export type DriftCheckResult = {
  hasDataLoss: boolean;
  statements: string[];
  errors: string[];
};

/**
 * Inspect a Drizzle push / migrate plan and reject anything that looks like it
 * could destroy data, unless it is the single reviewed landing backfill.
 */
export function inspectDriftPlan(statements: string[]): DriftCheckResult {
  const errors: string[] = [];
  let hasDataLoss = false;
  for (const statement of statements) {
    const lower = statement.toLowerCase();
    const isDangerous =
      /\bdrop\b/.test(lower) ||
      /\btruncate\b/.test(lower) ||
      /\balter\s+table\b.*\bdrop\b/.test(lower) ||
      (/\bupdate\b/.test(lower) && !isReviewedLandingBackfillStatement(statement)) ||
      /\bdelete\s+from\b/.test(lower);
    if (isDangerous) {
      hasDataLoss = true;
      errors.push(`potentially destructive statement blocked: ${statement.slice(0, 120)}`);
    }
  }
  return { hasDataLoss, statements, errors };
}

export async function assertLegacyBridgeApplicable(
  db: PostgresJsDatabase<any>,
  pendingTags: string[],
): Promise<void> {
  const errors: string[] = [];
  if (
    pendingTags.length !== LEGACY_ADOPTION_PENDING_TAGS.length ||
    pendingTags.some((tag, index) => tag !== LEGACY_ADOPTION_PENDING_TAGS[index])
  ) {
    errors.push(
      `legacy bridge 僅適用 pending=${LEGACY_ADOPTION_PENDING_TAGS.join(",")}；目前為 ${pendingTags.join(",") || "(none)"}`,
    );
  }
  // Further live-schema checks are performed by the caller against the drift plan.
  if (errors.length) {
    throw new Error(errors.join("\n"));
  }
}

export function migrationTagFromFilename(filename: string): string {
  return filename.replace(/\.sql$/, "");
}
