/**
 * Safe database runtime verifier.
 * Prints presence / identity / probe results only — never the URL or password.
 */
import { loadLocalEnv } from "../server/bootstrap/loadEnv";
import { parseDatabaseUrl } from "../server/db/connectionConfig";
import { probeDatabaseRuntime } from "../server/services/databaseRuntime";

loadLocalEnv();

const present = Boolean(process.env.DATABASE_URL);
console.log(`DATABASE_URL_PRESENT=${present ? "true" : "false"}`);
const target = parseDatabaseUrl(process.env.DATABASE_URL);
console.log(`DATABASE_CONFIGURED=${target.configured}`);
console.log(`DATABASE_DRIVER=${target.driver}`);
console.log(`DATABASE_HOST_KIND=${target.hostnameKind}`);
console.log(`DATABASE_PORT=${target.port ?? "none"}`);
console.log(`DATABASE_SSL_REQUIRED=${target.sslRequired}`);
console.log(`DATABASE_IDENTITY_HASH=${target.identityHash ?? "none"}`);

const probe = await probeDatabaseRuntime();
console.log(`DATABASE_CONNECTED=${probe.connected}`);
console.log(`DATABASE_LATENCY_MS=${probe.latencyMs ?? "none"}`);
console.log(`DATABASE_SCHEMA_COMPATIBLE=${probe.schemaCompatible}`);
console.log(`DATABASE_ERROR_CLASS=${probe.errorClass ?? "none"}`);
console.log(`DATABASE_MIGRATION_HEAD=${probe.identity.migrationHead ?? "none"}`);
console.log(`DATABASE_SCHEMA_VERSION=${probe.identity.schemaVersion}`);
console.log(`DATABASE_ENV=${probe.identity.environment}`);
console.log(`DATABASE_PROCESS_ROLE=${probe.identity.processRole}`);
console.log(`DATABASE_GIT_SHA_PRESENT=${probe.identity.gitSha ? "true" : "false"}`);
console.log(`POOL_TOTAL=${probe.pool.totalCount}`);
console.log(`POOL_IDLE=${probe.pool.idleCount}`);
console.log(`POOL_WAITING=${probe.pool.waitingCount}`);

if (!probe.configured || !probe.connected || probe.schemaCompatible !== true) {
  process.exitCode = 1;
}
