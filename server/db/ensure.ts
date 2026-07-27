/**
 * Read-only database startup gate.
 *
 * Production DDL belongs to reviewed migration files and an explicit
 * `npm run db:migrate` release step. Application startup must never call
 * pushSchema.apply(), create an index, or repair/delete data.
 */
import { sql } from "drizzle-orm";
import { db } from "./index";
import {
  inspectMigrationState,
  inspectSchemaDrift,
  loadMigrationManifest,
  type MigrationState,
} from "./migrationState";

async function dbReady(): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}

function explainUnready(state: MigrationState): void {
  if (state.kind === "empty-unmigrated") {
    console.warn("[db] 空資料庫尚未初始化；請在 release/one-off job 明確執行 `npm run db:migrate`。");
    return;
  }
  if (state.kind === "legacy-untracked") {
    console.warn(
      `[db] 偵測到 ${state.userTables.length} 張既有表，但沒有 migration 基準紀錄。` +
      " 請先備份，執行 `npm run db:adopt:dry-run`，再依輸出的 fingerprint 明確採用。",
    );
    return;
  }
  if (state.kind === "pending") {
    console.warn(`[db] 尚有 ${state.pending.length} 份 migration 未套用：${state.pending.map((m) => m.tag).join(", ")}`);
    console.warn("[db] 應用程式不會在 runtime 改 schema；請由 release/one-off job 執行 `npm run db:migrate`。");
    return;
  }
  state.errors.forEach((error) => console.warn("[db] migration 歷史錯誤：", error));
}

export async function ensureSchema(): Promise<boolean> {
  if (!process.env.DATABASE_URL) {
    console.warn("[db] DATABASE_URL 未設定——正式服務必須指向 PostgreSQL；啟動不會自行建立資料庫。");
    return false;
  }

  for (let attempt = 1; attempt <= 10; attempt += 1) {
    if (await dbReady()) break;
    if (attempt === 10) {
      console.warn("[db] 資料庫連續 10 次連不上——檢查 DATABASE_URL 與 Postgres 網路狀態。");
      return false;
    }
    console.log(`[db] 等待資料庫就緒（${attempt}/10）…`);
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  try {
    const manifest = loadMigrationManifest();
    const state = await inspectMigrationState(db, manifest);
    if (state.kind !== "ready") {
      explainUnready(state);
      return false;
    }

    const drift = await inspectSchemaDrift(db);
    if (drift.statements.length > 0) {
      console.warn(`[db] 偵測到 schema drift（${drift.statements.length} 項）；為保護正式資料，runtime 不會自動修正。`);
      drift.warnings.slice(0, 10).forEach((warning) => console.warn("[db]   警告：", warning));
      drift.statements.slice(0, 10).forEach((statement) => console.warn("[db]   待處理 SQL：", statement));
      if (drift.statements.length > 10) console.warn(`[db]   另有 ${drift.statements.length - 10} 項未顯示；請執行 npm run db:check。`);
      return false;
    }

    console.log(`[db] ✓ migration ${manifest.entries.at(-1)?.tag} 已套用，schema 無 drift（唯讀檢查）`);
    return true;
  } catch (error) {
    console.warn("[db] migration/schema 檢查失敗：", error instanceof Error ? error.message : error);
    return false;
  }
}
