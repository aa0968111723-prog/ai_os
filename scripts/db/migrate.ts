import { migrate } from "drizzle-orm/node-postgres/migrator";
import {
  inspectMigrationState,
  inspectSchemaDrift,
  loadMigrationManifest,
  MIGRATION_LOCK_KEY,
  MIGRATIONS_SCHEMA,
  MIGRATIONS_TABLE,
  SchemaDriftInspectError,
} from "../../server/db/migrationState";
import {
  connectDatabase,
  printDrift,
  printManifest,
  printPending,
  printState,
  printTarget,
  runCli,
} from "./cli";

const dryRun = process.argv.includes("--dry-run");

void runCli(async () => {
  const manifest = loadMigrationManifest();
  const connection = await connectDatabase();
  let lockClient: Awaited<ReturnType<typeof connection.pool.connect>> | undefined;
  let locked = false;
  try {
    printTarget(connection.connectionString);
    printManifest(manifest);
    let state = await inspectMigrationState(connection.database, manifest);
    printState(state);
    printPending(state);

    if (state.kind === "legacy-untracked") {
      throw new Error("既有 DB 沒有 migration ledger；db:migrate 不會猜測或重建，請改走 db:adopt");
    }
    if (state.kind === "invalid") {
      throw new Error("migration ledger 不可信；禁止套用");
    }

    if (dryRun) {
      if (state.kind === "ready") {
        const drift = await inspectSchemaDrift(connection.database);
        printDrift(drift);
        if (drift.statements.length > 0) throw new Error("沒有 pending migration，卻有 schema drift");
      }
      console.log("[db] DRY RUN ONLY: no DDL or ledger writes were executed");
      return;
    }

    lockClient = await connection.pool.connect();
    const lockResult = await lockClient.query<{ locked: boolean }>(
      "select pg_try_advisory_lock(hashtext($1)) as locked",
      [MIGRATION_LOCK_KEY],
    );
    locked = lockResult.rows[0]?.locked === true;
    if (!locked) throw new Error("另一個 migration/adopt 程序正持有鎖；本次未執行");

    // Re-read under the session lock so a concurrent release cannot invalidate
    // the decision made above.
    state = await inspectMigrationState(connection.database, manifest);
    if (state.kind === "legacy-untracked" || state.kind === "invalid") {
      throw new Error(`取得鎖後 DB 狀態變成 ${state.kind}；本次未執行`);
    }

    await migrate(connection.database, {
      migrationsFolder: manifest.directory,
      migrationsSchema: MIGRATIONS_SCHEMA,
      migrationsTable: MIGRATIONS_TABLE,
    });

    const finalState = await inspectMigrationState(connection.database, manifest);
    printState(finalState);
    if (finalState.kind !== "ready") {
      throw new Error(`migration 執行後 ledger 仍不是 ready：${finalState.kind}`);
    }
    let drift;
    try {
      drift = await inspectSchemaDrift(connection.database);
    } catch (error) {
      if (error instanceof SchemaDriftInspectError) {
        console.error(`[db] ${error.message}`);
        throw error;
      }
      throw error;
    }
    printDrift(drift);
    if (drift.statements.length > 0) {
      throw new Error("migration 已提交，但 schema 仍有 drift；保持服務未啟動並人工診斷");
    }
    console.log(`[db] APPLIED: schema is current at ${manifest.entries.at(-1)?.tag}`);
  } finally {
    if (locked) {
      await lockClient
        .query("select pg_advisory_unlock(hashtext($1))", [MIGRATION_LOCK_KEY])
        .catch(() => undefined);
    }
    lockClient?.release();
    await connection.pool.end();
  }
});
