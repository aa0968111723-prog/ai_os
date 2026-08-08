/** Durable Intelligence Library ingestion worker. */
import { eq, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { claimAndProcessIntelligenceJob, enrollLegacyIntelligence } from "./intelligenceLibrary";
import { markRunnerStarted, reportRunnerTick } from "./runnerMetrics";
import { isShuttingDown, onShutdown, trackBackgroundTask } from "./shutdown";

const TICK_MS = 5_000;
let started = false;
let running = false;

export function startIntelligenceRunner(): void {
  if (started || isShuttingDown() || process.env.INTELLIGENCE_INGESTION_ENABLED === "0") return;
  started = true;
  markRunnerStarted("intelligence");
  const interval = setInterval(() => {
    if (running || isShuttingDown()) return;
    running = true;
    void trackBackgroundTask(tick().catch((error) => {
      console.warn("[intelligence] ingestion tick 失敗（下輪重試）：", error instanceof Error ? error.message : error);
    }).finally(() => { running = false; }));
  }, TICK_MS);
  interval.unref?.();
  onShutdown(() => clearInterval(interval));
  console.log(`[intelligence] ingestion worker 已啟動（每 ${TICK_MS / 1000} 秒）`);
}

async function tick(): Promise<void> {
  // Old resources are enrolled in tiny slices; migrations never block on a full backfill.
  const enrolled = await enrollLegacyIntelligence(9);
  const processed = await claimAndProcessIntelligenceJob();
  const [depth] = await db.select({ count: sql<number>`count(*)::int` })
    .from(schema.intelligenceProcessingJobs)
    .where(eq(schema.intelligenceProcessingJobs.status, "queued"));
  reportRunnerTick("intelligence", {
    queueDepth: Number(depth?.count ?? 0),
    inflight: processed ? 1 : 0,
    lastWork: { enrolled, processed: processed ? 1 : 0 },
  });
}
