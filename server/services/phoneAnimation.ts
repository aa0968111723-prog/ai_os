/**
 * Phone Animation Production adapter.
 *
 * Reads the existing Production Board / targeted repair planner and projects
 * a compact phone payload. No second board, no second planner, no writes.
 */
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, schema } from "../db";
import type { AuthState } from "./auth";
import { animationProductionBoard, type AnimationBoardRow } from "./animationBoard";
import { targetedAnimationRepairPlan } from "./animationPipeline";
import { loadQuotaConfig } from "./points";
import { getModel } from "../../shared/models";
import { capabilityForModel } from "../../shared/providerCapabilities";
import {
  PHONE_REPAIR_KEYFRAME_MODEL_ID,
  PHONE_REPAIR_VIDEO_MODEL_ID,
  collectPhoneFindings,
  derivePhoneRepairResume,
  filterPhoneFindings,
  projectPhoneAnimationSummary,
  projectPhoneCompareQueue,
  projectPhoneRepairProposal,
  resolvePhoneRepairTargets,
  type PhoneAnimationBoardInput,
  type PhoneAnimationBoardShot,
  type PhoneAnimationFinding,
  type PhoneAnimationSummary,
  type PhoneCompareItem,
  type PhoneDimensionFilter,
  type PhoneRepairProposalView,
  type PhoneRepairResume,
} from "../../shared/phoneAnimationProjection";
import type { EvaluationConfidence } from "../../shared/animationEvaluation";
import type { AnimationEvaluationDimension } from "../../shared/animationEvaluation";

function toPhoneShot(row: AnimationBoardRow): PhoneAnimationBoardShot {
  return {
    shotId: row.shotId,
    orderIndex: row.orderIndex,
    title: row.title,
    lifecycle: row.lifecycle,
    needsReview: row.needsReview,
    stale: row.stale,
    visualCheckStatus: row.visualCheckStatus,
    currentKind: row.current?.kind ?? null,
    candidate: row.candidate,
    current: row.current,
    nextAction: row.nextAction,
    findings: row.findings.map((finding) => ({
      code: finding.code,
      dimension: finding.dimension as AnimationEvaluationDimension,
      severity: finding.severity as PhoneAnimationFinding["severity"],
      confidence: finding.confidence as EvaluationConfidence,
      reason: finding.reason,
      evidenceSourceIds: finding.evidenceSourceIds,
      ...(finding.repairHint ? { repairHint: finding.repairHint } : {}),
    })),
  };
}

function boardInput(
  projectId: string,
  board: Awaited<ReturnType<typeof animationProductionBoard>>,
): PhoneAnimationBoardInput {
  const rows = board.rows.map(toPhoneShot);
  return {
    projectId,
    rows,
    reviewQueue: board.reviewQueue.map(toPhoneShot),
    primaryAction: board.primaryAction,
    summary: board.summary,
  };
}

export async function loadPhoneAnimationBoard(input: {
  auth: AuthState;
  projectId: string;
  onQuery?: (label: string) => void;
}): Promise<PhoneAnimationBoardInput> {
  const board = await animationProductionBoard(input);
  return boardInput(input.projectId, board);
}

export async function phoneAnimationSummary(input: {
  auth: AuthState;
  projectId: string;
  selectedShotId?: string;
  onQuery?: (label: string) => void;
}): Promise<PhoneAnimationSummary> {
  const board = await loadPhoneAnimationBoard(input);
  return projectPhoneAnimationSummary(board, { selectedShotId: input.selectedShotId });
}

export async function phoneAnimationFindings(input: {
  auth: AuthState;
  projectId: string;
  selectedShotId?: string;
  include?: PhoneDimensionFilter["include"];
  exclude?: PhoneDimensionFilter["exclude"];
  onQuery?: (label: string) => void;
}): Promise<{ summary: PhoneAnimationSummary; findings: PhoneAnimationFinding[] }> {
  const board = await loadPhoneAnimationBoard(input);
  const summary = projectPhoneAnimationSummary(board, { selectedShotId: input.selectedShotId });
  return {
    summary,
    findings: filterPhoneFindings(collectPhoneFindings(board.rows), {
      include: input.include ?? [],
      exclude: input.exclude ?? [],
    }),
  };
}

export async function phoneAnimationRepairProposal(input: {
  auth: AuthState;
  projectId: string;
  text?: string;
  selectedShotId?: string;
  shotIds?: string[];
  include?: PhoneDimensionFilter["include"];
  exclude?: PhoneDimensionFilter["exclude"];
  previousFindingKeys?: string[];
  onQuery?: (label: string) => void;
}): Promise<
  | { status: "proposal"; proposal: PhoneRepairProposalView; summary: PhoneAnimationSummary }
  | { status: "clarify"; question: string; options: Array<{ id: string; label: string }>; summary: PhoneAnimationSummary }
  | { status: "empty"; reason: string; summary: PhoneAnimationSummary }
> {
  const board = await loadPhoneAnimationBoard(input);
  const summary = projectPhoneAnimationSummary(board, { selectedShotId: input.selectedShotId });
  const findings = collectPhoneFindings(board.rows);
  const text = input.text
    ?? (input.shotIds?.length
      ? "只處理這些鏡頭"
      : input.include?.length || input.exclude?.length
        ? "規劃修復"
        : "幫我修一下");
  const filterOverride = (input.include?.length || input.exclude?.length)
    ? { include: input.include ?? [], exclude: input.exclude ?? [] }
    : undefined;
  const resolved = resolvePhoneRepairTargets({
    text,
    findings,
    shots: board.rows,
    selectedShotId: input.selectedShotId,
    previousFindingKeys: input.previousFindingKeys,
    ...(filterOverride ? { filterOverride } : {}),
  });
  if (resolved.status === "clarify") {
    return { status: "clarify", question: resolved.question, options: resolved.options, summary };
  }
  if (resolved.status === "empty") {
    return { status: "empty", reason: resolved.reason, summary };
  }
  const shotIds = input.shotIds?.length ? input.shotIds : resolved.shotIds;
  const plan = await targetedAnimationRepairPlan({
    auth: input.auth,
    projectId: input.projectId,
    shotIds,
    dimensions: resolved.dimensions,
    findingCodes: resolved.findings.map((row) => row.key.split("::")[1] ?? "").filter(Boolean),
  });
  const keyframeModel = getModel(PHONE_REPAIR_KEYFRAME_MODEL_ID);
  const videoModel = getModel(PHONE_REPAIR_VIDEO_MODEL_ID);
  const quota = await loadQuotaForProject(input.auth, input.projectId);
  const downgrades: string[] = [];
  if (keyframeModel && !capabilityForModel(keyframeModel).referenceField) {
    downgrades.push("這次可以生成，但關鍵影格模型無法使用多張一致性參考。");
  }
  if (videoModel && !capabilityForModel(videoModel).previousFrameSupport) {
    downgrades.push("這次可以生成，但模型無法使用上一鏡參考圖。連戲穩定性可能較低。");
  }
  return {
    status: "proposal",
    summary,
    proposal: projectPhoneRepairProposal({
      board,
      plan,
      findings: resolved.findings,
      approvalThreshold: quota.approvalThreshold,
      keyframeModelId: PHONE_REPAIR_KEYFRAME_MODEL_ID,
      videoModelId: PHONE_REPAIR_VIDEO_MODEL_ID,
      keyframePoints: keyframeModel?.points,
      videoPoints: videoModel?.points,
      capabilityDowngrades: downgrades,
    }),
  };
}

async function loadQuotaForProject(auth: AuthState, projectId: string) {
  const [project] = await db.select({ groupId: schema.projects.groupId })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId));
  if (!project) return { approvalThreshold: null as number | null };
  const quota = await loadQuotaConfig(auth.user.id, project.groupId).catch(() => null);
  return { approvalThreshold: quota?.approvalThreshold ?? null };
}

export async function phoneAnimationCompareQueue(input: {
  auth: AuthState;
  projectId: string;
  onQuery?: (label: string) => void;
}): Promise<{ items: PhoneCompareItem[]; summary: PhoneAnimationSummary }> {
  const board = await loadPhoneAnimationBoard(input);
  return {
    items: projectPhoneCompareQueue(board),
    summary: projectPhoneAnimationSummary(board),
  };
}

export async function phoneAnimationResume(input: {
  auth: AuthState;
  projectId: string;
  proposalShotCount?: number;
  awaitingConfirmation?: boolean;
}): Promise<PhoneRepairResume | null> {
  const [gen] = await db.select({
    awaiting: sql<number>`count(*) filter (where ${schema.generations.status} = 'awaiting_approval')`,
    running: sql<number>`count(*) filter (where ${schema.generations.status} in ('queued','running'))`,
  }).from(schema.generations).where(eq(schema.generations.projectId, input.projectId));
  const compare = await phoneAnimationCompareQueue(input);
  return derivePhoneRepairResume({
    awaitingGenerations: Number(gen?.awaiting ?? 0),
    runningGenerations: Number(gen?.running ?? 0),
    compareCount: compare.items.length,
    proposalShotCount: input.proposalShotCount,
    awaitingConfirmation: input.awaitingConfirmation,
  });
}

/** Bounded candidate-vs-current count for phone.project resume. Not per-shot N+1. */
export async function phoneProjectRepairCounts(input: {
  projectId: string;
}): Promise<{ candidateShots: number }> {
  const shots = await db.select({
    id: schema.scenes.id,
    assetId: schema.scenes.assetId,
  }).from(schema.scenes).where(and(
    eq(schema.scenes.projectId, input.projectId),
    isNull(schema.scenes.deletedAt),
  ));
  if (shots.length === 0) return { candidateShots: 0 };
  const latest = await db.selectDistinctOn(
    [schema.generations.sceneId],
    {
      id: schema.generations.id,
      sceneId: schema.generations.sceneId,
    },
  ).from(schema.generations).where(and(
    eq(schema.generations.projectId, input.projectId),
    eq(schema.generations.status, "done"),
    sql`${schema.generations.sceneId} is not null`,
  )).orderBy(schema.generations.sceneId, desc(schema.generations.updatedAt));
  const generationIds = latest.map((row) => row.id);
  if (generationIds.length === 0) return { candidateShots: 0 };
  const assets = await db.select({
    id: schema.assets.id,
    meta: schema.assets.meta,
  }).from(schema.assets).where(and(
    eq(schema.assets.projectId, input.projectId),
    isNull(schema.assets.deletedAt),
    inArray(sql<string>`${schema.assets.meta}->>'generationId'`, generationIds),
  ));
  const assetByGeneration = new Map(assets.flatMap((asset) => {
    const generationId = (asset.meta as Record<string, unknown> | null)?.generationId;
    return typeof generationId === "string" ? [[generationId, asset.id] as const] : [];
  }));
  const currentByShot = new Map(shots.map((row) => [row.id, row.assetId]));
  let candidateShots = 0;
  for (const row of latest) {
    if (!row.sceneId) continue;
    const assetId = assetByGeneration.get(row.id);
    if (assetId && assetId !== currentByShot.get(row.sceneId)) candidateShots += 1;
  }
  return { candidateShots };
}
