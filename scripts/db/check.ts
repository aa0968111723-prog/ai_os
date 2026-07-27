import {
  inspectMigrationState,
  inspectSchemaDrift,
  loadMigrationManifest,
} from "../../server/db/migrationState";
import {
  connectDatabase,
  printDrift,
  printManifest,
  printState,
  printTarget,
  runCli,
} from "./cli";

void runCli(async () => {
  const manifest = loadMigrationManifest();
  const connection = await connectDatabase();
  try {
    printTarget(connection.connectionString);
    printManifest(manifest);
    const state = await inspectMigrationState(connection.database, manifest);
    printState(state);

    if (state.kind === "empty-unmigrated") {
      throw new Error("空資料庫尚未初始化；先執行 `npm run db:migrate:dry-run`，再執行 `npm run db:migrate`");
    }
    if (state.kind === "invalid") {
      throw new Error("migration ledger 不可信；禁止自動前進，請依上方 history error 人工處理");
    }
    if (state.kind === "pending") {
      throw new Error(`尚有 ${state.pending.length} 份 migration 未套用；請執行 npm run db:migrate`);
    }

    const drift = await inspectSchemaDrift(connection.database);
    printDrift(drift);
    if (state.kind === "legacy-untracked") {
      if (drift.statements.length === 0) {
        throw new Error(
          `既有 DB 結構相符但尚未納管；先備份，再執行 npm run db:adopt -- --confirm=${manifest.fingerprint}`,
        );
      }
      throw new Error("既有 DB 尚未納管且有 schema drift；禁止 baseline，請先人工修復差異");
    }
    if (drift.statements.length > 0) {
      throw new Error("migration ledger 已到最新版，但實際 schema 有 drift；禁止啟動");
    }
    console.log("[db] OK: migration history and live schema are current");
  } finally {
    await connection.pool.end();
  }
});
