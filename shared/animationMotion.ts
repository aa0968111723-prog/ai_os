/**
 * Provider-independent motion/physics continuity contracts.
 *
 * These checks are structural and evidence-bound. They do not claim rigid-body
 * simulation or infer hidden body state. Unknown evidence produces no blocker.
 */
import type {
  BodyPoseClass,
  ScreenDirection,
  ScreenPosition,
  ShotContinuityState,
  ShotReferenceBinding,
} from "./shotContextPacket";
import type { ProviderCapabilities } from "./providerCapabilities";
import { mixShotReferences, type ReferenceMixPlan } from "./referenceMixer";

export type MotionKind =
  | "stationary" | "walk" | "run" | "jump" | "sit" | "stand"
  | "reach" | "turn" | "fall" | "other";

export interface ShotMotionContract {
  shotId: string;
  subjects: Array<{
    characterId: string;
    startPose?: BodyPoseClass;
    endPose?: BodyPoseClass;
    startFacing?: ScreenDirection;
    endFacing?: ScreenDirection;
    movement?: MotionKind;
    movementDirection?: ScreenDirection;
    heldProps: Array<{ propId: string; hand: "left" | "right" | "both" | "unknown" }>;
    contacts: Array<{
      targetType: "prop" | "character" | "surface";
      targetId?: string;
      phase: "start" | "during" | "end";
    }>;
  }>;
  camera: {
    movement?: string;
    axisId?: string;
    screenDirectionRule?: ScreenDirection;
  };
}

export type MotionFindingCode =
  | "hand_swap_unexplained"
  | "prop_teleport"
  | "contact_missing"
  | "body_pose_jump"
  | "screen_direction_flip"
  | "axis_break_unapproved"
  | "position_jump"
  | "motion_discontinuity"
  | "velocity_direction_break"
  | "object_state_break";

export interface MotionFinding {
  code: MotionFindingCode;
  dimension: "temporal" | "physics";
  severity: "warning" | "blocker" | "unresolved";
  confidence: "high" | "medium" | "low" | "insufficient_evidence";
  reason: string;
  characterId?: string;
  propId?: string;
  evidence: string[];
}

export interface CrossShotReferencePlan {
  /** i2v consumes the previous frame through the primary source slot. */
  sourceAssetId: string | null;
  referenceMix: ReferenceMixPlan;
  trusted: boolean;
}

function handForProp(
  state: ShotContinuityState,
  characterId: string,
  propId: string,
): "left" | "right" | "both" | "unknown" | null {
  const actor = state.actors.find((row) => row.characterId === characterId);
  if (actor?.handOccupancy) {
    const left = actor.handOccupancy.left === propId;
    const right = actor.handOccupancy.right === propId;
    if (left && right) return "both";
    if (left) return "left";
    if (right) return "right";
  }
  return state.props?.find((row) =>
    row.propId === propId && row.holderCharacterId === characterId)?.heldInHand ?? null;
}

function positionJump(a: ScreenPosition | undefined, b: ScreenPosition | undefined): boolean {
  if (!a || !b || a === "unknown" || b === "unknown") return false;
  if (typeof a === "string" && typeof b === "string") {
    return (a === "left" && b === "right") || (a === "right" && b === "left");
  }
  if (typeof a === "object" && typeof b === "object") {
    return Math.hypot(a.x - b.x, a.y - b.y) > 0.55;
  }
  return false;
}

function opposite(a: ScreenDirection | undefined, b: ScreenDirection | undefined): boolean {
  return (a === "screen-left" && b === "screen-right")
    || (a === "screen-right" && b === "screen-left");
}

/** Compile only fields already present in expected state/authored camera/action. */
export function buildShotMotionContract(input: {
  shotId: string;
  expectedStart: ShotContinuityState;
  expectedEnd: ShotContinuityState;
  movementByCharacter?: Readonly<Record<string, MotionKind>>;
  movementDirectionByCharacter?: Readonly<Record<string, ScreenDirection>>;
  contactsByCharacter?: Readonly<Record<string, ShotMotionContract["subjects"][number]["contacts"]>>;
  cameraMovement?: string | null;
}): ShotMotionContract {
  return {
    shotId: input.shotId,
    subjects: input.expectedStart.actors.map((start) => {
      const end = input.expectedEnd.actors.find((row) => row.characterId === start.characterId);
      const heldProps = (input.expectedStart.props ?? [])
        .filter((row) => row.holderCharacterId === start.characterId)
        .map((row) => ({ propId: row.propId, hand: row.heldInHand ?? "unknown" }));
      return {
        characterId: start.characterId,
        ...(start.bodyPoseClass ? { startPose: start.bodyPoseClass } : {}),
        ...(end?.bodyPoseClass ? { endPose: end.bodyPoseClass } : {}),
        ...(start.facingDirection ? { startFacing: start.facingDirection } : {}),
        ...(end?.facingDirection ? { endFacing: end.facingDirection } : {}),
        ...(input.movementByCharacter?.[start.characterId]
          ? { movement: input.movementByCharacter[start.characterId] }
          : {}),
        ...(input.movementDirectionByCharacter?.[start.characterId]
          ? { movementDirection: input.movementDirectionByCharacter[start.characterId] }
          : {}),
        heldProps,
        contacts: [...(input.contactsByCharacter?.[start.characterId] ?? [])],
      };
    }),
    camera: {
      ...(input.cameraMovement ? { movement: input.cameraMovement } : {}),
      ...(input.expectedStart.spatial?.axisId ? { axisId: input.expectedStart.spatial.axisId } : {}),
      ...(input.expectedStart.spatial?.screenDirectionRule
        ? { screenDirectionRule: input.expectedStart.spatial.screenDirectionRule }
        : {}),
    },
  };
}

/**
 * Compare observed previous end and current start only when both sides contain
 * explicit evidence. A deliberate axis reset suppresses direction findings.
 */
export function evaluateMotionTransition(input: {
  previousObservedEnd: ShotContinuityState | null;
  currentObservedStart: ShotContinuityState | null;
  contract: ShotMotionContract;
  authorizedPropTransferIds?: readonly string[];
  axisResetAuthorized?: boolean;
}): MotionFinding[] {
  if (!input.previousObservedEnd || !input.currentObservedStart) return [];
  const findings: MotionFinding[] = [];
  const transfers = new Set(input.authorizedPropTransferIds ?? []);

  for (const before of input.previousObservedEnd.actors) {
    const after = input.currentObservedStart.actors.find((row) => row.characterId === before.characterId);
    if (!after) continue;

    for (const prop of input.previousObservedEnd.props ?? []) {
      if (prop.holderCharacterId !== before.characterId || transfers.has(prop.propId)) continue;
      const priorHand = handForProp(input.previousObservedEnd, before.characterId, prop.propId);
      const nextHand = handForProp(input.currentObservedStart, before.characterId, prop.propId);
      if (priorHand && nextHand && priorHand !== "unknown" && nextHand !== "unknown" && priorHand !== nextHand) {
        findings.push({
          code: "hand_swap_unexplained",
          dimension: "physics",
          severity: "blocker",
          confidence: "high",
          reason: "同一道具在相鄰鏡頭無交接／換手動作卻換了左右手",
          characterId: before.characterId,
          propId: prop.propId,
          evidence: ["previous_end.handOccupancy", "current_start.handOccupancy"],
        });
      }
    }

    if (positionJump(before.screenPosition, after.screenPosition)) {
      findings.push({
        code: "position_jump",
        dimension: "temporal",
        severity: "warning",
        confidence: "high",
        reason: "角色在相鄰鏡頭從畫面一側跳到另一側，沒有可見移動或轉場授權",
        characterId: before.characterId,
        evidence: ["previous_end.screenPosition", "current_start.screenPosition"],
      });
    }

    if (!input.axisResetAuthorized && opposite(before.facingDirection, after.facingDirection)) {
      findings.push({
        code: "screen_direction_flip",
        dimension: "temporal",
        severity: "warning",
        confidence: "high",
        reason: "既有軸線未重設，但角色螢幕方向在相鄰鏡頭反轉",
        characterId: before.characterId,
        evidence: ["previous_end.facingDirection", "current_start.facingDirection"],
      });
    }

    if (
      before.bodyPoseClass
      && after.bodyPoseClass
      && before.bodyPoseClass === "standing"
      && after.bodyPoseClass === "lying"
    ) {
      const subject = input.contract.subjects.find((row) => row.characterId === before.characterId);
      if (subject?.movement !== "fall") {
        findings.push({
          code: "body_pose_jump",
          dimension: "physics",
          severity: "warning",
          confidence: "medium",
          reason: "角色從站立直接變成躺下，動作契約沒有跌倒／躺下過程",
          characterId: before.characterId,
          evidence: ["previous_end.bodyPoseClass", "current_start.bodyPoseClass", "motion_contract"],
        });
      }
    }
  }

  for (const prior of input.previousObservedEnd.props ?? []) {
    const next = input.currentObservedStart.props?.find((row) => row.propId === prior.propId);
    if (!next || transfers.has(prior.propId)) continue;
    if (
      prior.holderCharacterId
      && next.holderCharacterId
      && prior.holderCharacterId !== next.holderCharacterId
    ) {
      findings.push({
        code: "prop_teleport",
        dimension: "temporal",
        severity: "blocker",
        confidence: "high",
        reason: "道具在相鄰鏡頭換了持有者，但腳本沒有明確交接",
        propId: prior.propId,
        evidence: ["previous_end.prop.holder", "current_start.prop.holder"],
      });
    }
  }
  return findings;
}

/**
 * Extend the existing role-aware mixer. Previous frame becomes i2v primary
 * source only for a real image-to-video capability; otherwise it uses a real
 * multi-reference field or is reported as dropped.
 */
export function planCrossShotFramePropagation(input: {
  previousFrameAssetId: string | null;
  previousFrameTrusted: boolean;
  references: readonly ShotReferenceBinding[];
  capability: ProviderCapabilities;
  characterCount: number;
}): CrossShotReferencePlan {
  const previous = input.previousFrameAssetId;
  if (!previous || !input.previousFrameTrusted) {
    const mix = mixShotReferences({
      references: input.references,
      capability: input.capability,
      characterCount: input.characterCount,
    });
    if (previous && !input.previousFrameTrusted) {
      mix.dropped.push({
        assetId: previous,
        role: "continuity_previous_frame",
        reason: "上一鏡已有已知 drift／stale finding，未當成可信連戲參考",
      });
      mix.downgrades.push({
        code: "previous_frame_untrusted",
        message: "上一鏡已有一致性問題，未把它當成下一鏡的可信參考",
      });
      mix.consistencyMode = "degraded";
    }
    return { sourceAssetId: null, referenceMix: mix, trusted: false };
  }

  if (input.capability.imageToVideo) {
    const mix = mixShotReferences({
      references: input.references.filter((row) => row.assetId !== previous),
      capability: input.capability,
      primaryAssetId: previous,
      characterCount: input.characterCount,
    });
    return { sourceAssetId: previous, referenceMix: mix, trusted: true };
  }

  const withPrevious: ShotReferenceBinding[] = [
    ...input.references,
    {
      assetId: previous,
      role: "continuity_previous_frame",
      priority: "SECONDARY",
    },
  ];
  const mix = mixShotReferences({
    references: withPrevious,
    capability: input.capability,
    characterCount: input.characterCount,
  });
  if (!input.capability.referenceField) {
    mix.downgrades.push({
      code: "previous_frame_unsupported",
      message: "此模型無法使用上一鏡參考圖",
    });
    mix.consistencyMode = "text_only";
  }
  return { sourceAssetId: null, referenceMix: mix, trusted: true };
}

