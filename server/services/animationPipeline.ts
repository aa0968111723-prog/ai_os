import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db, schema } from "../db";
import type { AuthState } from "./auth";
import { loadCreativeContextProject } from "./storyEntityBinding";
import { loadQuotaConfig } from "./points";
import { getModel } from "../../shared/models";
import { capabilityForModel } from "../../shared/providerCapabilities";
import {
  planAnimationPipeline,
  planTargetedAnimationRepair,
  type AnimationPipelinePlan,
  type AnimationRepairPlan,
} from "../../shared/animationPipeline";
import { executeGenerationCommand } from "./generationCommand";

function evaluationRecommendation(
  result: typeof schema.generationConsistencyEvaluations.$inferSelect["result"] | null,
) {
  return result?.recommendation ?? "not_checked";
}

export async function animationPipelinePlan(input: {
  auth: AuthState;
  projectId: string;
  shotId: string;
  keyframeModelId: string;
  videoModelId: string;
}): Promise<AnimationPipelinePlan> {
  const project = await loadCreativeContextProject(input.auth, input.projectId, false);
  const [shot] = await db.select({
    id: schema.scenes.id,
    assetId: schema.scenes.assetId,
  }).from(schema.scenes).where(and(
    eq(schema.scenes.id, input.shotId),
    eq(schema.scenes.projectId, project.id),
    isNull(schema.scenes.deletedAt),
  ));
  if (!shot) throw new TRPCError({ code: "NOT_FOUND", message: "找不到分鏡" });
  const [currentAsset] = shot.assetId
    ? await db.select().from(schema.assets).where(and(
      eq(schema.assets.id, shot.assetId),
      isNull(schema.assets.deletedAt),
    ))
    : [];
  let adoptedKeyframeAssetId = currentAsset?.kind === "image" ? currentAsset.id : null;
  const adoptedVideoAssetId = currentAsset?.kind === "video" ? currentAsset.id : null;
  if (adoptedVideoAssetId) {
    const [parent] = await db.select({ sourceAssetId: schema.assetRevisions.sourceAssetId })
      .from(schema.assetRevisions)
      .where(eq(schema.assetRevisions.assetId, adoptedVideoAssetId));
    if (parent) {
      const [asset] = await db.select({ id: schema.assets.id, kind: schema.assets.kind })
        .from(schema.assets).where(and(
          eq(schema.assets.id, parent.sourceAssetId),
          eq(schema.assets.projectId, project.id),
          isNull(schema.assets.deletedAt),
        ));
      if (asset?.kind === "image") adoptedKeyframeAssetId = asset.id;
    }
  }
  const [head] = await db.select({ stale: schema.shotContextPacketHeads.stale })
    .from(schema.shotContextPacketHeads)
    .where(eq(schema.shotContextPacketHeads.shotId, shot.id));
  const assetIds = [adoptedKeyframeAssetId, adoptedVideoAssetId].filter((id): id is string => Boolean(id));
  const evaluations = assetIds.length
    ? await db.select().from(schema.generationConsistencyEvaluations)
      .where(inArray(schema.generationConsistencyEvaluations.candidateAssetId, assetIds))
      .orderBy(desc(schema.generationConsistencyEvaluations.createdAt))
    : [];
  const latestFor = (assetId: string | null) =>
    assetId ? evaluations.find((row) => row.candidateAssetId === assetId)?.result ?? null : null;

  const keyframeModel = getModel(input.keyframeModelId);
  const videoModel = getModel(input.videoModelId);
  if (!keyframeModel || !videoModel) throw new TRPCError({ code: "BAD_REQUEST", message: "找不到選定模型" });
  const quota = await loadQuotaConfig(input.auth.user.id, project.groupId).catch(() => null);
  return planAnimationPipeline({
    shotId: shot.id,
    keyframeModelId: keyframeModel.id,
    keyframePoints: keyframeModel.points,
    videoModelId: videoModel.id,
    videoPoints: videoModel.points,
    adoptedKeyframeAssetId,
    keyframeStale: head?.stale ?? false,
    keyframeEvaluation: evaluationRecommendation(latestFor(adoptedKeyframeAssetId)),
    adoptedVideoAssetId,
    videoEvaluation: evaluationRecommendation(latestFor(adoptedVideoAssetId)),
    supportsKeyframeReferences: Boolean(capabilityForModel(keyframeModel).referenceField),
    supportsImageToVideo: capabilityForModel(videoModel).imageToVideo,
    approvalThreshold: quota?.approvalThreshold ?? null,
  });
}

export async function executeAnimationGenerationStage(input: {
  auth: AuthState;
  projectId: string;
  shotId: string;
  stage: "keyframe_generation" | "video_generation";
  modelId: string;
  clientRequestId: string;
  prompt?: string;
  sourceAssetId?: string;
}) {
  const project = await loadCreativeContextProject(input.auth, input.projectId, true);
  const [shot] = await db.select().from(schema.scenes).where(and(
    eq(schema.scenes.id, input.shotId),
    eq(schema.scenes.projectId, project.id),
    isNull(schema.scenes.deletedAt),
  ));
  if (!shot) throw new TRPCError({ code: "NOT_FOUND", message: "找不到分鏡" });
  const model = getModel(input.modelId);
  if (!model) throw new TRPCError({ code: "BAD_REQUEST", message: "找不到選定模型" });
  if (input.stage === "keyframe_generation" && model.kind !== "image") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "關鍵影格階段必須使用圖片模型" });
  }
  if (input.stage === "video_generation" && !capabilityForModel(model).imageToVideo) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "影片階段必須使用支援 image-to-video 的模型" });
  }
  const prompt = input.prompt?.trim() || shot.prompt?.trim();
  if (!prompt) throw new TRPCError({ code: "BAD_REQUEST", message: "分鏡還沒有生成提示詞" });

  const generation = await executeGenerationCommand({
    auth: input.auth,
    source: "web",
    id: input.clientRequestId,
    projectId: project.id,
    modelId: model.id,
    prompt,
    sceneId: shot.id,
    sourceAssetId: input.sourceAssetId,
    characterIds: shot.characterIds ?? undefined,
    scenePresetIds: shot.scenePresetIds ?? undefined,
    propIds: shot.propIds ?? undefined,
    lookIds: shot.lookIds ?? undefined,
    shotDirection: { camera: shot.camera, performance: shot.performance, action: shot.action },
    preserveScenePointer: true,
    reasonPrefix: input.stage === "keyframe_generation" ? "動畫關鍵影格" : "動畫影片",
  });
  return {
    generationId: generation.id,
    status: generation.status,
    stage: input.stage,
    candidateOnly: true,
    requiresExplicitAdopt: true,
  };
}

export async function targetedAnimationRepairPlan(input: {
  auth: AuthState;
  projectId: string;
  shotIds?: string[];
  dimensions?: AnimationRepairPlan["dimensions"];
  findingCodes?: string[];
}): Promise<AnimationRepairPlan> {
  const project = await loadCreativeContextProject(input.auth, input.projectId, false);
  const evaluations = await db.selectDistinctOn(
    [schema.generationConsistencyEvaluations.shotId],
  ).from(schema.generationConsistencyEvaluations).where(and(
    eq(schema.generationConsistencyEvaluations.projectId, project.id),
    ...(input.shotIds?.length
      ? [inArray(schema.generationConsistencyEvaluations.shotId, input.shotIds)]
      : []),
  )).orderBy(
    schema.generationConsistencyEvaluations.shotId,
    desc(schema.generationConsistencyEvaluations.createdAt),
  );
  const shotIds = [...new Set(evaluations.map((row) => row.shotId))];
  const shots = shotIds.length
    ? await db.select({
      id: schema.scenes.id,
      assetId: schema.scenes.assetId,
    }).from(schema.scenes).where(and(
      inArray(schema.scenes.id, shotIds),
      eq(schema.scenes.projectId, project.id),
      isNull(schema.scenes.deletedAt),
    ))
    : [];
  const assetIds = shots.map((row) => row.assetId).filter((id): id is string => Boolean(id));
  const assets = assetIds.length
    ? await db.select({ id: schema.assets.id, kind: schema.assets.kind })
      .from(schema.assets).where(and(
        inArray(schema.assets.id, assetIds),
        eq(schema.assets.projectId, project.id),
      ))
    : [];
  const kindByAsset = new Map(assets.map((row) => [row.id, row.kind]));
  const keyframes: Record<string, string | null> = {};
  const videos: Record<string, string | null> = {};
  for (const shot of shots) {
    const kind = shot.assetId ? kindByAsset.get(shot.assetId) : null;
    keyframes[shot.id] = kind === "image" ? shot.assetId : null;
    videos[shot.id] = kind === "video" ? shot.assetId : null;
  }
  const findings = evaluations.flatMap((row) =>
    row.result.findings
      .filter((finding) => {
        if (input.dimensions?.length && !input.dimensions.includes(finding.dimension)) return false;
        if (input.findingCodes?.length && !input.findingCodes.includes(finding.code)) return false;
        return true;
      })
      .map((finding) => ({ ...finding, shotId: row.shotId })));
  return planTargetedAnimationRepair({
    findings,
    adoptedKeyframeAssetIds: keyframes,
    adoptedVideoAssetIds: videos,
  });
}

