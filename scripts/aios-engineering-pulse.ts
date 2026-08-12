/**
 * 60s engineering pulse. Updates long-run memory. No secrets.
 *
 *   npx tsx scripts/aios-engineering-pulse.ts
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { loadLocalEnv } from "../server/bootstrap/loadEnv";
import { probeDatabaseRuntime } from "../server/services/databaseRuntime";
import { runAgentDbIntegrityScan } from "../server/services/agentDbIntegrity";
import { loadGroupProjectInventory } from "../server/services/projectInventory";
import { pool } from "../server/db";

loadLocalEnv();

const STATE_PATH = process.env.LONGRUN_STATE ?? "/workspaces/ai_os/.grok/longrun/state.json";
const SOAK_REPORT = process.env.SOAK_REPORT ?? "/tmp/aios-db-soak-report.json";

interface LongrunState {
  mission: string;
  updatedAt: string;
  pulseCount: number;
  soak: Record<string, unknown>;
  database: {
    present: boolean;
    connected: boolean | null;
    identityHash: string | null;
    schemaCompatible: boolean | null;
    latencyMs: number | null;
  };
  integrity: { ok: boolean | null; critical: number | null; warnings: number | null };
  nextActions: string[];
  findings: string[];
}

function readJson(path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function pidAlive(path: string): boolean {
  try {
    const pid = Number(readFileSync(path, "utf8").trim());
    if (!pid) return false;
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const prev = (readJson(STATE_PATH) ?? {}) as Partial<LongrunState>;
const soak = readJson(SOAK_REPORT) ?? {};
const present = Boolean(process.env.DATABASE_URL);
const probe = present ? await probeDatabaseRuntime() : null;
const heavy = ((prev.pulseCount ?? 0) + 1) % 5 === 0;
let integrity = { ok: null as boolean | null, critical: null as number | null, warnings: null as number | null };
if (heavy && probe?.connected) {
  const scan = await runAgentDbIntegrityScan(15);
  integrity = { ok: scan.ok, critical: scan.criticalCount, warnings: scan.warningCount };
}
if (heavy && probe?.connected) {
  try { await loadGroupProjectInventory("00000000-0000-4000-8000-000000000000"); } catch { /* inventory probe only */ }
}

const findings: string[] = [...(prev.findings ?? [])].slice(-40);
const nextActions: string[] = [];
if (!present) nextActions.push("restore DATABASE_URL for local Agent/DB loop");
if (probe && !probe.connected) nextActions.push("repair local Postgres reachability (keepalive/aios-pg)");
if (!pidAlive("/tmp/aios-soak/db-soak-120.pid") && soak.pass !== true) {
  nextActions.push("restart 24h soak via agent-db-soak-loop.sh");
  findings.push(`${new Date().toISOString()} soak process missing`);
}
if (integrity.ok === false) nextActions.push("inspect Agent DB integrity critical findings");
if (nextActions.length === 0) nextActions.push("keep Agent↔PostgreSQL soak running; hunt inventory/source/false-completion gaps");

const state: LongrunState = {
  mission: "24h high-pressure Agent↔PostgreSQL closed loop",
  updatedAt: new Date().toISOString(),
  pulseCount: (prev.pulseCount ?? 0) + 1,
  soak: {
    pass: soak.pass ?? null,
    ticks: soak.ticks ?? null,
    writes: soak.writes ?? null,
    readBacks: soak.readBacks ?? null,
    elapsedMs: soak.elapsedMs ?? soak.wallClockMs ?? null,
    targetMs: soak.targetMs ?? 86_400_000,
    processAlive: pidAlive("/tmp/aios-soak/db-soak-120.pid"),
  },
  database: {
    present,
    connected: probe?.connected ?? null,
    identityHash: probe?.identity.databaseIdentityHash ?? null,
    schemaCompatible: probe?.schemaCompatible ?? null,
    latencyMs: probe?.latencyMs ?? null,
  },
  integrity,
  nextActions,
  findings,
};

mkdirSync(dirname(STATE_PATH), { recursive: true });
writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
console.log(`PULSE ${state.pulseCount} db=${state.database.connected} soakAlive=${state.soak.processAlive} next=${nextActions[0]}`);
await pool.end().catch(() => undefined);
if (!existsSync("/workspaces/ai_os/.grok/longrun/MEMORY.md")) process.exitCode = 1;
