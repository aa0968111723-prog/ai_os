/**
 * Freeze and restore immutable Shot Context Packets.
 *
 * Historical packet rows are insert-only. Stale flags live on the head
 * pointer so a later Look change cannot rewrite a generation's packet.
 */
import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db, schema } from "../db";
import type { AuthState } from "./auth";
import { parseWorldviewSafe } from "../../shared/parseWorldviewSafe";
import {
  SHOT_CONTEXT_PACKET_SCHEMA_VERSION,
  canonicalShotContextMaterial,
  packetDependencies,
  staleShotIdsForEntityChange,
  type ShotContextPacketPayload,
} from "../../shared/shotContextPacket";
import { listStoryEntityBindings, loadCreativeContextProject } from "./storyEntityBinding";
import { buildCharacterSlots } from "../../shared/characterSlots";
import {
  deriveShotEndState,
  detectTransitionType,
  parseScriptAuthorizedChanges,
  resolvePropTransfers,
} from "../../shared/scriptChanges";
import { inheritContinuityState, type ShotContinuityState } from "../../shared/shotContextPacket";
import { capabilityForModel } from "../../shared/providerCapabilities";
import { getModel } from "../../shared/models";
import { styleCanonStyles } from "../../shared/teamCanon";

export function hashShotContextPacket(payload: ShotContextPacketPayload): string {
  return createHash("sha256").update(canonicalShotContextMaterial(payload)).digest("hex");
}

async function loadShotOrThrow(projectId: string, shotId: string) {
  const [shot] = await db.select().from(schema.scenes).where(and(
    eq(schema.scenes.id, shotId),
    eq(schema.scenes.projectId, projectId),
    isNull(schema.scenes.deletedAt),
  ));
  if (!shot) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這個分鏡" });
  return shot;
}

export async function buildShotContextPacketPayload(input: {
  auth: AuthState;
  projectId: string;
  shotId: string;
  modelId?: string | null;
}): Promise<ShotContextPacketPayload> {
  const project = await loadCreativeContextProject(input.auth, input.projectId, false);
  const shot = await loadShotOrThrow(project.id, input.shotId);
  const [story] = await db.select().from(schema.stories).where(eq(schema.stories.projectId, project.id));
  const storyScene = shot.storySceneId
    ? (await db.select().from(schema.storyScenes).where(and(
      eq(schema.storyScenes.id, shot.storySceneId),
      eq(schema.storyScenes.projectId, project.id),
    )))[0] ?? null
    : null;

  const characterIds = shot.characterIds ?? [];
  const lookIds = shot.lookIds ?? [];
  const presetIds = shot.scenePresetIds ?? [];
  const propIds = shot.propIds ?? [];

  const [characters, looks, presets, props, bindings, shots] = await Promise.all([
    characterIds.length
      ? db.select().from(schema.characters).where(and(eq(schema.characters.projectId, project.id), inArray(schema.characters.id, characterIds)))
      : Promise.resolve([]),
    lookIds.length
      ? db.select().from(schema.characterLooks).where(and(eq(schema.characterLooks.projectId, project.id), inArray(schema.characterLooks.id, lookIds)))
      : Promise.resolve([]),
    presetIds.length
      ? db.select().from(schema.scenePresets).where(and(eq(schema.scenePresets.projectId, project.id), inArray(schema.scenePresets.id, presetIds)))
      : Promise.resolve([]),
    propIds.length
      ? db.select().from(schema.props).where(and(eq(schema.props.projectId, project.id), inArray(schema.props.id, propIds)))
      : Promise.resolve([]),
    listStoryEntityBindings({ auth: input.auth, projectId: project.id }),
    db.select({
      id: schema.scenes.id,
      orderIndex: schema.scenes.orderIndex,
      assetId: schema.scenes.assetId,
    }).from(schema.scenes).where(and(eq(schema.scenes.projectId, project.id), isNull(schema.scenes.deletedAt))).orderBy(asc(schema.scenes.orderIndex)),
  ]);

  const idx = shots.findIndex((row) => row.id === shot.id);
  const worldview = parseWorldviewSafe(project.worldview);
  const locked = bindings.bindings.filter((row) => row.locked);

  // Scene Package（§6）：這場戲已凍結的脈絡（有才帶；不在讀路徑做寫入）
  const [scenePackageHead] = storyScene
    ? await db.select({
      packageId: schema.scenePackageHeads.packageId,
      fingerprint: schema.scenePackageHeads.fingerprint,
    }).from(schema.scenePackageHeads).where(eq(schema.scenePackageHeads.storySceneId, storyScene.id))
    : [];

  // 前一鏡 end-state（Adopt 時抽出）＋轉場類型 → 本鏡 start-state 繼承（§11）
  const previousShotId = idx > 0 ? shots[idx - 1]!.id : null;
  const [previousState] = previousShotId
    ? await db.select().from(schema.shotContinuityStates)
      .where(eq(schema.shotContinuityStates.shotId, previousShotId))
    : [];
  const previousShotSceneId = previousShotId
    ? (await db.select({ storySceneId: schema.scenes.storySceneId })
      .from(schema.scenes).where(eq(schema.scenes.id, previousShotId)))[0]?.storySceneId ?? null
    : null;
  const shotText = [shot.prompt, shot.action, shot.dialogue].filter(Boolean).join("\n");
  const fullChangeText = [shotText, storyScene?.storyExcerpt].filter(Boolean).join("\n");
  // closure §9：prop_transfer／prop_loss 嘗試結構化解析（唯一匹配才 resolved；歧義＝unresolved 不猜）
  const authorizedChanges = resolvePropTransfers({
    changes: parseScriptAuthorizedChanges(fullChangeText),
    shotText: fullChangeText,
    // 解析對象＝本鏡綁定的角色與道具（名稱唯一匹配；歧義＝unresolved）
    characters: characters.map((row) => ({ id: row.id, name: row.name })),
    props: props.map((row) => ({ id: row.id, name: row.name })),
  });
  const transitionType = detectTransitionType({
    shotText,
    sceneText: storyScene?.summary ?? null,
    previousStorySceneId: previousShotSceneId,
    currentStorySceneId: storyScene?.id ?? null,
  });
  const previousEnd = (previousState?.endState as ShotContinuityState | undefined) ?? null;
  const previousCurrentAssetId = idx > 0 ? shots[idx - 1]?.assetId ?? null : null;
  const [previousPacketHead] = previousShotId
    ? await db.select({ stale: schema.shotContextPacketHeads.stale })
      .from(schema.shotContextPacketHeads)
      .where(eq(schema.shotContextPacketHeads.shotId, previousShotId))
    : [];
  let previousFrameAssetId: string | null = null;
  if (previousCurrentAssetId && previousPacketHead?.stale !== true) {
    const [previousAsset] = await db.select({ kind: schema.assets.kind })
      .from(schema.assets)
      .where(and(eq(schema.assets.id, previousCurrentAssetId), isNull(schema.assets.deletedAt)));
    if (previousAsset?.kind === "image") {
      previousFrameAssetId = previousCurrentAssetId;
    } else if (previousAsset?.kind === "video") {
      const { findDerivedEndFrameAssetId } = await import("./derivedFrames");
      previousFrameAssetId = await findDerivedEndFrameAssetId({
        projectId: project.id,
        parentAssetId: previousCurrentAssetId,
      });
    }
  }
  const currentStart = inheritContinuityState(
    previousEnd,
    {
      actors: characters.map((row) => ({
        characterId: row.id,
        lookId: looks.find((look) => look.characterId === row.id)?.id ?? null,
      })),
      environment: (storyScene?.environment as Record<string, unknown> | null) ?? null,
    },
    previousShotId ? transitionType : null,
  );
  // 第一鏡沒有轉場（與既有指紋語意一致，避免無意義的整批 stale）。
  if (!previousShotId) currentStart.transitionType = null;
  const currentEnd = deriveShotEndState({
    currentStart,
    authorizedChanges,
    environment: (storyScene?.environment as Record<string, unknown> | null) ?? null,
  });

  // Character Slots（§8）：canon pin 一併帶上（跨專案追溯＋adapter 來源）
  const slotPins = characterIds.length
    ? await db.select().from(schema.projectCanonPins).where(and(
      eq(schema.projectCanonPins.projectId, project.id),
      inArray(schema.projectCanonPins.localEntityId, characterIds),
    ))
    : [];

  // closure §4–§6：project canon（style／voice／sound world）——pin 直讀，無本地卡。
  // 唯一解析器 resolveProjectCanonDefaults（§12A single truth）；rights 在消費點也守。
  const { resolveProjectCanonDefaults } = await import("./teamCanon");
  const canonDefaults = await resolveProjectCanonDefaults(project.id);
  const styleCanon = canonDefaults.styleCanon;
  // targeted stale 的關鍵（稽核修正）：聲線／聲音世界只掛在「真的用得到」的鏡上——
  // 沒有台詞的純視覺鏡不依賴旁白聲線，聲線升級不得 stale 它（§8 不得全專案 stale）
  const shotHasSpeech = Boolean(shot.voiceover?.trim() || shot.dialogue?.trim());
  const shotHasSoundIntent = Boolean(shot.ambience?.trim() || shot.music?.trim());
  const narrationVoice = shotHasSpeech && canonDefaults.narrationVoice
    ? {
      canonId: canonDefaults.narrationVoice.canonId,
      versionId: canonDefaults.narrationVoice.versionId,
      modelId: canonDefaults.narrationVoice.modelId,
      voiceId: canonDefaults.narrationVoice.voiceId,
      language: canonDefaults.narrationVoice.language,
    }
    : null;
  const soundWorld = shotHasSoundIntent ? canonDefaults.soundWorld : null;
  const voiceByCharacter = shotHasSpeech ? canonDefaults.characterVoices : new Map<string, never>();
  const styleWorldStyle = canonDefaults.styleStyles;
  const styleNegative = canonDefaults.styleNegative;
  const styleReferences = styleCanon
    ? canonDefaults.styleReferences.map((ref) => ({
      assetId: ref.assetId,
      role: "style" as const,
      priority: ref.priority,
      ownerKind: "canon",
      ownerId: styleCanon.canonId,
    }))
    : [];

  // Provider 能力（§10）：不猜——由 model.input 實際輸出推導；
  // active adapter 只在模型真的有 loras 槽、且 pinned Canon 版本帶訓練成果時標上
  const model = input.modelId ? getModel(input.modelId) : null;
  const capability = model ? capabilityForModel(model) : null;
  let activeAdapter: string | null = null;
  if (capability?.identityAdapterSupport && slotPins.length) {
    const pinnedVersionIds = slotPins.map((pin) => pin.pinnedVersionId);
    const versions = await db.select({
      id: schema.canonVersions.id,
      adapterRef: schema.canonVersions.adapterRef,
      canonId: schema.canonVersions.canonId,
    }).from(schema.canonVersions).where(inArray(schema.canonVersions.id, pinnedVersionIds));
    const withAdapter = versions.filter((row) => row.adapterRef);
    if (withAdapter.length) {
      const canonIds = withAdapter.map((row) => row.canonId);
      const canons = await db.select({
        id: schema.canonEntries.id,
        generationAllowed: schema.canonEntries.generationAllowed,
      }).from(schema.canonEntries).where(inArray(schema.canonEntries.id, canonIds));
      const allowed = new Set(canons.filter((row) => row.generationAllowed).map((row) => row.id));
      activeAdapter = withAdapter.find((row) => allowed.has(row.canonId))?.adapterRef ?? null;
    }
  }

  const assetIds = [
    ...characters.map((row) => row.referenceAssetId),
    ...looks.map((row) => row.referenceAssetId),
    ...presets.map((row) => row.referenceAssetId),
    ...props.map((row) => row.referenceAssetId),
    shot.assetId,
  ].filter((id): id is string => Boolean(id));
  const assets = assetIds.length
    ? await db.select({
      id: schema.assets.id,
      title: schema.assets.title,
      kind: schema.assets.kind,
    }).from(schema.assets).where(and(
      eq(schema.assets.projectId, project.id),
      isNull(schema.assets.deletedAt),
      inArray(schema.assets.id, assetIds),
    ))
    : [];

  const knowledge = locked.filter((row) => row.entityKind === "knowledge");
  const knowledgeRows = knowledge.length
    ? await db.select({ id: schema.knowledge.id, title: schema.knowledge.title })
      .from(schema.knowledge)
      .where(and(eq(schema.knowledge.projectId, project.id), inArray(schema.knowledge.id, knowledge.map((row) => row.entityId))))
    : [];

  return {
    schemaVersion: SHOT_CONTEXT_PACKET_SCHEMA_VERSION,
    projectId: project.id,
    storyId: story?.id ?? null,
    storyRev: story?.rev ?? null,
    storySceneId: storyScene?.id ?? null,
    storySceneRev: storyScene?.rev ?? null,
    shotId: shot.id,
    shotRev: shot.rev,
    characters: characters.map((row) => ({ kind: "character", id: row.id, rev: row.rev, name: row.name })),
    looks: looks.map((row) => ({ kind: "character_look", id: row.id, rev: row.rev, name: row.name })),
    presets: presets.map((row) => ({ kind: "scene_preset", id: row.id, rev: row.rev, name: row.name })),
    props: props.map((row) => ({
      kind: "prop", id: row.id, rev: row.rev, name: row.name,
      // 歸屬跟著走：preflight 才能驗 wrong_prop_owner（額外欄位不進 entityFingerprintKey）
      ownerKind: row.ownerKind, ownerId: row.ownerId,
    })),
    assets: assets.map((row) => ({ kind: "asset_revision", id: row.id, rev: null, name: row.title })),
    knowledge: knowledgeRows.map((row) => ({ kind: "knowledge", id: row.id, rev: null, name: row.title })),
    dataRows: [],
    environment: (storyScene?.environment as Record<string, unknown> | null) ?? null,
    visual: {
      title: shot.title,
      prompt: shot.prompt,
      action: shot.action,
      camera: (shot.camera as Record<string, unknown> | null) ?? null,
      performance: (shot.performance as Record<string, unknown> | null) ?? null,
      durationSec: shot.durationSec,
      dialogue: shot.dialogue,
      voiceover: shot.voiceover,
      ambience: shot.ambience,
      music: shot.music,
    },
    references: [
      ...characters.filter((row) => row.referenceAssetId).map((row) => ({
        assetId: row.referenceAssetId!,
        role: "identity" as const,
        priority: "PRIMARY" as const,
        ownerKind: "character",
        ownerId: row.id,
      })),
      ...looks.filter((row) => row.referenceAssetId).map((row) => ({
        assetId: row.referenceAssetId!,
        role: "look" as const,
        priority: "PRIMARY" as const,
        ownerKind: "character_look",
        ownerId: row.id,
      })),
      ...presets.filter((row) => row.referenceAssetId).map((row) => ({
        assetId: row.referenceAssetId!,
        role: "scene" as const,
        priority: "PRIMARY" as const,
        ownerKind: "scene_preset",
        ownerId: row.id,
      })),
      ...props.filter((row) => row.referenceAssetId).map((row) => ({
        assetId: row.referenceAssetId!,
        role: "prop" as const,
        priority: "PRIMARY" as const,
        ownerKind: "prop",
        ownerId: row.id,
      })),
      // closure §4：pinned Style Canon 的 rights-ready 參考（mixer 的 style 職責槽）
      ...styleReferences,
      ...(previousFrameAssetId ? [{
        assetId: previousFrameAssetId,
        role: "continuity_previous_end_frame" as const,
        priority: "SECONDARY" as const,
        ownerKind: "shot",
        ownerId: previousShotId,
      }] : []),
    ],
    continuity: {
      previousShotId,
      nextShotId: idx >= 0 && idx < shots.length - 1 ? shots[idx + 1]!.id : null,
      // §11：previousEnd（上一鏡 Adopt 抽出的 end-state）＋轉場類型 → 繼承出本鏡 start；
      // time_jump／montage 依規則解除濕度／傷勢等延續。
      // 條件性帶欄位：沒有 end-state 時 payload 形狀與 #753 一致，歷史指紋不動
      ...(previousEnd ? { previousEnd } : {}),
      currentStart,
      currentEnd,
    },
    scenePackage: scenePackageHead
      ? { packageId: scenePackageHead.packageId, fingerprint: scenePackageHead.fingerprint }
      : null,
    characterSlots: buildCharacterSlots({
      characters,
      looks,
      props,
      references: undefined, // slot 參考直接用卡片 referenceAssetId（下方 references 陣列同源）
      canonPins: slotPins
        .filter((pin) => pin.localEntityId)
        .map((pin) => ({ localEntityId: pin.localEntityId!, canonId: pin.canonId, pinnedVersionId: pin.pinnedVersionId })),
    }).slots.map((slot) => {
      // closure §5：角色聲線掛上 slot（durable voice identity；沒有聲線的 slot 形狀不變）
      const voice = voiceByCharacter.get(slot.characterId);
      return voice
        ? { ...slot, voiceCanonId: voice.canonId, voiceVersionId: voice.versionId, voiceModelId: voice.modelId, voiceId: voice.voiceId }
        : slot;
    }),
    scriptAuthorizedChanges: authorizedChanges,
    // closure §4–§6 條件欄位（null 時不進指紋素材，歷史指紋穩定）
    ...(styleCanon ? { styleCanon } : {}),
    ...(narrationVoice ? { narrationVoice } : {}),
    ...(soundWorld ? { soundWorld } : {}),
    locks: locked.map((row) => ({
      mentionKey: row.mentionKey,
      entityKind: row.entityKind,
      entityId: row.entityId,
    })),
    negativeConstraints: [
      ...parseWorldviewSafe(project.worldview).taboos,
      // Style Canon 的負向風格語彙（例：不要棚拍打光）——與 taboos 同一條負向通道
      ...(styleNegative ? [styleNegative] : []),
    ],
    // Style Canon pinned＝專案風格真相；沒有 pin 才用 worldview 即時值（single truth，不並存）
    worldStyle: styleWorldStyle ?? worldview.styles,
    provider: {
      modelId: input.modelId ?? null,
      policyVersion: "generation-command.v1",
      // §10：能力誠實標記——模型真的有對應槽才會是 true／有值
      ...(capability ? { supportsIdentityRef: capability.identityAdapterSupport } : {}),
      ...(activeAdapter ? { activeAdapter } : {}),
    },
    why: [
      ...characters.map((row) => `角色 ${row.name} 來自專案角色卡`),
      ...looks.map((row) => `造型 ${row.name} 綁在這一鏡`),
      ...props.map((row) => `道具 ${row.name} 綁在這一鏡`),
      ...(styleCanon ? ["視覺風格來自 pinned Style Canon"] : []),
      ...(narrationVoice ? ["旁白聲線來自專案聲線設定"] : []),
      ...(soundWorld ? ["聲音世界來自專案 Sound World 設定"] : []),
    ],
  };
}

export async function freezeShotContextPacket(input: {
  auth: AuthState;
  projectId: string;
  shotId: string;
  modelId?: string | null;
}): Promise<{ packetId: string; fingerprint: string; reused: boolean; stale: boolean; payload: ShotContextPacketPayload }> {
  const project = await loadCreativeContextProject(input.auth, input.projectId, true);
  const payload = await buildShotContextPacketPayload(input);
  const fingerprint = hashShotContextPacket(payload);
  const [existing] = await db.select().from(schema.shotContextPackets).where(and(
    eq(schema.shotContextPackets.shotId, input.shotId),
    eq(schema.shotContextPackets.fingerprint, fingerprint),
  )).orderBy(desc(schema.shotContextPackets.createdAt)).limit(1);

  let packetId = existing?.id;
  if (!existing) {
    const [head] = await db.select().from(schema.shotContextPacketHeads).where(eq(schema.shotContextPacketHeads.shotId, input.shotId));
    const [inserted] = await db.insert(schema.shotContextPackets).values({
      projectId: project.id,
      groupId: project.groupId,
      shotId: input.shotId,
      schemaVersion: payload.schemaVersion,
      fingerprint,
      packet: payload,
      parentPacketId: head?.packetId ?? null,
      createdBy: input.auth.user.id,
    }).returning({ id: schema.shotContextPackets.id });
    packetId = inserted.id;
  }

  await db.insert(schema.shotContextPacketHeads).values({
    shotId: input.shotId,
    projectId: project.id,
    groupId: project.groupId,
    packetId: packetId!,
    fingerprint,
    stale: false,
    staleReason: null,
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: schema.shotContextPacketHeads.shotId,
    set: {
      packetId: packetId!,
      fingerprint,
      stale: false,
      staleReason: null,
      updatedAt: new Date(),
    },
  });

  const payloadOut = existing?.packet ?? payload;
  return { packetId: packetId!, fingerprint, reused: Boolean(existing), stale: false, payload: payloadOut };
}

export async function loadShotContextPacket(input: {
  auth: AuthState;
  projectId: string;
  packetId: string;
}): Promise<{ packetId: string; fingerprint: string; payload: ShotContextPacketPayload }> {
  const project = await loadCreativeContextProject(input.auth, input.projectId, false);
  const [row] = await db.select().from(schema.shotContextPackets).where(and(
    eq(schema.shotContextPackets.id, input.packetId),
    eq(schema.shotContextPackets.projectId, project.id),
  ));
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這份分鏡脈絡包" });
  return { packetId: row.id, fingerprint: row.fingerprint, payload: row.packet };
}

export async function listShotContextPackets(input: {
  auth: AuthState;
  projectId: string;
  shotId?: string;
}) {
  const project = await loadCreativeContextProject(input.auth, input.projectId, false);
  const heads = await db.select().from(schema.shotContextPacketHeads).where(eq(schema.shotContextPacketHeads.projectId, project.id));
  const filtered = input.shotId ? heads.filter((row) => row.shotId === input.shotId) : heads;
  const packetIds = filtered.map((row) => row.packetId);
  const packets = packetIds.length
    ? await db.select().from(schema.shotContextPackets).where(inArray(schema.shotContextPackets.id, packetIds))
    : [];
  const byId = new Map(packets.map((row) => [row.id, row]));
  return filtered.map((head) => ({
    shotId: head.shotId,
    packetId: head.packetId,
    fingerprint: head.fingerprint,
    stale: head.stale,
    staleReason: head.staleReason,
    packet: byId.get(head.packetId)?.packet ?? null,
    createdAt: byId.get(head.packetId)?.createdAt ?? null,
  }));
}

export async function refreshShotContextStaleness(input: {
  auth: AuthState;
  projectId: string;
  changed?: { kind: string; id: string };
}): Promise<{ staleShotIds: string[] }> {
  const project = await loadCreativeContextProject(input.auth, input.projectId, true);
  const heads = await db.select().from(schema.shotContextPacketHeads).where(eq(schema.shotContextPacketHeads.projectId, project.id));
  if (!heads.length) return { staleShotIds: [] };
  const packets = await db.select().from(schema.shotContextPackets).where(inArray(
    schema.shotContextPackets.id,
    heads.map((row) => row.packetId),
  ));
  const byId = new Map(packets.map((row) => [row.id, row]));
  const graphs = heads.map((head) => {
    const packet = byId.get(head.packetId)?.packet;
    return packet ? packetDependencies(packet) : { shotId: head.shotId, entityKeys: [] };
  });
  const targetIds = input.changed
    ? staleShotIdsForEntityChange(graphs, input.changed)
    : heads.map((head) => head.shotId);
  const staleShotIds: string[] = [];
  for (const shotId of targetIds) {
    const current = await buildShotContextPacketPayload({
      auth: input.auth,
      projectId: project.id,
      shotId,
    });
    const fingerprint = hashShotContextPacket(current);
    const head = heads.find((row) => row.shotId === shotId);
    if (!head || head.fingerprint === fingerprint) continue;
    staleShotIds.push(shotId);
    await db.update(schema.shotContextPacketHeads).set({
      stale: true,
      staleReason: input.changed
        ? `${input.changed.kind}:${input.changed.id} 已變更`
        : "脈絡指紋已變更",
      updatedAt: new Date(),
    }).where(eq(schema.shotContextPacketHeads.shotId, shotId));
  }
  return { staleShotIds };
}
