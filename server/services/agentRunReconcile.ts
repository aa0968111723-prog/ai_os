/**
 * After a studio generateInto lands, attach that generation onto any active
 * batch/agent plan for the same shot so the HUD cannot stay 「0/6 步」with a
 * 停 button and no Adopt control.
 */
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "../db";
import { applyIndependentGenerateToSteps } from "../../shared/agentRunReconcile";

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
    if (!result.changed) continue;
    // Keep run.status as-is. Flipping a running plan to waiting_confirmation
    // would make the next tick stopPendingDagSteps the remaining 5 shots.
    await db
      .update(schema.agentRuns)
      .set({
        steps: result.steps,
        updatedAt: new Date(),
      })
      .where(eq(schema.agentRuns.id, run.id));
  }
}
