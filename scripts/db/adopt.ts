import {
  inspectMigrationState,
  inspectSchemaDrift,
  loadMigrationManifest,
  MIGRATION_LOCK_KEY,
  MIGRATIONS_SCHEMA,
  MIGRATIONS_TABLE,
  verifyLegacyAdoptionBridge,
  type MigrationFile,
  type SchemaDrift,
} from "../../server/db/migrationState";
import {
  connectDatabase,
  printDrift,
  printManifest,
  printState,
  printTarget,
  runCli,
} from "./cli";

const dryRun = process.argv.includes("--dry-run");
const confirmation = process.argv.find((arg) => arg.startsWith("--confirm="))?.slice("--confirm=".length);
const throughTag = process.argv.find((arg) => arg.startsWith("--through="))?.slice("--through=".length);

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

    if (state.kind === "empty-unmigrated") {
      throw new Error("這是空 DB，不需要 baseline；請執行 npm run db:migrate");
    }
    if (state.kind !== "legacy-untracked") {
      throw new Error(`只有既有且未納管的 DB 能 adopt；目前狀態是 ${state.kind}`);
    }

    const drift = await inspectSchemaDrift(connection.database);
    printDrift(drift);
    let migrationsToRecord: MigrationFile[];
    let expectedConfirmation = manifest.fingerprint;

    const validateAdoptionDrift = (currentDrift: SchemaDrift): MigrationFile[] => {
      if (!throughTag) {
        if (
          currentDrift.statements.length > 0
          || currentDrift.warnings.length > 0
          || currentDrift.hasDataLoss
        ) {
          throw new Error(
            "baseline 前 schema 必須與最新版完全相符；若這是舊版 0001 DB，請依 runbook 使用受限的 --through bridge",
          );
        }
        return manifest.entries;
      }

      const bridge = verifyLegacyAdoptionBridge(manifest, currentDrift, throughTag);
      expectedConfirmation = bridge.adoptionFingerprint;
      if (!bridge.ok) {
        bridge.errors.forEach((error) => console.error(`[db] legacy bridge rejected: ${error}`));
        throw new Error("legacy schema 不符合受審核的 adoption bridge；本次沒有寫入 ledger");
      }
      const prefix = manifest.entries.slice(0, bridge.throughIndex + 1);
      console.log(
        `[db] legacy bridge verified: record through ${throughTag}; ` +
        `leave ${manifest.entries.length - prefix.length} additive migration(s) pending`,
      );
      if (bridge.alreadyPresent > 0) {
        console.log(
          `[db] ${bridge.alreadyPresent} reviewed object(s) already exist on this legacy DB; ` +
          "their migrations re-run as no-ops and the post-migration drift gate still verifies them",
        );
      }
      return prefix;
    };

    migrationsToRecord = validateAdoptionDrift(drift);

    if (dryRun) {
      console.log("[db] DRY RUN ONLY: live schema is eligible for adoption; no ledger was created");
      const throughArg = throughTag ? ` --through=${throughTag}` : "";
      console.log(
        `[db] after backup, run: npm run db:adopt --${throughArg} --confirm=${expectedConfirmation}`,
      );
      return;
    }
    if (confirmation !== expectedConfirmation) {
      throw new Error(
        `需要明確確認本次 adoption 集合；先跑 db:adopt:dry-run，再帶入 --confirm=${expectedConfirmation}`,
      );
    }

    lockClient = await connection.pool.connect();
    const lockResult = await lockClient.query<{ locked: boolean }>(
      "select pg_try_advisory_lock(hashtext($1)) as locked",
      [MIGRATION_LOCK_KEY],
    );
    locked = lockResult.rows[0]?.locked === true;
    if (!locked) throw new Error("另一個 migration/adopt 程序正持有鎖；本次未執行");

    state = await inspectMigrationState(connection.database, manifest);
    if (state.kind !== "legacy-untracked") {
      throw new Error(`取得鎖後 DB 狀態變成 ${state.kind}；本次未執行`);
    }
    const lockedDrift = await inspectSchemaDrift(connection.database);
    migrationsToRecord = validateAdoptionDrift(lockedDrift);

    await lockClient.query("begin");
    try {
      await lockClient.query(`create schema if not exists "${MIGRATIONS_SCHEMA}"`);
      await lockClient.query(`
        create table if not exists "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" (
          id serial primary key,
          hash text not null,
          created_at bigint
        )
      `);
      const existing = await lockClient.query<{ count: string }>(
        `select count(*)::text as count from "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}"`,
      );
      if (existing.rows[0]?.count !== "0") {
        throw new Error("baseline ledger 在交易中變成非空；拒絕覆寫");
      }
      for (const migration of migrationsToRecord) {
        await lockClient.query(
          `insert into "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" (hash, created_at) values ($1, $2)`,
          [migration.hash, migration.createdAt],
        );
      }
      await lockClient.query("commit");
    } catch (error) {
      await lockClient.query("rollback").catch(() => undefined);
      throw error;
    }

    const finalState = await inspectMigrationState(connection.database, manifest);
    const expectedKind = migrationsToRecord.length === manifest.entries.length ? "ready" : "pending";
    if (
      finalState.kind !== expectedKind
      || finalState.applied.length !== migrationsToRecord.length
    ) {
      throw new Error(`baseline 寫入後狀態異常：${finalState.kind}`);
    }
    console.log(
      `[db] ADOPTED: ${migrationsToRecord.length} migrations recorded; no public table/data DDL was executed`,
    );
    if (finalState.pending.length > 0) {
      console.log(
        `[db] NEXT: run npm run db:migrate to apply ${finalState.pending.map((entry) => entry.tag).join(", ")}`,
      );
    }
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
