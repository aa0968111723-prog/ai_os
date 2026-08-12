/**
 * Safe DATABASE_URL parse + Pool options.
 *
 * Never log the raw URL, password, or username. SSL is inferred from the
 * actual target — loopback stays cleartext; remote hosts get TLS unless the
 * operator explicitly disables it.
 */
import { createHash } from "node:crypto";
import type pg from "pg";
import { readProcessRole } from "../services/processRole";

export type HostnameKind = "loopback" | "private" | "public" | "unix" | "missing";
export type DatabaseDriver = "postgres" | "unknown" | "none";

export interface SafeDatabaseTarget {
  configured: boolean;
  driver: DatabaseDriver;
  hostnameKind: HostnameKind;
  port: number | null;
  databaseNamePresent: boolean;
  usernamePresent: boolean;
  passwordPresent: boolean;
  sslmode: string | null;
  sslRequired: boolean;
  identityHash: string | null;
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

function hostnameKind(host: string | null): HostnameKind {
  if (!host) return "missing";
  if (host.startsWith("/")) return "unix";
  const lower = host.toLowerCase();
  if (LOOPBACK.has(lower)) return "loopback";
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const [a, b] = host.split(".").map(Number);
    if (a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b !== undefined && b >= 16 && b <= 31)) {
      return "private";
    }
    return "public";
  }
  if (lower.endsWith(".local") || lower.endsWith(".internal")) return "private";
  return "public";
}

export function parseDatabaseUrl(connectionString: string | undefined | null): SafeDatabaseTarget {
  const raw = connectionString?.trim() ?? "";
  if (!raw) {
    return {
      configured: false,
      driver: "none",
      hostnameKind: "missing",
      port: null,
      databaseNamePresent: false,
      usernamePresent: false,
      passwordPresent: false,
      sslmode: null,
      sslRequired: false,
      identityHash: null,
    };
  }
  try {
    const url = new URL(raw);
    const driver: DatabaseDriver = url.protocol === "postgres:" || url.protocol === "postgresql:"
      ? "postgres"
      : "unknown";
    const sslmode = url.searchParams.get("sslmode") || url.searchParams.get("ssl") || null;
    const host = url.hostname || null;
    const kind = hostnameKind(host);
    const sslRequired = inferSslRequired(sslmode, kind, process.env);
    const databaseName = decodeURIComponent(url.pathname.replace(/^\/+/, "").split("/")[0] ?? "");
    const identitySrc = [
      url.protocol,
      host ?? "",
      url.port || "5432",
      databaseName,
      url.username || "",
      sslmode ?? "",
    ].join("|");
    return {
      configured: true,
      driver,
      hostnameKind: kind,
      port: url.port ? Number(url.port) : 5432,
      databaseNamePresent: Boolean(databaseName),
      usernamePresent: Boolean(url.username),
      passwordPresent: Boolean(url.password),
      sslmode,
      sslRequired,
      identityHash: createHash("sha256").update(identitySrc).digest("hex").slice(0, 16),
    };
  } catch {
    return {
      configured: true,
      driver: "unknown",
      hostnameKind: "missing",
      port: null,
      databaseNamePresent: false,
      usernamePresent: false,
      passwordPresent: false,
      sslmode: null,
      sslRequired: false,
      identityHash: null,
    };
  }
}

function inferSslRequired(
  sslmode: string | null,
  _kind: HostnameKind,
  env: NodeJS.ProcessEnv,
): boolean {
  const forced = (env.DATABASE_SSL ?? "").trim().toLowerCase();
  if (forced === "0" || forced === "false" || forced === "disable") return false;
  if (forced === "1" || forced === "true" || forced === "require") return true;
  const mode = (sslmode ?? env.PGSSLMODE ?? "").trim().toLowerCase();
  if (mode === "disable" || mode === "false" || mode === "0") return false;
  if (mode === "require" || mode === "verify-ca" || mode === "verify-full" || mode === "true" || mode === "1") {
    return true;
  }
  // 沒有明確 sslmode / DATABASE_SSL 時一律不強制 SSL——與 db CLI（scripts/db/cli.ts 用裸
  // connectionString）行為一致。先前對 remote host 預設強制 TLS，但 Zeabur 的 PostgreSQL
  // 接受明文連接，強制 TLS 反而在 SSL 握手立即失敗（SELECT 1 抛錯、errorClass 歸類為
  // query），造成 runtime 連不上、migration 卻成功的 website-alive/agent-blind 斷線。
  // 真正需要 TLS 的託管商（Neon / Railway 等）會在 DATABASE_URL 帶 sslmode=require，此處
  // 已在前幾行就回 true，不受影響。
  return false;
}

export function sslOptionForTarget(
  target: SafeDatabaseTarget,
  env: NodeJS.ProcessEnv = process.env,
): boolean | { rejectUnauthorized: boolean } | undefined {
  if (!target.sslRequired) return undefined;
  const mode = (target.sslmode ?? env.PGSSLMODE ?? "").trim().toLowerCase();
  if (mode === "verify-full" || mode === "verify-ca") return { rejectUnauthorized: true };
  return { rejectUnauthorized: false };
}

export function buildPoolConfig(
  connectionString: string | undefined | null,
  env: NodeJS.ProcessEnv = process.env,
): pg.PoolConfig {
  const target = parseDatabaseUrl(connectionString);
  const role = readProcessRole(env);
  const config: pg.PoolConfig = {
    connectionString: connectionString || undefined,
    max: 10,
    connectionTimeoutMillis: 15_000,
    idleTimeoutMillis: 30_000,
    allowExitOnIdle: false,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
    application_name: env.PGAPPNAME || `aios-${role}`,
  };
  const ssl = sslOptionForTarget(target, env);
  if (ssl !== undefined) config.ssl = ssl;
  return config;
}
