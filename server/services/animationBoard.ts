import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, schema } from "../db";
import type { AuthState } from "./auth";
import { loadCreativeContextProject } from "./storyEntityBinding";
import {
  boardPrimaryAction,
  deriveAnimationShotLifecycle,
  type AnimationBoardLifecycleResult,
  type AnimationShotLifecycle,
} from "../../shared/animationBoard";

export interface AnimationBoardRow {
  shotId: string;
  orderIndex: number;
  title: string;
  lifecycle: AnimationShotLifecycle;
  needsReview: boolean;
  nextAction: AnimationBoardLifecycleResult["nextAction"];
  stale: boolean;
  reviewStatus: string | null;
  previous: { shotId: string; title: string; assetId: string; url: string } | null;
  current: { assetId: string; kind: string; url: string } | null;
  candidate: { generationId: string; assetId: string; kind: string; url: string } | null;
  next: { shotId: string; title: string; assetId: string; url: string } | null;
  findings: Array<{
    code: string;
    dimension: string;
    severity: string;
    confidence: string;
    reason: string;
    evidenceSourceIds: string[];
    repairHint?: string;
  }>;
  visualCheckStatus: "completed" | "not_checked" | "failed" | "absent";
}

/**
 * Compact bounded board projection. Query count is constant with 20/100/300 shots.
 * Raw evaluation history is not returned; only latest per shot findings.
 */
export async function animationProductionBoard(input: {
  auth: AuthState;
  projectId: string;
  /** Test/telemetry hook: records real batch queries without changing query semantics. */
  onQuery?: (label: string) => void;
}): Promise<{
  rows: AnimationBoardRow[];
  reviewQueue: AnimationBoardRow[];
  primaryAction: ReturnType<typeof boardPrimaryAction>;
  summary: { total: number; needsReview: number; complete: number };
}> {
  const project = await loadCreativeContextProject(input.auth, input.projectId, false);
  const observe = async <T>(label: string, query: Promise<T>): Promise<T> => {
    input.onQuery?.(label);
    return query;
  };
  const shots = await observe("shots", db.select({
    id: schema.scenes.id,
    orderIndex: schema.scenes.orderIndex,
    title: schema.scenes.title,
    prompt: schema.scenes.prompt,
    assetId: schema.scenes.assetId,
    reviewStatus: schema.scenes.reviewStatus,
    narrationAssetId: schema.scenes.narrationAssetId,
    ambienceAssetId: schema.scenes.ambienceAssetId,
    musicAssetId: schema.scenes.musicAssetId,
  }).from(schema.scenes).where(and(
    eq(schema.scenes.projectId, project.id),
    isNull(schema.scenes.deletedAt),
  )).orderBy(asc(schema.scenes.orderIndex)));

  const currentAssetIds = shots.map((row) => row.assetId).filter((id): id is string => Boolean(id));
  const currentAssets = currentAssetIds.length
    ? await observe("current_assets", db.select({
      id: schema.assets.id,
      kind: schema.assets.kind,
      url: schema.assets.url,
    }).from(schema.assets).where(and(
      inArray(schema.assets.id, currentAssetIds),
      eq(schema.assets.projectId, project.id),
      isNull(schema.assets.deletedAt),
    )))
    : [];
  const currentById = new Map(currentAssets.map((row) => [row.id, row]));

  const latestGenerations = await observe("latest_generations", db.selectDistinctOn(
    [schema.generations.sceneId],
    {
      id: schema.generations.id,
      sceneId: schema.generations.sceneId,
      status: schema.generations.status,
      updatedAt: schema.generations.updatedAt,
    },
  ).from(schema.generations).where(and(
    eq(schema.generations.projectId, project.id),
    eq(schema.generations.status, "done"),
    sql`${schema.generations.sceneId} is not null`,
  )).orderBy(schema.generations.sceneId, desc(schema.generations.updatedAt)));
  const generationIds = latestGenerations.map((row) => row.id);
  const candidateAssets = generationIds.length
    ? await observe("candidate_assets", db.select({
      id: schema.assets.id,
      kind: schema.assets.kind,
      url: schema.assets.url,
      meta: schema.assets.meta,
    }).from(schema.assets).where(and(
      eq(schema.assets.projectId, project.id),
      isNull(schema.assets.deletedAt),
      inArray(sql<string>`${schema.assets.meta}->>'generationId'`, generationIds),
    )))
    : [];
  const candidateByGeneration = new Map(candidateAssets.flatMap((asset) => {
    const generationId = (asset.meta as Record<string, unknown> | null)?.generationId;
    return typeof generationId === "string" ? [[generationId, asset] as const] : [];
  }));
  const latestGenerationByShot = new Map(latestGenerations.flatMap((row) =>
    row.sceneId ? [[row.sceneId, row] as const] : []));

  const latestEvaluations = await observe("latest_evaluations", db.selectDistinctOn(
    [schema.generationConsistencyEvaluations.shotId],
    {
      shotId: schema.generationConsistencyEvaluations.shotId,
      result: schema.generationConsistencyEvaluations.result,
      createdAt: schema.generationConsistencyEvaluations.createdAt,
    },
  ).from(schema.generationConsistencyEvaluations)
    .where(eq(schema.generationConsistencyEvaluations.projectId, project.id))
    .orderBy(schema.generationConsistencyEvaluations.shotId, desc(schema.generationConsistencyEvaluations.createdAt)));
  const evaluationByShot = new Map(latestEvaluations.map((row) => [row.shotId, row.result]));
  const heads = await observe("packet_heads", db.select({
    shotId: schema.shotContextPacketHeads.shotId,
    stale: schema.shotContextPacketHeads.stale,
  }).from(schema.shotContextPacketHeads).where(eq(schema.shotContextPacketHeads.projectId, project.id)));
  const staleByShot = new Map(heads.map((row) => [row.shotId, row.stale]));

  const rows: AnimationBoardRow[] = shots.map((shot, index) => {
    const current = shot.assetId ? currentById.get(shot.assetId) ?? null : null;
    const generation = latestGenerationByShot.get(shot.id) ?? null;
    const candidate = generation ? candidateByGeneration.get(generation.id) ?? null : null;
    const isCandidateDifferent = candidate && candidate.id !== current?.id;
    const evaluation = evaluationByShot.get(shot.id);
    const findings = evaluation?.findings ?? [];
    const visualCheckStatus = evaluation?.visualCheckStatus ?? "absent";
    const stale = staleByShot.get(shot.id) ?? false;
    const lifecycle = deriveAnimationShotLifecycle({
      shotId: shot.id,
      title: shot.title,
      hasPrompt: Boolean(shot.prompt?.trim()),
      currentKind: current?.kind ?? null,
      candidateKind: isCandidateDifferent ? candidate.kind : null,
      stale,
      reviewStatus: shot.reviewStatus,
      hasAudio: Boolean(shot.narrationAssetId || shot.ambienceAssetId || shot.musicAssetId),
      findings,
    });
    const neighbor = (at: number) => {
      const row = shots[at];
      if (!row?.assetId) return null;
      const asset = currentById.get(row.assetId);
      return asset ? { shotId: row.id, title: row.title, assetId: asset.id, url: asset.url } : null;
    };
    return {
      shotId: shot.id,
      orderIndex: shot.orderIndex,
      title: shot.title,
      lifecycle: lifecycle.lifecycle,
      needsReview: lifecycle.needsReview,
      nextAction: lifecycle.nextAction,
      stale,
      reviewStatus: shot.reviewStatus,
      previous: neighbor(index - 1),
      current: current ? { assetId: current.id, kind: current.kind, url: current.url } : null,
      candidate: generation && isCandidateDifferent
        ? { generationId: generation.id, assetId: candidate.id, kind: candidate.kind, url: candidate.url }
        : null,
      next: neighbor(index + 1),
      findings,
      visualCheckStatus,
    };
  });
  const reviewQueue = rows.filter((row) => row.needsReview);
  return {
    rows,
    reviewQueue,
    primaryAction: boardPrimaryAction(rows),
    summary: {
      total: rows.length,
      needsReview: reviewQueue.length,
      complete: rows.filter((row) => row.lifecycle === "complete").length,
    },
  };
}

