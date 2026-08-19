/**
 * Server-side Project Consistency Graph + workspace projection.
 * UI must read this; it must not invent completeness from button clicks.
 */
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "../db";
import type { AuthState } from "./auth";
import {
  buildConsistencyScorecard,
  compactWorkspaceStatus,
  nextWorkspaceAction,
  visualCoverageScore,
  type ConsistencyGraphEdge,
  type ConsistencyGraphNode,
  type WorkspaceProjection,
} from "../../shared/projectConsistencyGraph";
import { parseScriptAuthorizedChanges, resolvePropTransfers, unresolvedPropTransfers } from "../../shared/scriptChanges";
import { pinState } from "../../shared/teamCanon";
import { deliveryBlockers } from "./consistencyAdopt";
import { listStoryEntityBindings, loadCreativeContextProject } from "./storyEntityBinding";
import { deriveSequenceLock } from "../../shared/animationTemporal";
import { isBlankOrphanShot } from "../../shared/story";

export async function projectWorkspaceProjection(input: {
  auth: AuthState;
  projectId: string;
}): Promise<WorkspaceProjection> {
  const project = await loadCreativeContextProject(input.auth, input.projectId, false);
  const [story] = await db.select().from(schema.stories).where(eq(schema.stories.projectId, project.id));
  // closure §8：downstream artifact staleness（影片 parent／聲線版本／聲音世界版本）——
  // 推導不落盤，與 packet 級 staleness 互補；失敗不擋 projection（訊號層，不是門）
  const { projectMediaLineage } = await import("./mediaLineage");
  const lineageResult = await projectMediaLineage({ auth: input.auth, projectId: input.projectId })
    .catch(() => ({ findings: [], lineages: [], lineageGapShotIds: [] as string[] }));
  const artifactFindings = lineageResult.findings;
  // closure §11 scorecard 的 canon 現況輸入
  const { resolveProjectCanonDefaults } = await import("./teamCanon");
  const canonDefaults = await resolveProjectCanonDefaults(project.id)
    .catch(() => ({ styleCanon: null, styleStyles: null, styleNegative: null, styleReferences: [], characterVoices: new Map(), narrationVoice: null, soundWorld: null }));
  const [characters, looks, presets, props, shots, assets, rightsRows, bindings, heads] = await Promise.all([
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
      // closure §9–§11 scorecard 輸入：多角色數／道具轉手解析用文字
      characterIds: schema.scenes.characterIds,
      propIds: schema.scenes.propIds,
      action: schema.scenes.action,
      dialogue: schema.scenes.dialogue,
      storySceneId: schema.scenes.storySceneId,
    }).from(schema.scenes).where(and(eq(schema.scenes.projectId, project.id), isNull(schema.scenes.deletedAt))).orderBy(asc(schema.scenes.orderIndex)),
    db.select({ id: schema.assets.id }).from(schema.assets).where(and(eq(schema.assets.projectId, project.id), isNull(schema.assets.deletedAt))),
    db.select({
      rightsStatus: schema.assetRightsProfiles.rightsStatus,
    }).from(schema.assetRightsProfiles).where(eq(schema.assetRightsProfiles.projectId, project.id)).catch(() => []),
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

  // Sequence Lock is a bounded derived projection over existing Scene Package heads.
  // No new current/version table is introduced.
  const packageHeads = await db.select().from(schema.scenePackageHeads)
    .where(eq(schema.scenePackageHeads.projectId, project.id));
  const packageRows = packageHeads.length
    ? await db.select().from(schema.scenePackages)
      .where(inArray(schema.scenePackages.id, packageHeads.map((row) => row.packageId)))
    : [];
  const packageById = new Map(packageRows.map((row) => [row.id, row]));
  const sequenceLocks = packageHeads.flatMap((head) => {
    const row = packageById.get(head.packageId);
    if (!row) return [];
    return [deriveSequenceLock({
      packagePayload: row.payload,
      packageFingerprint: head.fingerprint,
      packageStale: head.stale,
    })];
  });

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
  const needsConfirm = bindings.proposals.length;
  const readyShots = shots.filter((shot) => Boolean(shot.prompt?.trim())).length;
  const worldview = project.worldview && typeof project.worldview === "object" ? project.worldview as Record<string, unknown> : {};
  const worldBits = [worldview.logline, Array.isArray(worldview.styles) ? worldview.styles[0] : null, Array.isArray(worldview.taboos) ? worldview.taboos[0] : null].filter(Boolean).length;

  const storySceneIds = [...new Set(shots.map((shot) => shot.storySceneId).filter((id): id is string => Boolean(id)))];
  const storyExcerptByScene = new Map(
    storySceneIds.length
      ? (await db.select({ id: schema.storyScenes.id, storyExcerpt: schema.storyScenes.storyExcerpt })
        .from(schema.storyScenes).where(inArray(schema.storyScenes.id, storySceneIds)))
        .map((row) => [row.id, row.storyExcerpt])
      : [],
  );
  const untitledOrphans = shots.filter((shot) =>
    isBlankOrphanShot(shot) && (!shot.storySceneId || !storyExcerptByScene.has(shot.storySceneId)),
  ).length;
  const blockers = deliveryBlockers({
    shots: shots.map((shot) => ({ id: shot.id, assetId: shot.assetId, reviewStatus: shot.reviewStatus })),
    staleShotIds: [...stale],
    artifactFindings,
  });
  // One latest immutable evaluation per shot; no per-shot query fan-out and no history payload flood.
  const latestEvaluations = await db.selectDistinctOn(
    [schema.generationConsistencyEvaluations.shotId],
    {
      shotId: schema.generationConsistencyEvaluations.shotId,
      result: schema.generationConsistencyEvaluations.result,
      createdAt: schema.generationConsistencyEvaluations.createdAt,
    },
  ).from(schema.generationConsistencyEvaluations)
    .where(eq(schema.generationConsistencyEvaluations.projectId, project.id))
    .orderBy(schema.generationConsistencyEvaluations.shotId, desc(schema.generationConsistencyEvaluations.createdAt));
  const outputEvaluationFindings = latestEvaluations.flatMap((row) =>
    row.result.findings.map((finding) => ({
      shotId: row.shotId,
      dimension: finding.dimension,
      severity: finding.severity,
      reason: finding.reason,
    })),
  );
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
      untitledOrphans,
    }),
    nextAction: nextWorkspaceAction({
      storyReady: Boolean(story?.content?.trim()),
      parsed: Boolean(story?.lastParsedAt),
      shotCount: shots.length,
      needsConfirm,
      consistentShots,
      untitledOrphans,
    }),
    rightsReadiness: summarizeRightsRows(assets.length, rightsRows ?? []),
    nodes,
    edges,
    canonPins,
    staleShotIds: [...stale],
    artifactFindings,
    deliveryBlockers: blockers,
    sequenceLocks,
    scorecard: buildConsistencyScorecard({
      charactersMissingReference: characters.filter((row) => !row.referenceAssetId).map((row) => row.id),
      charactersBoundShotIds: (() => {
        const missing = new Set(characters.filter((row) => !row.referenceAssetId).map((row) => row.id));
        return shots.filter((shot) => (shot.characterIds ?? []).some((id) => missing.has(id))).map((shot) => shot.id);
      })(),
      looksMissingReference: looks.filter((row) => !row.referenceAssetId).map((row) => row.id),
      presetsMissingReference: presets.filter((row) => !row.referenceAssetId).map((row) => row.id),
      unresolvedPropShotIds: shots.filter((shot) => {
        if (!(shot.propIds ?? []).length) return false;
        // 與 packet build 同一份語料（含場的 storyExcerpt）——scorecard 不得比 packet 少看半句
        const excerpt = shot.storySceneId ? storyExcerptByScene.get(shot.storySceneId) ?? null : null;
        const text = [shot.prompt, shot.action, shot.dialogue, excerpt].filter(Boolean).join("\n");
        if (!text) return false;
        const changes = resolvePropTransfers({
          changes: parseScriptAuthorizedChanges(text),
          shotText: text,
          characters: characters.filter((row) => (shot.characterIds ?? []).includes(row.id)),
          props: props.filter((row) => (shot.propIds ?? []).includes(row.id)),
        });
        return unresolvedPropTransfers(changes).length > 0;
      }).map((shot) => shot.id),
      styleCanonPinned: Boolean(canonDefaults.styleCanon),
      staleShotIds: [...stale],
      multiCharacterShotIds: shots.filter((shot) => (shot.characterIds ?? []).length > 1).map((shot) => shot.id),
      voiceFindingShotIds: artifactFindings.filter((row) => row.track === "narration").map((row) => row.shotId),
      charactersSpeakingWithoutVoice: (() => {
        if (!canonDefaults.narrationVoice && canonDefaults.characterVoices.size === 0) {
          // 完全沒綁聲線：算「有台詞的角色」數（提示綁定，不逐鏡展開）
          const speaking = new Set<string>();
          for (const shot of shots) {
            if (shot.dialogue?.includes("@") || shot.dialogue?.includes("＠")) {
              for (const id of shot.characterIds ?? []) speaking.add(id);
            }
          }
          return speaking.size;
        }
        return 0;
      })(),
      soundFindingShotIds: artifactFindings.filter((row) => row.track === "ambience" || row.track === "music").map((row) => row.shotId),
      soundWorldPinned: Boolean(canonDefaults.soundWorld),
      lineageGapShotIds: lineageResult.lineageGapShotIds,
      deliveryBlockers: blockers,
      outputEvaluationFindings,
    }),
  };
  return projection;
}

function summarizeRightsRows(assetCount: number, rows: Array<{ rightsStatus: string }>) {
  const counts = { CLEAR: 0, CONDITIONAL: 0, REVIEW_REQUIRED: 0, BLOCKED: 0, UNKNOWN: 0 };
  for (const row of rows) {
    if (row.rightsStatus in counts) counts[row.rightsStatus as keyof typeof counts] += 1;
  }
  const unknown = counts.UNKNOWN + Math.max(0, assetCount - rows.length);
  let status: "clear" | "needs_review" | "blocked" | "unknown" = "unknown";
  if (counts.BLOCKED > 0) status = "blocked";
  else if (counts.REVIEW_REQUIRED > 0 || unknown > 0) status = assetCount === 0 ? "unknown" : (unknown === assetCount ? "unknown" : "needs_review");
  else if (assetCount > 0 && counts.CLEAR + counts.CONDITIONAL === assetCount) status = "clear";
  return {
    status,
    total: assetCount,
    clear: counts.CLEAR,
    conditional: counts.CONDITIONAL,
    reviewRequired: counts.REVIEW_REQUIRED,
    blocked: counts.BLOCKED,
    unknown,
  };
}
