/**
 * Animation temporal contracts derived from existing Scene Package, Shot Packet,
 * Canon pins and Adopted continuity state.
 *
 * This module stores no authoring truth. It only compiles bounded projections for
 * generation/evaluation. Expected story state and observed output evidence remain
 * separate so a visual judge can never rewrite Canon or script intent.
 */
import {
  inheritContinuityState,
  staleShotIdsForEntityChange,
  type ShotContinuityState,
  type ShotDependencyGraph,
  type ShotTransitionType,
} from "./shotContextPacket";
import { deriveShotEndState, type ScriptAuthorizedChange } from "./scriptChanges";
import type { ScenePackagePayload } from "./scenePackage";

export interface SequenceLockProjection {
  storySceneId: string;
  status: "ready" | "needs_confirmation" | "changed_upstream";
  scenePackageFingerprint: string | null;
  characterIds: string[];
  lookIds: string[];
  sceneId: string | null;
  propIds: string[];
  environment: Record<string, unknown> | null;
  styleCanon: { canonId: string; versionId: string } | null;
  soundWorld: { canonId: string; versionId: string } | null;
  narrativeGoal: string | null;
  /** Existing entity dependency keys; used for targeted blast radius. */
  dependencyKeys: string[];
  reasons: string[];
}

export interface TemporalShotInput {
  shotId: string;
  transitionType: ShotTransitionType;
  /** Authored/approved start facts only. Missing fields remain unknown. */
  authoredStart?: Partial<ShotContinuityState> | null;
  /** Authored/approved end facts (position, facing, pose, hand, etc.). */
  authoredEnd?: Partial<ShotContinuityState> | null;
  authorizedChanges: readonly ScriptAuthorizedChange[];
  environment: Record<string, unknown> | null;
  /**
   * Output observation is evidence only. It never feeds the next expected state
   * until a human explicitly approves/adopts it through the existing Adopt path.
   */
  observedEnd?: ShotContinuityState | null;
}

export interface TemporalShotContract {
  shotId: string;
  expectedStart: ShotContinuityState;
  expectedEnd: ShotContinuityState;
  observedEnd: ShotContinuityState | null;
  transitionType: ShotTransitionType;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

/** Sequence Lock is a projection over the immutable Scene Package, not a second current pointer. */
export function deriveSequenceLock(input: {
  packagePayload: ScenePackagePayload;
  packageFingerprint?: string | null;
  packageStale: boolean;
}): SequenceLockProjection {
  const payload = input.packagePayload;
  const reasons: string[] = [];
  if (!payload.location) reasons.push("場景身份尚未確認");
  if (!payload.activeCharacters.length) reasons.push("場內角色尚未確認");
  if (!payload.narrativeGoal) reasons.push("本場敘事目標尚未確認");

  const dependencyKeys = unique([
    ...(payload.location ? [`${payload.location.kind}:${payload.location.id}`] : []),
    ...payload.activeCharacters.map((row) => `${row.kind}:${row.id}`),
    ...payload.activeLooks.map((row) => `${row.kind}:${row.id}`),
    ...payload.props.map((row) => `${row.kind}:${row.id}`),
    ...(payload.sceneCanon ? [`canon:${payload.sceneCanon.canonId}`] : []),
    ...(payload.styleCanon ? [`canon:${payload.styleCanon.canonId}`] : []),
    ...(payload.soundWorld.canonId ? [`canon:${payload.soundWorld.canonId}`] : []),
  ]);

  return {
    storySceneId: payload.storySceneId,
    status: input.packageStale
      ? "changed_upstream"
      : reasons.length
        ? "needs_confirmation"
        : "ready",
    scenePackageFingerprint: input.packageFingerprint ?? null,
    characterIds: unique(payload.activeCharacters.map((row) => row.id)),
    lookIds: unique(payload.activeLooks.map((row) => row.id)),
    sceneId: payload.location?.id ?? null,
    propIds: unique(payload.props.map((row) => row.id)),
    environment: payload.environment,
    styleCanon: payload.styleCanon ?? null,
    soundWorld: payload.soundWorld.canonId && payload.soundWorld.canonVersionId
      ? { canonId: payload.soundWorld.canonId, versionId: payload.soundWorld.canonVersionId }
      : null,
    narrativeGoal: payload.narrativeGoal,
    dependencyKeys,
    reasons: input.packageStale ? ["上游設定已變更"] : reasons,
  };
}

/**
 * Compile expected state across a sequence.
 *
 * The previous expected end feeds the next expected start. Observations stay
 * attached to their shot and never mutate the next shot automatically.
 */
export function compileTemporalSequence(
  shots: readonly TemporalShotInput[],
  adoptedEntryState: ShotContinuityState | null = null,
): TemporalShotContract[] {
  const contracts: TemporalShotContract[] = [];
  let previousExpectedEnd = adoptedEntryState;
  for (const shot of shots) {
    const authoredStart = {
      ...(shot.authoredStart ?? {}),
      environment: shot.authoredStart?.environment ?? shot.environment,
    };
    const expectedStart = inheritContinuityState(
      previousExpectedEnd,
      authoredStart,
      shot.transitionType,
    );
    const changed = deriveShotEndState({
      currentStart: expectedStart,
      authorizedChanges: shot.authorizedChanges,
      environment: shot.environment,
    });
    const expectedEnd = inheritContinuityState(changed, shot.authoredEnd, "cut");
    contracts.push({
      shotId: shot.shotId,
      expectedStart,
      expectedEnd,
      observedEnd: shot.observedEnd ?? null,
      transitionType: shot.transitionType,
    });
    previousExpectedEnd = expectedEnd;
  }
  return contracts;
}

/** Existing packet dependency graph remains the only targeted-stale truth. */
export function temporalImpactShotIds(
  graphs: readonly ShotDependencyGraph[],
  changed: { kind: string; id: string },
): string[] {
  return staleShotIdsForEntityChange(graphs, changed);
}

