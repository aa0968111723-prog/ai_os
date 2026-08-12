/**
 * Honest database runtime probe for readiness + operators.
 *
 * Never includes host, username, password, or the raw connection string.
 */
import { sql } from "drizzle-orm";
import { AGENT_SCHEMA_VERSION, currentDeploymentIdentity } from "./deploymentIdentity";
import { loadMigrationManifest } from "../db/migrationState";
import { parseDatabaseUrl, type SafeDatabaseTarget } from "../db/connectionConfig";
import { db, pool } from "../db";
import { readProcessRole, type ProcessRole } from "./processRole";

export type DatabaseErrorClass =
  | "missing_url"
  | "invalid_url"
  | "dns"
  | "timeout"
  | "auth"
  | "network"
  | "query"
  | null;

export interface DatabaseRuntimeReport {
  configured: boolean;
  connected: boolean;
  latencyMs: number | null;
  schemaCompatible: boolean | null;
  errorClass: DatabaseErrorClass;
  identity: {
    environment: string;
    gitSha: string | null;
    schemaVersion: string;
    migrationHead: string | null;
    databaseIdentityHash: string | null;
    processRole: ProcessRole;
  };
  pool: { totalCount: number; idleCount: number; waitingCount: number };
  target: Pick<SafeDatabaseTarget, "driver" | "hostnameKind" | "sslRequired" | "port">;
}

function classifyDbError(error: unknown): DatabaseErrorClass {
  const code = typeof (error as { code?: unknown })?.code === "string"
    ? String((error as { code: string }).code).toUpperCase()
    : "";
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/password authentication failed|28P01|28000/i.test(`${code} ${message}`)) return "auth";
  if (/enotfound|getaddrinfo|dns/i.test(message)) return "dns";
  if (/etimedout|timeout|57014/i.test(`${code} ${message}`)) return "timeout";
  if (/econnrefused|econnreset|enotconn|ehostunreach|0800|08001|08006|57P/i.test(`${code} ${message}`)) return "network";
  return "query";
}

function deploymentEnvironment(env: NodeJS.ProcessEnv = process.env): string {
  return env.APP_ENV
    || env.ZEABUR_ENVIRONMENT
    || env.RAILWAY_ENVIRONMENT
    || env.RENDER_SERVICE_ID && "render"
    || env.NODE_ENV
    || "development";
}

export async function probeDatabaseRuntime(env: NodeJS.ProcessEnv = process.env): Promise<DatabaseRuntimeReport> {
  const target = parseDatabaseUrl(env.DATABASE_URL);
  const identityBase = currentDeploymentIdentity(env);
  const manifest = loadMigrationManifest();
  const migrationHead = manifest.entries.at(-1)?.tag ?? null;
  const report: DatabaseRuntimeReport = {
    configured: target.configured,
    connected: false,
    latencyMs: null,
    schemaCompatible: null,
    errorClass: target.configured ? (target.driver === "postgres" ? null : "invalid_url") : "missing_url",
    identity: {
      environment: deploymentEnvironment(env),
      gitSha: identityBase.sha,
      schemaVersion: identityBase.schemaVersion || AGENT_SCHEMA_VERSION,
      migrationHead,
      databaseIdentityHash: target.identityHash,
      processRole: readProcessRole(env),
    },
    pool: { totalCount: pool.totalCount, idleCount: pool.idleCount, waitingCount: pool.waitingCount },
    target: {
      driver: target.driver,
      hostnameKind: target.hostnameKind,
      sslRequired: target.sslRequired,
      port: target.port,
    },
  };
  if (!target.configured || target.driver !== "postgres") return report;

  const started = Date.now();
  try {
    try {
      await pool.query("SELECT 1");
    } catch (first) {
      // Read-only liveness may retry once after a killed/idle client; writes must not.
      if (!/terminat|econn|timeout|closed|reset/i.test(first instanceof Error ? first.message : String(first))) {
        throw first;
      }
      await pool.query("SELECT 1");
    }
    report.latencyMs = Date.now() - started;
    report.connected = true;
    report.errorClass = null;
    const countRows = await db.execute(sql`
      select count(*)::int as n from drizzle.__drizzle_migrations
    `) as unknown as { rows: Array<{ n: number }> };
    const applied = Number(countRows.rows?.[0]?.n ?? 0);
    report.schemaCompatible = applied === manifest.entries.length;
  } catch (error) {
    report.connected = false;
    report.latencyMs = Date.now() - started;
    report.errorClass = classifyDbError(error);
    report.schemaCompatible = false;
  }
  report.pool = { totalCount: pool.totalCount, idleCount: pool.idleCount, waitingCount: pool.waitingCount };
  return report;
}

export function databaseReadyNote(report: DatabaseRuntimeReport): { ok: boolean; note: string } {
  if (!report.configured) return { ok: false, note: "unconfigured（DATABASE_URL 未設定）" };
  if (!report.connected) return { ok: false, note: `disconnected（${report.errorClass ?? "error"}）` };
  if (report.schemaCompatible === false) return { ok: false, note: "schema_incompatible（migration head 與映像不一致）" };
  return { ok: true, note: `connected latencyMs=${report.latencyMs ?? "?"} schema=ok` };
}
