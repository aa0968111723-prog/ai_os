import { describe, expect, it } from "vitest";
import { pool } from "../db";
import { loadMigrationManifest } from "../db/migrationState";
import { probeDatabaseRuntime } from "./databaseRuntime";

const RUN_PG = Boolean(process.env.DATABASE_URL);

describe.skipIf(!RUN_PG)("database runtime probe (real PostgreSQL)", () => {
  it("SELECT 1 succeeds through the app Pool and reports schema compatibility", async () => {
    const one = await pool.query("SELECT 1 AS ok");
    expect(one.rows[0]?.ok).toBe(1);
    const probe = await probeDatabaseRuntime();
    expect(probe.configured).toBe(true);
    expect(probe.connected).toBe(true);
    expect(probe.latencyMs).toBeTypeOf("number");
    expect(probe.schemaCompatible).toBe(true);
    expect(probe.identity.databaseIdentityHash).toMatch(/^[a-f0-9]{16}$/);
    expect(probe.identity.migrationHead).toBe(loadMigrationManifest().entries.at(-1)?.tag);
    expect(JSON.stringify(probe)).not.toMatch(/password|postgres:\/\//i);
  });

  it("recovers after the backend terminates the current client", async () => {
    const client = await pool.connect();
    try {
      await client.query("SELECT pg_terminate_backend(pg_backend_pid())").catch(() => undefined);
    } finally {
      client.release(true);
    }
    let lastError: unknown;
    let recovered = false;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const again = await pool.query("SELECT current_database() AS db");
        expect(again.rows[0]?.db).toBeTruthy();
        recovered = true;
        break;
      } catch (error) {
        lastError = error;
      }
    }
    expect(recovered, String(lastError instanceof Error ? lastError.message : lastError)).toBe(true);
    expect(pool.waitingCount).toBe(0);
  });
});
