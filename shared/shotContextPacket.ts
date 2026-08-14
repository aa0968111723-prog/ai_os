/**
 * Immutable Shot Context Packet contract.
 *
 * A packet is frozen when a generation command is created. Later project
 * edits mint a new fingerprint and mark only dependent shots stale.
 * Historical packets are never mutated.
 */

export const SHOT_CONTEXT_PACKET_SCHEMA_VERSION = "shot-context-packet.v1";

export const SHOT_REFERENCE_ROLES = [
  "identity",
  "look",
  "scene",
  "prop",
  "style",
  "composition",
  "continuity",
] as const;
export type ShotReferenceRole = (typeof SHOT_REFERENCE_ROLES)[number];

export interface ShotReferenceBinding {
  assetId: string;
  role: ShotReferenceRole;
  priority: "PRIMARY" | "SECONDARY" | "SUPPORTING";
  ownerKind?: string | null;
  ownerId?: string | null;
}

export const SHOT_TRANSITION_TYPES = ["cut", "scene_change", "montage", "time_jump"] as const;
export type ShotTransitionType = (typeof SHOT_TRANSITION_TYPES)[number];

export interface ShotContinuityActorState {
  characterId: string;
  lookId: string | null;
  pose?: string | null;
  emotion?: string | null;
  wetness?: string | null;
  injury?: string | null;
  heldPropId?: string | null;
}

export interface ShotContinuityState {
  actors: ShotContinuityActorState[];
  environment: Record<string, unknown> | null;
  transitionType?: ShotTransitionType | null;
}

export interface ShotContextEntityRef {
  kind: string;
  id: string;
  rev: number | null;
  name?: string;
}

export interface ShotContextPacketPayload {
  schemaVersion: typeof SHOT_CONTEXT_PACKET_SCHEMA_VERSION;
  projectId: string;
  storyId: string | null;
  storyRev: number | null;
  storySceneId: string | null;
  storySceneRev: number | null;
  shotId: string;
  shotRev: number | null;
  characters: ShotContextEntityRef[];
  looks: ShotContextEntityRef[];
  presets: ShotContextEntityRef[];
  props: ShotContextEntityRef[];
  assets: ShotContextEntityRef[];
  knowledge: ShotContextEntityRef[];
  dataRows: ShotContextEntityRef[];
  environment: Record<string, unknown> | null;
  visual: {
    title: string;
    prompt: string | null;
    action: string | null;
    camera: Record<string, unknown> | null;
    performance: Record<string, unknown> | null;
    durationSec: number;
    dialogue: string | null;
    voiceover: string | null;
    ambience: string | null;
    music: string | null;
  };
  continuity: {
    previousShotId: string | null;
    nextShotId: string | null;
    previousEnd?: ShotContinuityState | null;
    currentStart?: ShotContinuityState | null;
    currentEnd?: ShotContinuityState | null;
  };
  references?: ShotReferenceBinding[];
  locks: Array<{ mentionKey: string; entityKind: string; entityId: string }>;
  negativeConstraints: string[];
  worldStyle: string[];
  provider: {
    modelId: string | null;
    policyVersion: string;
    supportsIdentityRef?: boolean;
    activeAdapter?: string | null;
  };
  why: string[];
}

export interface ShotDependencyGraph {
  shotId: string;
  entityKeys: string[];
}

export function entityFingerprintKey(ref: Pick<ShotContextEntityRef, "kind" | "id" | "rev">): string {
  return `${ref.kind}:${ref.id}@${ref.rev ?? "none"}`;
}

export function canonicalShotContextMaterial(payload: ShotContextPacketPayload): string {
  return JSON.stringify({
    schemaVersion: payload.schemaVersion,
    projectId: payload.projectId,
    storyId: payload.storyId,
    storyRev: payload.storyRev,
    storySceneId: payload.storySceneId,
    storySceneRev: payload.storySceneRev,
    shotId: payload.shotId,
    shotRev: payload.shotRev,
    characters: payload.characters.map(entityFingerprintKey).sort(),
    looks: payload.looks.map(entityFingerprintKey).sort(),
    presets: payload.presets.map(entityFingerprintKey).sort(),
    props: payload.props.map(entityFingerprintKey).sort(),
    assets: payload.assets.map(entityFingerprintKey).sort(),
    knowledge: payload.knowledge.map(entityFingerprintKey).sort(),
    dataRows: payload.dataRows.map(entityFingerprintKey).sort(),
    environment: payload.environment,
    visual: payload.visual,
    continuity: payload.continuity,
    references: payload.references ?? [],
    locks: payload.locks,
    negativeConstraints: payload.negativeConstraints,
    worldStyle: payload.worldStyle,
    provider: payload.provider,
  });
}

export function packetDependencies(payload: ShotContextPacketPayload): ShotDependencyGraph {
  const refs = [
    ...payload.characters,
    ...payload.looks,
    ...payload.presets,
    ...payload.props,
    ...payload.assets,
    ...payload.knowledge,
    ...payload.dataRows,
  ];
  if (payload.storyId) refs.push({ kind: "story", id: payload.storyId, rev: payload.storyRev });
  if (payload.storySceneId) refs.push({ kind: "scene", id: payload.storySceneId, rev: payload.storySceneRev });
  return {
    shotId: payload.shotId,
    entityKeys: [...new Set(refs.map((ref) => `${ref.kind}:${ref.id}`))].sort(),
  };
}

/**
 * A Look / Prop / Knowledge change only stales shots that actually depend
 * on that entity. Unrelated shots stay current.
 */
export function staleShotIdsForEntityChange(
  graphs: readonly ShotDependencyGraph[],
  changed: { kind: string; id: string },
): string[] {
  const key = `${changed.kind}:${changed.id}`;
  return graphs.filter((graph) => graph.entityKeys.includes(key)).map((graph) => graph.shotId);
}

export function packetsAreImmutable(previous: ShotContextPacketPayload, next: ShotContextPacketPayload): boolean {
  return JSON.stringify(previous) === JSON.stringify(next);
}

export function referenceRoleConflicts(refs: readonly ShotReferenceBinding[]): Array<{ a: ShotReferenceBinding; b: ShotReferenceBinding; reason: string }> {
  const conflicts: Array<{ a: ShotReferenceBinding; b: ShotReferenceBinding; reason: string }> = [];
  const primaries = refs.filter((ref) => ref.priority === "PRIMARY");
  for (let i = 0; i < primaries.length; i += 1) {
    for (let j = i + 1; j < primaries.length; j += 1) {
      const a = primaries[i]!;
      const b = primaries[j]!;
      if (a.role === b.role && a.assetId !== b.assetId) {
        conflicts.push({ a, b, reason: `同一職責 ${a.role} 有兩份主要參考` });
      }
    }
  }
  return conflicts;
}

export function inheritContinuityState(
  previousEnd: ShotContinuityState | null | undefined,
  delta: Partial<ShotContinuityState> | null | undefined,
  transitionType: ShotTransitionType | null | undefined,
): ShotContinuityState {
  if (transitionType === "time_jump" || transitionType === "montage") {
    return {
      actors: delta?.actors ?? [],
      environment: delta?.environment ?? null,
      transitionType,
    };
  }
  if (!previousEnd) {
    return {
      actors: delta?.actors ?? [],
      environment: delta?.environment ?? null,
      transitionType: transitionType ?? "cut",
    };
  }
  const byId = new Map(previousEnd.actors.map((actor) => [actor.characterId, actor]));
  for (const actor of delta?.actors ?? []) {
    byId.set(actor.characterId, { ...byId.get(actor.characterId), ...actor });
  }
  return {
    actors: [...byId.values()],
    environment: delta?.environment ?? previousEnd.environment,
    transitionType: transitionType ?? "cut",
  };
}
