/**
 * Live PostgreSQL soak for Agent write → receipt → read-back.
 * Real wall-clock. No fake timers. Safe canary rows only.
 *
 *   SOAK_MINUTES=1440 npx tsx scripts/agent-db-soak.ts
 */
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { loadLocalEnv } from "../server/bootstrap/loadEnv";
import { db, pool, schema } from "../server/db";
import { probeDatabaseRuntime } from "../server/services/databaseRuntime";
import { runAgentDbIntegrityScan } from "../server/services/agentDbIntegrity";
import { loadGroupProjectInventory, visibleProjectsWhere } from "../server/services/projectInventory";

loadLocalEnv();

const minutes = Number(process.env.SOAK_MINUTES ?? "1440");
const tickMs = Number(process.env.SOAK_TICK_MS ?? "10000");
const targetMs = Math.max(1, Math.round(minutes * 60_000));
const reportPath = process.env.SOAK_REPORT ?? "/tmp/aios-db-soak-report.json";

if (!process.env.DATABASE_URL) {
  console.log("DATABASE_URL_PRESENT=false");
  console.log("BLOCKED_BY_EXTERNAL_DEPENDENCY=DATABASE_URL");
  process.exit(78);
}

const ownerId = randomUUID();
const groupId = randomUUID();
const projectId = randomUUID();
const archivedProjectIds = [randomUUID(), randomUUID()];
const noteId = randomUUID();
const tableId = randomUUID();
const assetId = randomUUID();
const startedAt = Date.now();
let writes = 0;
let readBacks = 0;
let probes = 0;
let integrityFails = 0;
let duplicateWrites = 0;
let falseCompletions = 0;
let sourceTruthFails = 0;

async function seed(): Promise<void> {
  await db.insert(schema.users).values({
    id: ownerId, name: "soak-canary", email: `soak-${ownerId}@example.test`, passwordHash: "x",
  });
  await db.insert(schema.projects).values([
    { id: projectId, groupId, ownerId, title: "SOAK canary — delete me", kind: "qa", platform: "internal", format: "fixture" },
    ...archivedProjectIds.map((id, i) => ({
      id, groupId, ownerId, title: `SOAK archived ${i + 1} — delete me`, kind: "qa", platform: "internal", format: "fixture", status: "archived" as const,
    })),
  ]);
  await db.insert(schema.assets).values({
    id: assetId, projectId, groupId, kind: "image", title: "soak asset", url: "/tmp/soak-canary.png",
  });
  await db.insert(schema.dataTables).values({
    id: tableId, scope: "group", groupId, name: "soak-custom-db", fields: [], agentAccess: "read", createdBy: ownerId,
  });
}

async function cleanup(): Promise<void> {
  await db.delete(schema.notes).where(eq(schema.notes.projectId, projectId)).catch(() => undefined);
  await db.delete(schema.assets).where(eq(schema.assets.id, assetId)).catch(() => undefined);
  await db.delete(schema.dataTables).where(eq(schema.dataTables.id, tableId)).catch(() => undefined);
  await db.delete(schema.projects).where(eq(schema.projects.groupId, groupId)).catch(() => undefined);
  await db.delete(schema.users).where(eq(schema.users.id, ownerId)).catch(() => undefined);
}

async function assertInventoryAndSourceTruth(): Promise<void> {
  const inventory = await loadGroupProjectInventory(groupId);
  const uiRows = await db.select({ id: schema.projects.id }).from(schema.projects).where(visibleProjectsWhere([groupId]));
  if (inventory.activeCount !== uiRows.length || inventory.activeCount !== 1 || inventory.archivedCount !== 2) {
    sourceTruthFails += 1;
    throw new Error(`INVENTORY_MISMATCH active=${inventory.activeCount} ui=${uiRows.length} archived=${inventory.archivedCount}`);
  }
  const assetRows = await db.select({ id: schema.assets.id }).from(schema.assets).where(eq(schema.assets.projectId, projectId));
  const dbRows = await db.select({ id: schema.dataRows.id }).from(schema.dataRows).where(eq(schema.dataRows.tableId, tableId));
  // Empty custom DB must not be treated as an empty asset library (1 canary asset vs 0 rows).
  if (assetRows.length === dbRows.length) {
    sourceTruthFails += 1;
    throw new Error(`SOURCE_TRUTH: project assets (${assetRows.length}) collided with custom DB rows (${dbRows.length})`);
  }
}

async function tick(index: number): Promise<void> {
  const probe = await probeDatabaseRuntime();
  probes += 1;
  if (!probe.connected) throw new Error(`db disconnected (${probe.errorClass})`);
  await Promise.all([
    pool.query("SELECT 1"),
    pool.query("SELECT count(*)::int AS n FROM projects"),
    assertInventoryAndSourceTruth(),
  ]);

  await db.insert(schema.notes).values({
    id: noteId,
    projectId,
    groupId,
    title: "soak note",
    content: `tick ${index} at ${new Date().toISOString()}`,
    createdBy: ownerId,
  }).onConflictDoUpdate({
    target: schema.notes.id,
    set: { content: `tick ${index} at ${new Date().toISOString()}`, updatedAt: new Date() },
  });
  writes += 1;

  const [row] = await db.select({ id: schema.notes.id, content: schema.notes.content })
    .from(schema.notes)
    .where(and(eq(schema.notes.id, noteId), eq(schema.notes.projectId, projectId)));
  if (!row) {
    falseCompletions += 1;
    throw new Error("FALSE_COMPLETION: write reported without read-back row");
  }
  readBacks += 1;

  const again = await db.insert(schema.notes).values({
    id: noteId,
    projectId,
    groupId,
    title: "soak note",
    content: `retry ${index}`,
    createdBy: ownerId,
  }).onConflictDoUpdate({
    target: schema.notes.id,
    set: { content: `retry ${index}`, updatedAt: new Date() },
  }).returning({ id: schema.notes.id });
  if (again.length !== 1) duplicateWrites += 1;

  if (index % 8 === 0) {
    const integrity = await runAgentDbIntegrityScan(15);
    if (!integrity.ok) integrityFails += 1;
  }
}

function persist(partial: Record<string, unknown>): void {
  writeFileSync(reportPath, JSON.stringify(partial, null, 2));
}

console.log(`DATABASE_URL_PRESENT=true SOAK_MINUTES=${minutes} TICK_MS=${tickMs}`);
await seed();
let index = 0;
try {
  while (Date.now() - startedAt < targetMs) {
    await tick(index);
    index += 1;
    persist({
      running: true,
      ticks: index,
      writes,
      readBacks,
      probes,
      integrityFails,
      duplicateWrites,
      falseCompletions,
      sourceTruthFails,
      elapsedMs: Date.now() - startedAt,
      targetMs,
    });
    const remaining = targetMs - (Date.now() - startedAt);
    if (remaining <= 0) break;
    await new Promise((resolve) => setTimeout(resolve, Math.min(tickMs, remaining)));
  }
} finally {
  await cleanup();
  await pool.end();
}

const wallClockMs = Date.now() - startedAt;
const pass = wallClockMs >= targetMs * 0.98
  && falseCompletions === 0
  && duplicateWrites === 0
  && integrityFails === 0
  && sourceTruthFails === 0
  && writes >= 2
  && readBacks === writes;
const report = {
  pass,
  wallClockMs,
  targetMs,
  ticks: index,
  writes,
  readBacks,
  probes,
  integrityFails,
  duplicateWrites,
  falseCompletions,
  sourceTruthFails,
};
persist(report);
console.log(JSON.stringify(report, null, 2));
if (!pass) process.exitCode = 2;
