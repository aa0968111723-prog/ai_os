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
    }).from(schema.scenes).where(and(eq(schema.scenes.projectId, project.id), isNull(schema.scenes.deletedAt))).orderBy(asc(schema.scenes.orderIndex)),
  ]);

  const idx = shots.findIndex((row) => row.id === shot.id);
  const worldview = parseWorldviewSafe(project.worldview);
  const locked = bindings.bindings.filter((row) => row.locked);

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
    props: props.map((row) => ({ kind: "prop", id: row.id, rev: row.rev, name: row.name })),
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
    continuity: {
      previousShotId: idx > 0 ? shots[idx - 1]!.id : null,
      nextShotId: idx >= 0 && idx < shots.length - 1 ? shots[idx + 1]!.id : null,
    },
    locks: locked.map((row) => ({
      mentionKey: row.mentionKey,
      entityKind: row.entityKind,
      entityId: row.entityId,
    })),
    negativeConstraints: parseWorldviewSafe(project.worldview).taboos,
    worldStyle: worldview.styles,
    provider: {
      modelId: input.modelId ?? null,
      policyVersion: "generation-command.v1",
    },
    why: [
      ...characters.map((row) => `角色 ${row.name} 來自專案角色卡`),
      ...looks.map((row) => `造型 ${row.name} 綁在這一鏡`),
      ...props.map((row) => `道具 ${row.name} 綁在這一鏡`),
    ],
  };
}

export async function freezeShotContextPacket(input: {
  auth: AuthState;
  projectId: string;
  shotId: string;
  modelId?: string | null;
}): Promise<{ packetId: string; fingerprint: string; reused: boolean; stale: boolean }> {
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

  return { packetId: packetId!, fingerprint, reused: Boolean(existing), stale: false };
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
