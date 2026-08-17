import type {
  AnimationConsistencyFinding,
  AnimationEvaluationDimension,
} from "./animationEvaluation";

export type AnimationPipelineStageKind =
  | "keyframe_generation"
  | "keyframe_visual_check"
  | "keyframe_adopt"
  | "video_generation"
  | "video_motion_check"
  | "video_adopt";

export interface AnimationPipelineStage {
  kind: AnimationPipelineStageKind;
  status: "ready" | "blocked" | "reused" | "waiting_human";
  modelId: string | null;
  estimatedPoints: number;
  paidOperation: boolean;
  reason: string;
  reuseAssetId: string | null;
}

export interface AnimationPipelinePlan {
  shotId: string;
  stages: AnimationPipelineStage[];
  totalEstimatedPoints: number;
  requiresApproval: boolean;
  capabilityDowngrades: string[];
  nextStage: AnimationPipelineStageKind | null;
}

export interface AnimationRepairPlan {
  affectedShotIds: string[];
  affectedStages: Array<"keyframe" | "video" | "evaluation">;
  dimensions: AnimationEvaluationDimension[];
  reasons: string[];
  referenceRolesToStrengthen: string[];
  projectedPaidOperations: number;
  preservedAssetIds: string[];
  requiresExplicitConfirmation: true;
}

export function planAnimationPipeline(input: {
  shotId: string;
  keyframeModelId: string;
  keyframePoints: number;
  videoModelId: string;
  videoPoints: number;
  adoptedKeyframeAssetId: string | null;
  keyframeStale: boolean;
  keyframeEvaluation: "keep" | "review" | "repair" | "block_adopt" | "not_checked";
  adoptedVideoAssetId: string | null;
  videoEvaluation: "keep" | "review" | "repair" | "block_adopt" | "not_checked";
  supportsKeyframeReferences: boolean;
  supportsImageToVideo: boolean;
  approvalThreshold: number | null;
}): AnimationPipelinePlan {
  const stages: AnimationPipelineStage[] = [];
  const downgrades: string[] = [];
  const reusableKeyframe = Boolean(input.adoptedKeyframeAssetId)
    && !input.keyframeStale
    && input.keyframeEvaluation !== "repair"
    && input.keyframeEvaluation !== "block_adopt";

  stages.push({
    kind: "keyframe_generation",
    status: reusableKeyframe ? "reused" : "ready",
    modelId: input.keyframeModelId,
    estimatedPoints: reusableKeyframe ? 0 : input.keyframePoints,
    paidOperation: !reusableKeyframe,
    reason: reusableKeyframe
      ? "沿用目前已採用且未過期的關鍵影格"
      : "需要先產生能承接 Canon／三視圖的關鍵影格候選",
    reuseAssetId: reusableKeyframe ? input.adoptedKeyframeAssetId : null,
  });
  stages.push({
    kind: "keyframe_visual_check",
    status: reusableKeyframe && input.keyframeEvaluation !== "not_checked" ? "reused" : "ready",
    modelId: null,
    estimatedPoints: 0,
    paidOperation: false,
    reason: input.keyframeEvaluation === "not_checked"
      ? "視覺一致性尚未檢查；不可顯示為通過"
      : "檢查人物、造型、場景、道具與 Style DNA",
    reuseAssetId: reusableKeyframe ? input.adoptedKeyframeAssetId : null,
  });
  stages.push({
    kind: "keyframe_adopt",
    status: reusableKeyframe ? "reused" : "waiting_human",
    modelId: null,
    estimatedPoints: 0,
    paidOperation: false,
    reason: reusableKeyframe ? "關鍵影格已由人明確採用" : "候選必須由人比較後明確採用",
    reuseAssetId: reusableKeyframe ? input.adoptedKeyframeAssetId : null,
  });

  if (!input.supportsImageToVideo) downgrades.push("選定的影片模型不支援 image-to-video");
  if (!input.supportsKeyframeReferences) downgrades.push("選定的關鍵影格模型無法使用多張一致性參考");
  const videoCanRun = reusableKeyframe && input.supportsImageToVideo;
  stages.push({
    kind: "video_generation",
    status: input.adoptedVideoAssetId && input.videoEvaluation !== "repair" && input.videoEvaluation !== "block_adopt"
      ? "reused"
      : videoCanRun
        ? "ready"
        : "blocked",
    modelId: input.videoModelId,
    estimatedPoints: input.adoptedVideoAssetId && input.videoEvaluation !== "repair" ? 0 : input.videoPoints,
    paidOperation: !(input.adoptedVideoAssetId && input.videoEvaluation !== "repair"),
    reason: videoCanRun
      ? "以已採用關鍵影格作為唯一 parent 生成影片候選"
      : "必須先明確採用關鍵影格，且模型需支援 image-to-video",
    reuseAssetId: input.adoptedVideoAssetId,
  });
  stages.push({
    kind: "video_motion_check",
    status: input.adoptedVideoAssetId && input.videoEvaluation !== "not_checked" ? "reused" : "blocked",
    modelId: null,
    estimatedPoints: 0,
    paidOperation: false,
    reason: "檢查前後鏡、持物、螢幕方向與動作連續性",
    reuseAssetId: input.adoptedVideoAssetId,
  });
  stages.push({
    kind: "video_adopt",
    status: input.adoptedVideoAssetId ? "reused" : "waiting_human",
    modelId: null,
    estimatedPoints: 0,
    paidOperation: false,
    reason: input.adoptedVideoAssetId ? "影片已由人明確採用" : "影片候選必須由人比較後明確採用",
    reuseAssetId: input.adoptedVideoAssetId,
  });

  const totalEstimatedPoints = stages.reduce((sum, stage) => sum + stage.estimatedPoints, 0);
  const next = stages.find((stage) => stage.status === "ready" || stage.status === "waiting_human");
  return {
    shotId: input.shotId,
    stages,
    totalEstimatedPoints,
    requiresApproval: input.approvalThreshold != null && totalEstimatedPoints >= input.approvalThreshold,
    capabilityDowngrades: downgrades,
    nextStage: next?.kind ?? null,
  };
}

export function planTargetedAnimationRepair(input: {
  findings: readonly (AnimationConsistencyFinding & { shotId: string })[];
  adoptedKeyframeAssetIds: Readonly<Record<string, string | null>>;
  adoptedVideoAssetIds: Readonly<Record<string, string | null>>;
}): AnimationRepairPlan {
  const affectedShotIds = [...new Set(input.findings.map((row) => row.shotId))];
  const dimensions = [...new Set(input.findings.map((row) => row.dimension))];
  const motionOnly = dimensions.length > 0 && dimensions.every((row) => row === "temporal" || row === "physics");
  const affectedStages: AnimationRepairPlan["affectedStages"] = motionOnly
    ? ["video", "evaluation"]
    : ["keyframe", "evaluation", ...(affectedShotIds.some((id) => input.adoptedVideoAssetIds[id]) ? ["video" as const] : [])];
  const roles = new Set<string>();
  for (const dimension of dimensions) {
    if (dimension === "identity") roles.add("identity");
    if (dimension === "look") roles.add("look");
    if (dimension === "scene") roles.add("scene");
    if (dimension === "prop") roles.add("prop");
    if (dimension === "style") roles.add("style");
    if (dimension === "temporal" || dimension === "physics") {
      roles.add("continuity_previous_end_frame");
    }
  }
  const preservedAssetIds = affectedShotIds.flatMap((shotId) => {
    if (motionOnly) return [input.adoptedKeyframeAssetIds[shotId]].filter((id): id is string => Boolean(id));
    return [];
  });
  return {
    affectedShotIds,
    affectedStages,
    dimensions,
    reasons: [...new Set(input.findings.map((row) => row.reason))],
    referenceRolesToStrengthen: [...roles],
    projectedPaidOperations: affectedShotIds.length * (motionOnly ? 1 : 1 + Number(affectedStages.includes("video"))),
    preservedAssetIds,
    requiresExplicitConfirmation: true,
  };
}

