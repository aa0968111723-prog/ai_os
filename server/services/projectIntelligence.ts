import { and, desc, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { resolveModel } from "./modelResolve";

export interface ProjectIntelligence {
  assets: {
    total: number;
    byKind: Record<string, number>;
    sourceReady: Record<"image" | "video" | "audio" | "zip", number>;
  };
  generations: {
    total: number;
    done: number;
    active: number;
    failed: number;
    successRate: number | null;
    recentFailures: Array<{ modelId: string; modelLabel: string; error: string }>;
  };
  agents: {
    active: number;
    waiting: number;
    failed: number;
    blockers: string[];
  };
  tasks: {
    open: number;
    urgent: number;
    overdue: number;
  };
  /** #133 PR-4：與 MCP get_project_status 同級的全貌數字——排程與筆記量（規劃器與助手共用） */
  planning: {
    notes: number;
    schedules: number;
    upcomingSchedules: number;
  };
  text: string;
}

function increment(target: Record<string, number>, key: string): void {
  target[key] = (target[key] ?? 0) + 1;
}

export function formatProjectIntelligence(
  snapshot: Omit<ProjectIntelligence, "text">,
): string {
  const kinds = Object.entries(snapshot.assets.byKind)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([kind, count]) => `${kind} ${count}`)
    .join("、") || "無";
  const sourceReady = Object.entries(snapshot.assets.sourceReady)
    .filter(([, count]) => count > 0)
    .map(([kind, count]) => `${kind} ${count}`)
    .join("、") || "無可用來源";
  const successRate = snapshot.generations.successRate === null
    ? "尚無完結資料"
    : `${Math.round(snapshot.generations.successRate * 100)}%`;
  const failures = snapshot.generations.recentFailures.length
    ? snapshot.generations.recentFailures
      .map((failure) => `${failure.modelLabel}: ${failure.error}`)
      .join("；")
    : "無";
  const blockers = snapshot.agents.blockers.length
    ? snapshot.agents.blockers.join("；")
    : "無";
  return [
    `素材：共 ${snapshot.assets.total}（${kinds}）；可作來源：${sourceReady}`,
    `生成：完成 ${snapshot.generations.done}／進行中 ${snapshot.generations.active}／失敗 ${snapshot.generations.failed}；完結成功率 ${successRate}`,
    `最近生成失敗：${failures}`,
    `代理：執行中 ${snapshot.agents.active}／等待 ${snapshot.agents.waiting}／失敗 ${snapshot.agents.failed}；阻塞：${blockers}`,
    `人員任務：未結 ${snapshot.tasks.open}／緊急 ${snapshot.tasks.urgent}／逾期 ${snapshot.tasks.overdue}`,
    `排程：共 ${snapshot.planning.schedules}（未來 ${snapshot.planning.upcomingSchedules}）；筆記：共 ${snapshot.planning.notes}`,
  ].join("\n");
}

/**
 * Shared operational snapshot for the conversational assistant and the planner.
 * It deliberately exposes compact, auditable state rather than dumping entire
 * rows or prompts into another model.
 */
export async function buildProjectIntelligence(projectId: string): Promise<ProjectIntelligence> {
  const now = new Date();
  const [
    assets,
    generationStatsRows,
    recentFailureRows,
    agentStatsRows,
    blockerRuns,
    taskStatsRows,
    noteStatsRows,
    scheduleStatsRows,
  ] = await Promise.all([
    db
      .select({
        kind: schema.assets.kind,
        storagePath: schema.assets.storagePath,
        url: schema.assets.url,
      })
      .from(schema.assets)
      .where(and(eq(schema.assets.projectId, projectId), isNull(schema.assets.deletedAt))),
    db
      .select({
        total: sql<number>`count(*)::int`,
        done: sql<number>`count(*) filter (where ${schema.generations.status} = 'done')::int`,
        active: sql<number>`count(*) filter (where ${schema.generations.status} in ('queued', 'running', 'awaiting_approval'))::int`,
        failed: sql<number>`count(*) filter (where ${schema.generations.status} = 'failed')::int`,
      })
      .from(schema.generations)
      .where(eq(schema.generations.projectId, projectId)),
    db
      .select({
        modelId: schema.generations.modelId,
        error: schema.generations.error,
      })
      .from(schema.generations)
      .where(and(
        eq(schema.generations.projectId, projectId),
        eq(schema.generations.status, "failed"),
      ))
      .orderBy(desc(schema.generations.createdAt))
      .limit(3),
    db
      .select({
        active: sql<number>`count(*) filter (where ${schema.agentRuns.status} = 'running')::int`,
        waiting: sql<number>`count(*) filter (where ${schema.agentRuns.status} = 'waiting')::int`,
        failed: sql<number>`count(*) filter (where ${schema.agentRuns.status} = 'failed')::int`,
      })
      .from(schema.agentRuns)
      .where(eq(schema.agentRuns.projectId, projectId)),
    db
      .select({
        status: schema.agentRuns.status,
        summary: schema.agentRuns.summary,
        error: schema.agentRuns.error,
      })
      .from(schema.agentRuns)
      .where(and(
        eq(schema.agentRuns.projectId, projectId),
        inArray(schema.agentRuns.status, ["waiting", "failed"]),
      ))
      .orderBy(desc(schema.agentRuns.updatedAt))
      .limit(4),
    db
      .select({
        open: sql<number>`count(*)::int`,
        urgent: sql<number>`count(*) filter (where ${schema.projectTasks.priority} = 'urgent')::int`,
        overdue: sql<number>`count(*) filter (where ${schema.projectTasks.dueAt} < ${now})::int`,
      })
      .from(schema.projectTasks)
      .where(and(
        eq(schema.projectTasks.projectId, projectId),
        notInArray(schema.projectTasks.status, ["done", "cancelled"]),
      )),
    // #133 PR-4：筆記／排程「數量」——規劃器需要全貌（清單另有 20/30 筆上限，量大時光看清單會低估）
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(schema.notes)
      .where(eq(schema.notes.projectId, projectId)),
    db
      .select({
        total: sql<number>`count(*)::int`,
        upcoming: sql<number>`count(*) filter (where ${schema.scheduleItems.startsAt} >= ${now})::int`,
      })
      .from(schema.scheduleItems)
      .where(eq(schema.scheduleItems.projectId, projectId)),
  ]);

  const byKind: Record<string, number> = {};
  const sourceReady: Record<"image" | "video" | "audio" | "zip", number> = {
    image: 0,
    video: 0,
    audio: 0,
    zip: 0,
  };
  for (const asset of assets) {
    increment(byKind, asset.kind);
    const kind = asset.kind === "doc" && /\.zip(?:$|\?)/i.test(asset.url)
      ? "zip"
      : asset.kind;
    if (kind in sourceReady && (asset.storagePath || /^https?:\/\//i.test(asset.url))) {
      sourceReady[kind as keyof typeof sourceReady] += 1;
    }
  }

  const generationStats = generationStatsRows[0] ?? { total: 0, done: 0, active: 0, failed: 0 };
  const finished = generationStats.done + generationStats.failed;
  const recentFailures = recentFailureRows.map((generation) => ({
    modelId: generation.modelId,
    modelLabel: resolveModel(generation.modelId)?.label ?? generation.modelId,
    error: (generation.error || "未提供錯誤原因").replace(/\s+/g, " ").slice(0, 180),
  }));

  const agentStats = agentStatsRows[0] ?? { active: 0, waiting: 0, failed: 0 };
  const waitingRuns = blockerRuns.filter((run) => run.status === "waiting");
  const failedRuns = blockerRuns.filter((run) => run.status === "failed");
  const blockers = [
    ...waitingRuns.slice(0, 2).map((run) => `等待：${run.summary || "需要人員處理"}`),
    ...failedRuns.slice(0, 2).map((run) => `失敗：${run.error || run.summary || "未提供原因"}`),
  ].map((text) => text.replace(/\s+/g, " ").slice(0, 220));
  const taskStats = taskStatsRows[0] ?? { open: 0, urgent: 0, overdue: 0 };

  const snapshot: Omit<ProjectIntelligence, "text"> = {
    assets: {
      total: assets.length,
      byKind,
      sourceReady,
    },
    generations: {
      total: generationStats.total,
      done: generationStats.done,
      active: generationStats.active,
      failed: generationStats.failed,
      successRate: finished > 0 ? generationStats.done / finished : null,
      recentFailures,
    },
    agents: {
      active: agentStats.active,
      waiting: agentStats.waiting,
      failed: agentStats.failed,
      blockers,
    },
    tasks: {
      open: taskStats.open,
      urgent: taskStats.urgent,
      overdue: taskStats.overdue,
    },
    planning: {
      notes: noteStatsRows[0]?.total ?? 0,
      schedules: scheduleStatsRows[0]?.total ?? 0,
      upcomingSchedules: scheduleStatsRows[0]?.upcoming ?? 0,
    },
  };
  return { ...snapshot, text: formatProjectIntelligence(snapshot) };
}
