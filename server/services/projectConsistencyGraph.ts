/**
 * Server-side Project Consistency Graph + workspace projection.
 * UI must read this; it must not invent completeness from button clicks.
 */
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "../db";
import type { AuthState } from "./auth";
import {
  compactWorkspaceStatus,
  nextWorkspaceAction,
  visualCoverageScore,
  type ConsistencyGraphEdge,
  type ConsistencyGraphNode,
  type WorkspaceProjection,
} from "../../shared/projectConsistencyGraph";
import { pinState } from "../../shared/teamCanon";
import { deliveryBlockers } from "./consistencyAdopt";
import { listStoryEntityBindings, loadCreativeContextProject } from "./storyEntityBinding";

export async function projectWorkspaceProjection(input: {
  auth: AuthState;
  projectId: string;
}): Promise<WorkspaceProjection> {
  const project = await loadCreativeContextProject(input.auth, input.projectId, false);
  const [story] = await db.select().from(schema.stories).where(eq(schema.stories.projectId, project.id));
  const [characters, looks, presets, props, shots, assets, bindings, heads] = await Promise.all([
    db.select({ id: schema.characters.id, name: schema.characters.name, rev: schema.characters.rev, referenceAssetId: schema.characters.referenceAssetId })
      .from(schema.characters).where(eq(schema.characters.projectId, project.id)),
    db.select({ id: schema.characterLooks.id, name: schema.characterLooks.name, characterId: schema.characterLooks.characterId, rev: schema.characterLooks.rev, referenceAssetId: schema.characterLooks.referenceAssetId })
      .from(schema.characterLooks).where(eq(schema.characterLooks.projectId, project.id)),
    db.select({ id: schema.scenePresets.id, name: schema.scenePresets.name, rev: schema.scenePresets.rev, referenceAssetId: schema.scenePresets.referenceAssetId })
      .from(schema.scenePresets).where(eq(schema.scenePresets.projectId, project.id)),
    db.select({ id: schema.props.id, name: schema.props.name, rev: schema.props.rev, ownerId: schema.props.ownerId, ownerKind: schema.props.ownerKind, referenceAssetId: schema.props.referenceAssetId })
      .from(schema.props).where(eq(schema.props.projectId, project.id)),
    db.select({
      id: schema.scenes.id,
      title: schema.scenes.title,
      rev: schema.scenes.rev,
      prompt: schema.scenes.prompt,
      assetId: schema.scenes.assetId,
      reviewStatus: schema.scenes.reviewStatus,
    }).from(schema.scenes).where(and(eq(schema.scenes.projectId, project.id), isNull(schema.scenes.deletedAt))).orderBy(asc(schema.scenes.orderIndex)),
    db.select({ id: schema.assets.id }).from(schema.assets).where(and(eq(schema.assets.projectId, project.id), isNull(schema.assets.deletedAt))),
    listStoryEntityBindings({ auth: input.auth, projectId: project.id }),
    db.select().from(schema.shotContextPacketHeads).where(eq(schema.shotContextPacketHeads.projectId, project.id)).catch(() => []),
  ]);

  // Team Canon 引用摘要（PR-C）：pins ＋ pinned/production 版本號。
  // 只回摘要 IDs/states——版本 payload、events、upgrade impact 點開再 fetch，避免 projection 膨脹。
  const pins = await db.select().from(schema.projectCanonPins)
    .where(eq(schema.projectCanonPins.projectId, project.id)).catch(() => []);
  let canonPins: WorkspaceProjection["canonPins"] = [];
  if (pins.length) {
    const canonIds = [...new Set(pins.map((row) => row.canonId))];
    const canons = await db.select({
      id: schema.canonEntries.id,
      kind: schema.canonEntries.kind,
      name: schema.canonEntries.name,
      productionVersionId: schema.canonEntries.productionVersionId,
    }).from(schema.canonEntries).where(inArray(schema.canonEntries.id, canonIds));
    const versionIds = [...new Set([
      ...pins.map((row) => row.pinnedVersionId),
      ...canons.map((row) => row.productionVersionId).filter((id): id is string => Boolean(id)),
    ])];
    const versions = versionIds.length
      ? await db.select({ id: schema.canonVersions.id, versionNumber: schema.canonVersions.versionNumber })
        .from(schema.canonVersions).where(inArray(schema.canonVersions.id, versionIds))
      : [];
    const canonById = new Map(canons.map((row) => [row.id, row]));
    const versionById = new Map(versions.map((row) => [row.id, row]));
    canonPins = pins.flatMap((pin) => {
      const canon = canonById.get(pin.canonId);
      if (!canon) return [];
      return [{
        pinId: pin.id,
        canonId: pin.canonId,
        kind: canon.kind,
        name: canon.name,
        state: pinState({ pinnedVersionId: pin.pinnedVersionId, productionVersionId: canon.productionVersionId }),
        pinnedVersionNumber: versionById.get(pin.pinnedVersionId)?.versionNumber ?? null,
        productionVersionNumber: canon.productionVersionId
          ? versionById.get(canon.productionVersionId)?.versionNumber ?? null
          : null,
        localEntityKind: pin.localEntityKind,
        localEntityId: pin.localEntityId,
      }];
    });
  }

  const nodes: ConsistencyGraphNode[] = [
    ...characters.map((row) => ({ kind: "character", id: row.id, title: row.name, rev: row.rev })),
    ...looks.map((row) => ({ kind: "character_look", id: row.id, title: row.name, rev: row.rev })),
    ...presets.map((row) => ({ kind: "scene_preset", id: row.id, title: row.name, rev: row.rev })),
    ...props.map((row) => ({ kind: "prop", id: row.id, title: row.name, rev: row.rev })),
    ...shots.map((row) => ({ kind: "shot", id: row.id, title: row.title, rev: row.rev })),
  ];
  const edges: ConsistencyGraphEdge[] = [];
  for (const look of looks) {
    edges.push({ fromKind: "character", fromId: look.characterId, toKind: "character_look", toId: look.id, rel: "has_look" });
  }
  for (const prop of props) {
    if (prop.ownerId && prop.ownerKind) {
      edges.push({ fromKind: prop.ownerKind, fromId: prop.ownerId, toKind: "prop", toId: prop.id, rel: "owns" });
    }
  }
  for (const binding of bindings.bindings) {
    edges.push({ fromKind: "story", fromId: story?.id ?? project.id, toKind: binding.entityKind, toId: binding.entityId, rel: binding.locked ? "locked_binding" : "binding" });
  }

  const visualReferences = [
    ...characters.map((row) => row.referenceAssetId),
    ...looks.map((row) => row.referenceAssetId),
    ...presets.map((row) => row.referenceAssetId),
    ...props.map((row) => row.referenceAssetId),
  ].filter(Boolean).length;

  const expectedSlots = characters.length + looks.length + presets.length + props.length;
  const stale = new Set((heads ?? []).filter((row) => row.stale).map((row) => row.shotId));
  const consistentShots = shots.filter((shot) => shot.assetId && !stale.has(shot.id)).length;
  const needsConfirm = bindings.proposals.length + shots.filter((shot) => !shot.prompt && !shot.assetId).length;
  const readyShots = shots.filter((shot) => Boolean(shot.prompt?.trim())).length;
  const worldview = project.worldview && typeof project.worldview === "object" ? project.worldview as Record<string, unknown> : {};
  const worldBits = [worldview.logline, Array.isArray(worldview.styles) ? worldview.styles[0] : null, Array.isArray(worldview.taboos) ? worldview.taboos[0] : null].filter(Boolean).length;

  const projection: WorkspaceProjection = {
    projectId: project.id,
    applied: {
      characters: characters.length > 0,
      scenes: presets.length > 0,
    },
    counts: {
      characters: characters.length,
      looks: looks.length,
      scenes: presets.length,
      props: props.length,
      shots: shots.length,
      consistentShots,
      needsConfirm,
      visualReferences,
    },
    completeness: {
      world: worldBits / 3,
      visualCoverage: visualCoverageScore(visualReferences, expectedSlots),
      generationReady: shots.length ? readyShots / shots.length : 0,
      consistencyHealth: shots.length ? consistentShots / shots.length : 1,
    },
    compactStatus: compactWorkspaceStatus({
      charactersApplied: characters.length > 0,
      sceneCount: presets.length,
      consistentShots,
      shotCount: shots.length,
      needsConfirm,
    }),
    nextAction: nextWorkspaceAction({
      storyReady: Boolean(story?.content?.trim()),
      parsed: Boolean(story?.lastParsedAt),
      shotCount: shots.length,
      needsConfirm,
      consistentShots,
    }),
    nodes,
    edges,
    canonPins,
    staleShotIds: [...stale],
    deliveryBlockers: deliveryBlockers({
      shots: shots.map((shot) => ({ id: shot.id, assetId: shot.assetId, reviewStatus: shot.reviewStatus })),
      staleShotIds: [...stale],
    }),
  };
  void assets;
  return projection;
}
