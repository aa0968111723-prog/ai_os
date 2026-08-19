/**
 * After a studio generateInto lands, attach that generation onto any active
 * batch/agent plan for the same shot so the HUD cannot stay 「0/6 步」with a
 * 停 button and no Adopt control.
 */
import { and, asc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db, schema } from "../db";
import {
  applyIndependentGenerateToSteps,
  discardUnstartedAwaitingApprovalAfterIndependentGenerate,
  shouldDiscardLeftoverAwaitingApprovalOnRead,
} from "../../shared/agentRunReconcile";

const ACTIVE_RUN_STATUSES = [
  "awaiting_approval",
  "running",
  "waiting",
  "waiting_confirmation",
  "waiting_user_input",
  "waiting_permission",
] as const;

export async function reconcileAgentRunsAfterSceneGenerate(input: {
  projectId: string;
  sceneId: string;
  generationId: string;
}): Promise<void> {
  const [scene] = await db
    .select({
      id: schema.scenes.id,
      orderIndex: schema.scenes.orderIndex,
      assetId: schema.scenes.assetId,
    })
    .from(schema.scenes)
    .where(and(eq(schema.scenes.id, input.sceneId), isNull(schema.scenes.deletedAt)));
  if (!scene) return;

  const siblings = await db
    .select({ id: schema.scenes.id })
    .from(schema.scenes)
    .where(and(eq(schema.scenes.projectId, input.projectId), isNull(schema.scenes.deletedAt)))
    .orderBy(asc(schema.scenes.orderIndex));
  const sceneNo = siblings.findIndex((row) => row.id === scene.id) + 1;
  if (sceneNo < 1) return;

  let adopted = false;
  if (scene.assetId) {
    const [asset] = await db
      .select({ meta: schema.assets.meta })
      .from(schema.assets)
      .where(and(eq(schema.assets.id, scene.assetId), isNull(schema.assets.deletedAt)));
    const meta = (asset?.meta ?? null) as { generationId?: string } | null;
    adopted = meta?.generationId === input.generationId;
  }

  const runs = await db
    .select({
      id: schema.agentRuns.id,
      status: schema.agentRuns.status,
      steps: schema.agentRuns.steps,
    })
    .from(schema.agentRuns)
    .where(and(
      eq(schema.agentRuns.projectId, input.projectId),
      inArray(schema.agentRuns.status, [...ACTIVE_RUN_STATUSES]),
    ));

  for (const run of runs) {
    const steps = Array.isArray(run.steps) ? run.steps : [];
    const result = applyIndependentGenerateToSteps({
      steps,
      sceneId: input.sceneId,
      sceneNo,
      generationId: input.generationId,
      adopted,
    });
    const leftover = discardUnstartedAwaitingApprovalAfterIndependentGenerate({
      status: run.status,
      steps: result.steps,
      independentGenerateLanded: true,
    });
    if (!result.changed && !leftover.discarded) continue;
    // Keep a running leftover plan's status. Only unstarted awaiting_approval
    // 6-steps are discarded so HUD cannot stay 「待你過目 · 0/6 步」.
    await db
      .update(schema.agentRuns)
      .set({
        steps: leftover.steps,
        ...(leftover.discarded ? { status: "discarded" as const } : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.agentRuns.id, run.id));
  }
}

/**
 * HUD / agentOverview / listByProject read path. A leftover 6-step
 * awaiting_approval plan that never started must not resurrect
 * 「待你過目 · 第 1 鏡… 0/6 步」after reload when studio already billed
 * a visual on that project.
 */
export async function reconcileLeftoverAwaitingApprovalOnRead(input: {
  groupId?: string;
  projectId?: string;
}): Promise<void> {
  if (!input.groupId && !input.projectId) return;
  const scope = input.projectId
    ? eq(schema.agentRuns.projectId, input.projectId)
    : eq(schema.agentRuns.groupId, input.groupId!);
  const runs = await db
    .select({
      id: schema.agentRuns.id,
      projectId: schema.agentRuns.projectId,
      status: schema.agentRuns.status,
      steps: schema.agentRuns.steps,
      createdAt: schema.agentRuns.createdAt,
    })
    .from(schema.agentRuns)
    .where(and(scope, eq(schema.agentRuns.status, "awaiting_approval")));
  if (runs.length === 0) return;

  const projectIds = [...new Set(runs.map((run) => run.projectId))];
  const latestVisuals = await db
    .select({
      projectId: schema.generations.projectId,
      latest: sql<Date>`max(${schema.generations.createdAt})`,
    })
    .from(schema.generations)
    .where(and(
      inArray(schema.generations.projectId, projectIds),
      eq(schema.generations.status, "done"),
      or(isNull(schema.generations.sceneRole), eq(schema.generations.sceneRole, "visual")),
    ))
    .groupBy(schema.generations.projectId);
  const latestByProject = new Map(latestVisuals.map((row) => [row.projectId, row.latest]));
  const currentVisuals = await db
    .select({ projectId: schema.scenes.projectId })
    .from(schema.scenes)
    .where(and(
      inArray(schema.scenes.projectId, projectIds),
      isNull(schema.scenes.deletedAt),
      isNotNull(schema.scenes.assetId),
    ))
    .groupBy(schema.scenes.projectId);
  const currentByProject = new Set(currentVisuals.map((row) => row.projectId));

  for (const run of runs) {
    const steps = Array.isArray(run.steps) ? run.steps : [];
    if (!shouldDiscardLeftoverAwaitingApprovalOnRead({
      status: run.status,
      steps,
      runCreatedAt: run.createdAt,
      latestDoneVisualAt: latestByProject.get(run.projectId) ?? null,
      hasCurrentVisual: currentByProject.has(run.projectId),
    })) continue;
    const leftover = discardUnstartedAwaitingApprovalAfterIndependentGenerate({
      status: run.status,
      steps,
      independentGenerateLanded: true,
    });
    if (!leftover.discarded) continue;
    await db
      .update(schema.agentRuns)
      .set({
        steps: leftover.steps,
        status: "discarded",
        updatedAt: new Date(),
      })
      .where(eq(schema.agentRuns.id, run.id));
  }
}

/** Adopt / 設為現用 must clear leftover 0/6「待你過目」the same way generateInto does. */
export function scheduleReconcileAfterVisualAdopt(input: {
  projectId: string;
  sceneId: string;
  generationId?: string | null;
}): void {
  void (input.generationId
    ? reconcileAgentRunsAfterSceneGenerate({
      projectId: input.projectId,
      sceneId: input.sceneId,
      generationId: input.generationId,
    })
    : reconcileLeftoverAwaitingApprovalOnRead({ projectId: input.projectId })
  ).catch((err) =>
    console.warn(
      "[agent-run] adopt reconcile failed:",
      err instanceof Error ? err.message : err,
    ),
  );
}

/**
 * generateInto / generation.retry / MCP retry_generation must clear leftover
 * 0/N「待你過目」when a replayable job lands. First-send throw skips this;
 * 重試 is the second path and used to leave the HUD parked until the 30s poll.
 */
export function scheduleReconcileAfterIndependentGenerate(input: {
  projectId: string;
  sceneId?: string | null;
  generationId: string;
}): void {
  void (input.sceneId
    ? reconcileAgentRunsAfterSceneGenerate({
      projectId: input.projectId,
      sceneId: input.sceneId,
      generationId: input.generationId,
    })
    : reconcileLeftoverAwaitingApprovalOnRead({ projectId: input.projectId })
  ).catch((err) =>
    console.warn(
      "[agent-run] generate reconcile failed:",
      err instanceof Error ? err.message : err,
    ),
  );
}
