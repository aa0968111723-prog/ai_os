/** Durable Intelligence Library ingestion worker. */
import { eq, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { claimAndProcessIntelligenceJob, enrollLegacyIntelligence, type IntelligenceJobOutcome } from "./intelligenceLibrary";
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
  const requestedBurst = Number(process.env.INTELLIGENCE_JOBS_PER_TICK ?? 8);
  const burst = Number.isFinite(requestedBurst) ? Math.min(32, Math.max(1, Math.floor(requestedBurst))) : 8;
  const enrolled = await enrollLegacyIntelligence(Math.max(12, burst * 3));
  const processed = await processIntelligenceJobBurst(burst);
  const [depth] = await db.select({ count: sql<number>`count(*)::int` })
    .from(schema.intelligenceProcessingJobs)
    .where(eq(schema.intelligenceProcessingJobs.status, "queued"));
  reportRunnerTick("intelligence", {
    queueDepth: Number(depth?.count ?? 0),
    inflight: processed,
    lastWork: { enrolled, processed },
  });
}

export async function processIntelligenceJobBurst(
  burst: number,
  claim: () => Promise<IntelligenceJobOutcome> = claimAndProcessIntelligenceJob,
): Promise<number> {
  let processed = 0;
  for (let index = 0; index < burst; index += 1) {
    const outcome = await claim();
    if (outcome === "idle" || outcome === "requeued") break;
    processed += 1;
  }
  return processed;
}
