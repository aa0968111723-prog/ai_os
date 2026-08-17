import { describe, expect, it } from "vitest";
import { planAnimationPipeline, planTargetedAnimationRepair } from "./animationPipeline";

describe("keyframe-first animation pipeline", () => {
  it("reuses a valid adopted keyframe and discloses only the video paid call", () => {
    const plan = planAnimationPipeline({
      shotId: "s1",
      keyframeModelId: "edit",
      keyframePoints: 2,
      videoModelId: "i2v",
      videoPoints: 8,
      adoptedKeyframeAssetId: "keyframe",
      keyframeStale: false,
      keyframeEvaluation: "keep",
      adoptedVideoAssetId: null,
      videoEvaluation: "not_checked",
      supportsKeyframeReferences: true,
      supportsImageToVideo: true,
      approvalThreshold: 5,
    });
    expect(plan.stages.find((row) => row.kind === "keyframe_generation")).toMatchObject({
      status: "reused",
      estimatedPoints: 0,
      reuseAssetId: "keyframe",
    });
    expect(plan.stages.find((row) => row.kind === "video_generation")).toMatchObject({
      status: "ready",
      estimatedPoints: 8,
    });
    expect(plan.totalEstimatedPoints).toBe(8);
    expect(plan.requiresApproval).toBe(true);
  });

  it("does not hide a paid cascade or run video before explicit keyframe Adopt", () => {
    const plan = planAnimationPipeline({
      shotId: "s1",
      keyframeModelId: "edit",
      keyframePoints: 2,
      videoModelId: "i2v",
      videoPoints: 8,
      adoptedKeyframeAssetId: null,
      keyframeStale: false,
      keyframeEvaluation: "not_checked",
      adoptedVideoAssetId: null,
      videoEvaluation: "not_checked",
      supportsKeyframeReferences: true,
      supportsImageToVideo: true,
      approvalThreshold: null,
    });
    expect(plan.totalEstimatedPoints).toBe(10);
    expect(plan.stages.find((row) => row.kind === "keyframe_adopt")?.status).toBe("waiting_human");
    expect(plan.stages.find((row) => row.kind === "video_generation")?.status).toBe("blocked");
    expect(plan.nextStage).toBe("keyframe_generation");
  });

  it("reports capability downgrades without silently switching models", () => {
    const plan = planAnimationPipeline({
      shotId: "s1",
      keyframeModelId: "text-only",
      keyframePoints: 1,
      videoModelId: "t2v",
      videoPoints: 3,
      adoptedKeyframeAssetId: "keyframe",
      keyframeStale: false,
      keyframeEvaluation: "review",
      adoptedVideoAssetId: null,
      videoEvaluation: "not_checked",
      supportsKeyframeReferences: false,
      supportsImageToVideo: false,
      approvalThreshold: null,
    });
    expect(plan.capabilityDowngrades).toHaveLength(2);
    expect(plan.stages.find((row) => row.kind === "video_generation")?.status).toBe("blocked");
    expect(plan.stages.find((row) => row.kind === "video_generation")?.modelId).toBe("t2v");
  });
});

describe("dimension-aware targeted repair", () => {
  it("motion-only repair preserves the adopted keyframe and regenerates video only", () => {
    const plan = planTargetedAnimationRepair({
      findings: [{
        shotId: "s2",
        code: "hand_swap_unexplained",
        dimension: "physics",
        severity: "warning",
        confidence: "high",
        reason: "左右手交換",
        evidenceSourceIds: ["prev", "candidate"],
      }],
      adoptedKeyframeAssetIds: { s2: "keyframe-s2" },
      adoptedVideoAssetIds: { s2: "video-s2" },
    });
    expect(plan.affectedShotIds).toEqual(["s2"]);
    expect(plan.affectedStages).toEqual(["video", "evaluation"]);
    expect(plan.preservedAssetIds).toEqual(["keyframe-s2"]);
    expect(plan.projectedPaidOperations).toBe(1);
  });

  it("style-only and identity-only repairs strengthen only required reference roles", () => {
    const style = planTargetedAnimationRepair({
      findings: [{
        shotId: "s1",
        code: "shading_style_drift",
        dimension: "style",
        severity: "warning",
        confidence: "high",
        reason: "陰影偏移",
        evidenceSourceIds: ["style"],
      }],
      adoptedKeyframeAssetIds: { s1: "kf" },
      adoptedVideoAssetIds: { s1: null },
    });
    expect(style.affectedStages).toEqual(["keyframe", "evaluation"]);
    expect(style.referenceRolesToStrengthen).toEqual(["style"]);

    const identity = planTargetedAnimationRepair({
      findings: [{
        shotId: "s1",
        code: "identity_drift",
        dimension: "identity",
        severity: "blocker",
        confidence: "high",
        reason: "臉部身份偏移",
        evidenceSourceIds: ["identity"],
      }],
      adoptedKeyframeAssetIds: { s1: "kf" },
      adoptedVideoAssetIds: { s1: "video" },
    });
    expect(identity.referenceRolesToStrengthen).toEqual(["identity"]);
    expect(identity.affectedStages).toEqual(["keyframe", "evaluation", "video"]);
  });

  it("never fans out to shots absent from findings", () => {
    const plan = planTargetedAnimationRepair({
      findings: [{
        shotId: "s3",
        code: "prop_detail_missing",
        dimension: "prop",
        severity: "warning",
        confidence: "medium",
        reason: "道具細節缺失",
        evidenceSourceIds: ["prop"],
      }],
      adoptedKeyframeAssetIds: { s1: "x", s2: "y", s3: "z" },
      adoptedVideoAssetIds: {},
    });
    expect(plan.affectedShotIds).toEqual(["s3"]);
    expect(plan.requiresExplicitConfirmation).toBe(true);
  });
});

