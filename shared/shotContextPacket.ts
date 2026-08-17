/**
 * Immutable Shot Context Packet contract.
 *
 * A packet is frozen when a generation command is created. Later project
 * edits mint a new fingerprint and mark only dependent shots stale.
 * Historical packets are never mutated.
 */
import type { CharacterSlot } from "./characterSlots";
import type { ScriptAuthorizedChange } from "./scriptChanges";

export const SHOT_CONTEXT_PACKET_SCHEMA_VERSION = "shot-context-packet.v1";

export const SHOT_REFERENCE_ROLES = [
  "identity",
  "look",
  "scene",
  "prop",
  "style",
  "continuity_previous_frame",
  "continuity_previous_end_frame",
  "sequence_style_frame",
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

export const SCREEN_DIRECTIONS = [
  "screen-left", "screen-right", "toward-camera", "away", "unknown",
] as const;
export type ScreenDirection = (typeof SCREEN_DIRECTIONS)[number];

export const BODY_POSE_CLASSES = [
  "standing", "walking", "running", "sitting", "kneeling", "lying",
  "reaching", "holding", "unknown",
] as const;
export type BodyPoseClass = (typeof BODY_POSE_CLASSES)[number];

export type ScreenPosition =
  | "left"
  | "center"
  | "right"
  | "unknown"
  | { x: number; y: number };

export interface HandOccupancy {
  left: string | "empty" | "unknown";
  right: string | "empty" | "unknown";
}

export interface ShotContinuityActorState {
  characterId: string;
  lookId: string | null;
  pose?: string | null;
  emotion?: string | null;
  wetness?: string | null;
  injury?: string | null;
  heldPropId?: string | null;
  /** 動畫 production state：只在腳本／人工／核准 evidence 明確時填；未知不得猜。 */
  screenPosition?: ScreenPosition;
  facingDirection?: ScreenDirection;
  gazeTarget?: string | null;
  bodyPoseClass?: BodyPoseClass;
  handOccupancy?: HandOccupancy;
}

export interface ShotContinuityPropState {
  propId: string;
  holderCharacterId?: string | null;
  heldInHand?: "left" | "right" | "both" | "unknown";
  visibility?: "visible" | "hidden" | "lost" | "unknown";
  openness?: "open" | "closed" | "folded" | "unfolded" | "unknown";
  wetness?: "dry" | "wet" | "unknown";
  integrity?: "intact" | "damaged" | "torn" | "unknown";
  screenPosition?: ScreenPosition;
}

export interface ShotContinuitySpatialState {
  /** 只有導演明確建立或由已核准 visual evidence 確認後才填。 */
  axisId?: string | null;
  screenDirectionRule?: ScreenDirection | null;
  relativeOrdering?: Array<{
    subjectId: string;
    relation: "left_of" | "right_of" | "in_front_of" | "behind";
    objectId: string;
  }>;
}

export interface ShotContinuityState {
  actors: ShotContinuityActorState[];
  environment: Record<string, unknown> | null;
  transitionType?: ShotTransitionType | null;
  /** Prop identity 仍在既有 Prop/Canon；這裡只放跨鏡可變狀態。 */
  props?: ShotContinuityPropState[];
  spatial?: ShotContinuitySpatialState | null;
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
  /** 道具帶歸屬（§8/§9）：preflight 才能驗 wrong_prop_owner；額外欄位不進指紋 key */
  props: Array<ShotContextEntityRef & { ownerKind?: string | null; ownerId?: string | null }>;
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
  /** Scene Package（§6）：這一鏡繼承的場景凍結；舊 packet 沒有此欄（指紋不受影響） */
  scenePackage?: { packageId: string; fingerprint: string } | null;
  /** Character Slots（§8）：多角色結構化表達；舊 packet 沒有此欄 */
  characterSlots?: CharacterSlot[];
  /** 腳本明確授權的狀態改變（§11）：換裝／淋濕／道具轉手等，不得報 drift */
  scriptAuthorizedChanges?: ScriptAuthorizedChange[];
  /**
   * Style Canon（closure §4）：這一鏡凍結時 pinned 的專案風格真相。
   * 有 pin 時 worldStyle＝canon styles（取代 worldview 即時值）；舊 packet 無此欄。
   */
  styleCanon?: { canonId: string; versionId: string } | null;
  /**
   * Voice（closure §5）：旁白預設聲線（角色聲線在 characterSlots 上）。
   * 聲線是 durable identity——不是每次生成靠角色名重選 voice。
   */
  narrationVoice?: { canonId: string; versionId: string; modelId: string; voiceId: string; language: string | null } | null;
  /**
   * Sound World（closure §6）：專案級聲音世界 canon（scene package 凍結場級的份）。
   */
  soundWorld?: { canonId: string; versionId: string; ambience: string | null; music: string | null } | null;
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
    // 新欄位（PR-B）條件性納入：舊 packet 沒有這些欄位時素材不變，歷史指紋穩定
    ...(payload.scenePackage ? { scenePackage: payload.scenePackage } : {}),
    ...(payload.characterSlots?.length ? { characterSlots: payload.characterSlots } : {}),
    ...(payload.scriptAuthorizedChanges?.length
      ? { scriptAuthorizedChanges: payload.scriptAuthorizedChanges }
      : {}),
    // closure §4–§6 條件欄位：Style／Voice／Sound World canon 依賴（同樣保護歷史指紋）
    ...(payload.styleCanon ? { styleCanon: payload.styleCanon } : {}),
    ...(payload.narrationVoice ? { narrationVoice: payload.narrationVoice } : {}),
    ...(payload.soundWorld ? { soundWorld: payload.soundWorld } : {}),
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
  // closure §8：project canon（style／voice／sound world）也是依賴——canon 換版只 stale 真依賴鏡
  if (payload.styleCanon) refs.push({ kind: "canon", id: payload.styleCanon.canonId, rev: null });
  if (payload.narrationVoice) refs.push({ kind: "canon", id: payload.narrationVoice.canonId, rev: null });
  if (payload.soundWorld) refs.push({ kind: "canon", id: payload.soundWorld.canonId, rev: null });
  for (const slot of payload.characterSlots ?? []) {
    if (slot.voiceCanonId) refs.push({ kind: "canon", id: slot.voiceCanonId, rev: null });
  }
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
  const mergeById = <T extends object, K extends keyof T>(
    previous: readonly T[],
    current: readonly T[],
    key: K,
  ): T[] => {
    const byId = new Map(previous.map((row) => [String(row[key]), { ...row }]));
    for (const row of current) {
      const id = String(row[key]);
      byId.set(id, { ...byId.get(id), ...row } as T);
    }
    return [...byId.values()];
  };

  if (transitionType === "time_jump" || transitionType === "montage") {
    /*
     * 時間跳躍／蒙太奇只釋放短暫視覺與空間約束，不抹掉角色身份。
     * Look 可由 delta 明確換掉；沒有腳本授權時仍沿用。姿勢、位置、視線、
     * 手部接觸、濕度／傷勢與 prop state 都回到 unknown（省略），不得猜。
     */
    const persistentActors = (previousEnd?.actors ?? []).map((actor) => ({
      characterId: actor.characterId,
      lookId: actor.lookId,
    }));
    const actors = mergeById(
      persistentActors,
      delta?.actors ?? [],
      "characterId",
    );
    return {
      actors,
      environment: delta?.environment ?? null,
      transitionType,
      ...(delta?.props ? { props: delta.props } : {}),
      ...(delta?.spatial ? { spatial: delta.spatial } : {}),
    };
  }
  if (!previousEnd) {
    return {
      actors: delta?.actors ?? [],
      environment: delta?.environment ?? null,
      transitionType: transitionType ?? "cut",
      ...(delta?.props ? { props: delta.props } : {}),
      ...(delta?.spatial ? { spatial: delta.spatial } : {}),
    };
  }
  const actors = mergeById(previousEnd.actors, delta?.actors ?? [], "characterId");
  const props = mergeById(previousEnd.props ?? [], delta?.props ?? [], "propId");
  return {
    actors,
    environment: delta?.environment ?? previousEnd.environment,
    transitionType: transitionType ?? "cut",
    ...(props.length ? { props } : {}),
    ...((delta?.spatial ?? previousEnd.spatial)
      ? { spatial: delta?.spatial ?? previousEnd.spatial }
      : {}),
  };
}
