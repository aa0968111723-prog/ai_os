import pg from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../server/db/schema";
import {
  redactDatabaseTarget,
  type MigrationManifest,
  type MigrationState,
  type SchemaDrift,
} from "../../server/db/migrationState";

export type CliDatabase = NodePgDatabase<typeof schema>;

export interface DatabaseConnection {
  pool: pg.Pool;
  database: CliDatabase;
  connectionString: string;
}

export async function connectDatabase(): Promise<DatabaseConnection> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL 未設定");

  const pool = new pg.Pool({
    connectionString,
    max: 4,
    connectionTimeoutMillis: 15_000,
    application_name: "ai-director-os-migration-cli",
  });
  await pool.query("select 1");
  return { pool, database: drizzle(pool, { schema }), connectionString };
}

export function printTarget(connectionString: string): void {
  console.log(`[db] target: ${redactDatabaseTarget(connectionString)}`);
}

export function printManifest(manifest: MigrationManifest): void {
  console.log(`[db] migration fingerprint: ${manifest.fingerprint}`);
  console.log(`[db] migration files: ${manifest.entries.length} (${manifest.entries.map((entry) => entry.tag).join(", ")})`);
}

export function printState(state: MigrationState): void {
  console.log(
    `[db] state=${state.kind}; applied=${state.applied.length}; pending=${state.pending.length}; public_tables=${state.userTables.length}`,
  );
  state.errors.forEach((error) => console.error(`[db] history error: ${error}`));
}

export function printPending(state: MigrationState): void {
  if (state.pending.length === 0) {
    console.log("[db] no pending migrations");
    return;
  }
  for (const migration of state.pending) {
    console.log(
      `[db] pending ${migration.tag}: ${migration.statementCount} statements; sha256=${migration.hash.slice(0, 16)}…`,
    );
  }
}

export function printDrift(drift: SchemaDrift): void {
  if (drift.statements.length === 0) {
    console.log("[db] schema drift: none");
    return;
  }
  console.error(`[db] schema drift: ${drift.statements.length} statement(s); data-loss-risk=${drift.hasDataLoss}`);
  drift.warnings.forEach((warning) => console.error(`[db] warning: ${warning}`));
  drift.statements.forEach((statement, index) => console.error(`[db] drift ${index + 1}: ${statement}`));
}

export async function runCli(main: () => Promise<void>): Promise<void> {
  try {
    await main();
  } catch (error) {
    console.error("[db] FAILED:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
