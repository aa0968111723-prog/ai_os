/**
 * Unified backend dependency runtime. Secrets never appear in the report.
 *
 * Planner and /api/ready share this snapshot so "declared in the catalog"
 * is never treated as "usable right now".
 */
import { probeDatabaseRuntime, type DatabaseRuntimeReport } from "./databaseRuntime";
import { redisPing, redisConfig } from "./redis";
import { objectStoreConfig, putObject, headObject, deleteObject } from "./objectStore";
import { isMockMode } from "./fal";
import { geminiApiKeyConfigured } from "./gemini";

export const BACKEND_STATES = [
  "UNCONFIGURED",
  "CONNECTING",
  "HEALTHY",
  "DEGRADED",
  "UNHEALTHY",
  "BLOCKED_EXTERNAL",
] as const;
export type BackendState = (typeof BACKEND_STATES)[number];

export type BackendDependencyId =
  | "postgresql"
  | "redis"
  | "objectStore"
  | "fal"
  | "nim"
  | "gemini"
  | "google"
  | "email"
  | "mcp";

export interface BackendDependencyReport {
  id: BackendDependencyId;
  required: boolean;
  configured: boolean;
  connected: boolean;
  state: BackendState;
  latencyMs: number | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  failureClass: string | null;
}

export interface BackendRuntimeSnapshot {
  checkedAt: string;
  overall: "HEALTHY" | "DEGRADED" | "UNHEALTHY";
  ready: boolean;
  degraded: boolean;
  database: DatabaseRuntimeReport;
  dependencies: BackendDependencyReport[];
}

const lastSuccess = new Map<BackendDependencyId, string>();
const lastFailure = new Map<BackendDependencyId, string>();

function mark(id: BackendDependencyId, ok: boolean): void {
  const now = new Date().toISOString();
  if (ok) lastSuccess.set(id, now);
  else lastFailure.set(id, now);
}

function report(
  id: BackendDependencyId,
  input: Omit<BackendDependencyReport, "id" | "lastSuccessAt" | "lastFailureAt">,
): BackendDependencyReport {
  return {
    id,
    lastSuccessAt: lastSuccess.get(id) ?? null,
    lastFailureAt: lastFailure.get(id) ?? null,
    ...input,
  };
}

async function probeRedis(): Promise<BackendDependencyReport> {
  const cfg = redisConfig();
  if (!cfg) {
    return report("redis", {
      required: false, configured: false, connected: false,
      state: "UNCONFIGURED", latencyMs: null, failureClass: null,
    });
  }
  const started = Date.now();
  try {
    const ok = await redisPing();
    mark("redis", ok);
    return report("redis", {
      required: false,
      configured: true,
      connected: ok,
      state: ok ? "HEALTHY" : "DEGRADED",
      latencyMs: Date.now() - started,
      failureClass: ok ? null : "network",
    });
  } catch {
    mark("redis", false);
    return report("redis", {
      required: false, configured: true, connected: false,
      state: "DEGRADED", latencyMs: Date.now() - started, failureClass: "network",
    });
  }
}

async function probeObjectStore(): Promise<BackendDependencyReport> {
  const cfg = objectStoreConfig();
  if (!cfg) {
    return report("objectStore", {
      required: false, configured: false, connected: false,
      state: "UNCONFIGURED", latencyMs: null, failureClass: null,
    });
  }
  const started = Date.now();
  const rel = `qa/backend-doctor/${Date.now()}.txt`;
  try {
    await putObject(rel, Buffer.from("backend-doctor"), "text/plain");
    const stat = await headObject(rel);
    await deleteObject(rel);
    const ok = Boolean(stat.exists);
    mark("objectStore", ok);
    return report("objectStore", {
      required: true,
      configured: true,
      connected: ok,
      state: ok ? "HEALTHY" : "UNHEALTHY",
      latencyMs: Date.now() - started,
      failureClass: ok ? null : "query",
    });
  } catch {
    mark("objectStore", false);
    return report("objectStore", {
      required: true, configured: true, connected: false,
      state: "UNHEALTHY", latencyMs: Date.now() - started, failureClass: "network",
    });
  }
}

function configuredFlag(keys: string[], env: NodeJS.ProcessEnv): boolean {
  return keys.every((key) => Boolean(env[key]?.trim()));
}

function staticProvider(
  id: BackendDependencyId,
  required: boolean,
  configured: boolean,
  blocked = false,
): BackendDependencyReport {
  if (!configured) {
    return report(id, {
      required, configured: false, connected: false,
      state: required ? "UNHEALTHY" : "UNCONFIGURED",
      latencyMs: null, failureClass: configured ? null : "missing_url",
    });
  }
  mark(id, !blocked);
  return report(id, {
    required,
    configured: true,
    connected: !blocked,
    state: blocked ? "BLOCKED_EXTERNAL" : "HEALTHY",
    latencyMs: null,
    failureClass: blocked ? "blocked_external" : null,
  });
}

let cachedSnapshot: { at: number; value: BackendRuntimeSnapshot } | undefined;
const SNAPSHOT_TTL_MS = 15_000;

export async function getCachedBackendRuntime(env: NodeJS.ProcessEnv = process.env): Promise<BackendRuntimeSnapshot> {
  if (cachedSnapshot && Date.now() - cachedSnapshot.at < SNAPSHOT_TTL_MS) return cachedSnapshot.value;
  const value = await probeBackendRuntime(env);
  cachedSnapshot = { at: Date.now(), value };
  return value;
}

export function blockedCapabilityIds(snapshot: BackendRuntimeSnapshot): string[] {
  return Object.keys(CAPABILITY_DEPENDENCY).filter((id) => capabilityBlockedByRuntime(id, snapshot));
}

export async function probeBackendRuntime(env: NodeJS.ProcessEnv = process.env): Promise<BackendRuntimeSnapshot> {
  const [database, redis, objectStore] = await Promise.all([
    probeDatabaseRuntime(env),
    probeRedis(),
    probeObjectStore(),
  ]);
  const postgres = report("postgresql", {
    required: true,
    configured: database.configured,
    connected: database.connected,
    state: !database.configured
      ? "UNCONFIGURED"
      : !database.connected
        ? "UNHEALTHY"
        : database.schemaCompatible === false
          ? "DEGRADED"
          : "HEALTHY",
    latencyMs: database.latencyMs,
    failureClass: database.errorClass,
  });
  if (database.connected) mark("postgresql", true);
  else if (database.configured) mark("postgresql", false);

  const fal = staticProvider("fal", !isMockMode(), Boolean(env.FAL_KEY?.trim()) || isMockMode());
  const nim = staticProvider("nim", false, Boolean(env.NVIDIA_NIM_API_KEY?.trim()));
  const gemini = staticProvider("gemini", false, geminiApiKeyConfigured(env));
  const google = staticProvider("google", false, configuredFlag(["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"], env));
  const email = staticProvider("email", false, Boolean(env.RESEND_API_KEY?.trim() || env.ZSEND_API_KEY?.trim() || env.ZEABUR_EMAIL_API_KEY?.trim()));
  const mcp = staticProvider("mcp", false, Boolean(env.MCP_API_KEY?.trim()));

  const dependencies = [postgres, redis, objectStore, fal, nim, gemini, google, email, mcp];
  const optionalDown = dependencies.some((item) => !item.required && (item.state === "UNHEALTHY" || item.state === "DEGRADED"));
  const postgresDown = postgres.state === "UNHEALTHY" || postgres.state === "UNCONFIGURED";
  const storageDown = objectStore.configured && objectStore.state === "UNHEALTHY";
  const ready = !postgresDown && !storageDown && (database.schemaCompatible !== false);
  const degraded = optionalDown || database.schemaCompatible === false;
  return {
    checkedAt: new Date().toISOString(),
    overall: !ready ? "UNHEALTHY" : degraded ? "DEGRADED" : "HEALTHY",
    ready,
    degraded,
    database,
    dependencies,
  };
}

const CAPABILITY_DEPENDENCY: Partial<Record<string, BackendDependencyId>> = {
  generate_media: "fal",
  import_google_drive: "google",
  add_schedule_item: "google",
};

export function capabilityBlockedByRuntime(capabilityId: string, snapshot: BackendRuntimeSnapshot): boolean {
  const dep = CAPABILITY_DEPENDENCY[capabilityId];
  if (!dep) return false;
  const item = snapshot.dependencies.find((entry) => entry.id === dep);
  if (!item) return false;
  return item.state === "UNHEALTHY" || item.state === "UNCONFIGURED" || item.state === "BLOCKED_EXTERNAL";
}

export function formatBackendDoctor(snapshot: BackendRuntimeSnapshot): string {
  const lines = [
    `OVERALL ${snapshot.overall}`,
    `READY ${snapshot.ready ? "true" : "false"}`,
    `DEGRADED ${snapshot.degraded ? "true" : "false"}`,
    `CHECKED_AT ${snapshot.checkedAt}`,
    `PG_IDENTITY ${snapshot.database.identity.databaseIdentityHash ?? "none"}`,
    `PG_MIGRATION ${snapshot.database.identity.migrationHead ?? "none"}`,
    `PG_SCHEMA ${snapshot.database.schemaCompatible === true ? "MATCH" : snapshot.database.schemaCompatible === false ? "DRIFT" : "UNKNOWN"}`,
  ];
  for (const item of snapshot.dependencies) {
    const latency = item.latencyMs == null ? "" : ` latencyMs=${item.latencyMs}`;
    lines.push(`${item.id.toUpperCase()} ${item.state} configured=${item.configured} connected=${item.connected}${latency}`);
  }
  return lines.join("\n");
}
