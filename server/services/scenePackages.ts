/**
 * Scene Package freeze / staleness（master plan §6）。
 *
 * 與 shotContextPackets 同一套模式：歷史 package insert-only、
 * head 指標帶 stale；「這場戲的完整脈絡」凍結一次，場下所有 Shot 繼承，
 * 不用每鏡重新拼整個場景。
 */
import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, lt } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db, schema } from "../db";
import type { AuthState } from "./auth";
import {
  SCENE_PACKAGE_SCHEMA_VERSION,
  canonicalScenePackageMaterial,
  scenePackageDependencies,
  type ScenePackagePayload,
} from "../../shared/scenePackage";
import { parseWorldviewSafe } from "../../shared/parseWorldviewSafe";
import { loadCreativeContextProject } from "./storyEntityBinding";

export function hashScenePackage(payload: ScenePackagePayload): string {
  return createHash("sha256").update(canonicalScenePackageMaterial(payload)).digest("hex");
}

export async function buildScenePackagePayload(input: {
  auth: AuthState;
  projectId: string;
  storySceneId: string;
}): Promise<ScenePackagePayload> {
  const project = await loadCreativeContextProject(input.auth, input.projectId, false);
  const [storyScene] = await db.select().from(schema.storyScenes).where(and(
    eq(schema.storyScenes.id, input.storySceneId),
    eq(schema.storyScenes.projectId, project.id),
  ));
  if (!storyScene) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這場戲" });

  const shots = await db.select({
    id: schema.scenes.id,
    orderIndex: schema.scenes.orderIndex,
    characterIds: schema.scenes.characterIds,
    lookIds: schema.scenes.lookIds,
    propIds: schema.scenes.propIds,
    camera: schema.scenes.camera,
    ambience: schema.scenes.ambience,
    storySceneId: schema.scenes.storySceneId,
  }).from(schema.scenes).where(and(
    eq(schema.scenes.projectId, project.id),
    eq(schema.scenes.storySceneId, storyScene.id),
    isNull(schema.scenes.deletedAt),
  )).orderBy(asc(schema.scenes.orderIndex));

  const characterIds = [...new Set(shots.flatMap((shot) => shot.characterIds ?? []))];
  const lookIds = [...new Set(shots.flatMap((shot) => shot.lookIds ?? []))];
  const propIds = [...new Set(shots.flatMap((shot) => shot.propIds ?? []))];

  const [characters, looks, props, location] = await Promise.all([
    characterIds.length
      ? db.select({ id: schema.characters.id, name: schema.characters.name, rev: schema.characters.rev })
        .from(schema.characters).where(and(eq(schema.characters.projectId, project.id), inArray(schema.characters.id, characterIds)))
      : Promise.resolve([]),
    lookIds.length
      ? db.select({ id: schema.characterLooks.id, name: schema.characterLooks.name, rev: schema.characterLooks.rev })
        .from(schema.characterLooks).where(and(eq(schema.characterLooks.projectId, project.id), inArray(schema.characterLooks.id, lookIds)))
      : Promise.resolve([]),
    propIds.length
      ? db.select({ id: schema.props.id, name: schema.props.name, rev: schema.props.rev, ownerKind: schema.props.ownerKind, ownerId: schema.props.ownerId })
        .from(schema.props).where(and(eq(schema.props.projectId, project.id), inArray(schema.props.id, propIds)))
      : Promise.resolve([]),
    storyScene.locationId
      ? db.select({ id: schema.scenePresets.id, name: schema.scenePresets.name, rev: schema.scenePresets.rev })
        .from(schema.scenePresets).where(and(eq(schema.scenePresets.projectId, project.id), eq(schema.scenePresets.id, storyScene.locationId)))
        .then((rows) => rows[0] ?? null)
      : Promise.resolve(null),
  ]);

  // 地點卡若已 pin Team Canon，記 canonical 來源（追溯＋升級影響用）
  const [locationPin] = location
    ? await db.select().from(schema.projectCanonPins).where(and(
      eq(schema.projectCanonPins.projectId, project.id),
      eq(schema.projectCanonPins.localEntityKind, "scene_preset"),
      eq(schema.projectCanonPins.localEntityId, location.id),
    ))
    : [];

  // 入場連戲：上一場最後一鏡的 end-state（Adopt 時抽出）
  const [prevScene] = await db.select({ id: schema.storyScenes.id, orderIndex: schema.storyScenes.orderIndex })
    .from(schema.storyScenes)
    .where(and(
      eq(schema.storyScenes.projectId, project.id),
      lt(schema.storyScenes.orderIndex, storyScene.orderIndex),
    ))
    .orderBy(desc(schema.storyScenes.orderIndex))
    .limit(1);
  let entryContinuity: Record<string, unknown> | null = null;
  if (prevScene) {
    const [lastShot] = await db.select({ id: schema.scenes.id })
      .from(schema.scenes)
      .where(and(
        eq(schema.scenes.projectId, project.id),
        eq(schema.scenes.storySceneId, prevScene.id),
        isNull(schema.scenes.deletedAt),
      ))
      .orderBy(desc(schema.scenes.orderIndex))
      .limit(1);
    if (lastShot) {
      const [state] = await db.select().from(schema.shotContinuityStates)
        .where(eq(schema.shotContinuityStates.shotId, lastShot.id));
      entryContinuity = state ? (state.endState as unknown as Record<string, unknown>) : null;
    }
  }

  const worldview = parseWorldviewSafe(project.worldview);
  const cameraLanguage = [...new Set(shots.flatMap((shot) => {
    const camera = shot.camera as Record<string, unknown> | null;
    if (!camera) return [];
    return Object.values(camera).filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  }))];

  // closure §4／§6：pinned Style／Sound World canon（消費點同樣守 rights）
  const { resolveProjectCanonDefaults } = await import("./teamCanon");
  const packageCanonDefaults = await resolveProjectCanonDefaults(project.id);
  const soundWorldCanon = packageCanonDefaults.soundWorld;

  return {
    schemaVersion: SCENE_PACKAGE_SCHEMA_VERSION,
    projectId: project.id,
    storySceneId: storyScene.id,
    storySceneRev: storyScene.rev,
    location: location ? { kind: "scene_preset", id: location.id, rev: location.rev, name: location.name } : null,
    sceneCanon: locationPin ? { canonId: locationPin.canonId, versionId: locationPin.pinnedVersionId } : null,
    environment: (storyScene.environment as Record<string, unknown> | null) ?? null,
    activeCharacters: characters.map((row) => ({ kind: "character", id: row.id, rev: row.rev, name: row.name })),
    activeLooks: looks.map((row) => ({ kind: "character_look", id: row.id, rev: row.rev, name: row.name })),
    props: props.map((row) => ({
      kind: "prop", id: row.id, rev: row.rev, name: row.name,
      ownerKind: row.ownerKind, ownerId: row.ownerId,
    })),
    // closure §4：pinned Style Canon＝專案風格真相（與 shot packet 同一條 single-truth 規則）
    style: packageCanonDefaults.styleStyles ?? worldview.styles,
    soundWorld: (() => {
      const shotAmbience = shots.find((shot) => shot.ambience?.trim())?.ambience ?? null;
      // closure §6：pinned Sound World canon＝場的聲音 identity（undefined 欄位不進 JSON，
      // 沒有 canon 的 package 素材與舊版 bit-for-bit 相同）
      if (!soundWorldCanon) return { ambience: shotAmbience };
      return {
        ambience: shotAmbience ?? soundWorldCanon.ambience,
        canonId: soundWorldCanon.canonId,
        canonVersionId: soundWorldCanon.versionId,
        music: soundWorldCanon.music,
      };
    })(),
    cameraLanguage,
    narrativeGoal: storyScene.summary?.trim() || storyScene.storyExcerpt?.trim() || null,
    entryContinuity,
    exitConstraints: [],
  };
}

export async function freezeScenePackage(input: {
  auth: AuthState;
  projectId: string;
  storySceneId: string;
}): Promise<{ packageId: string; fingerprint: string; reused: boolean; payload: ScenePackagePayload }> {
  const project = await loadCreativeContextProject(input.auth, input.projectId, true);
  const payload = await buildScenePackagePayload(input);
  const fingerprint = hashScenePackage(payload);
  const [existing] = await db.select().from(schema.scenePackages).where(and(
    eq(schema.scenePackages.storySceneId, input.storySceneId),
    eq(schema.scenePackages.fingerprint, fingerprint),
  )).orderBy(desc(schema.scenePackages.createdAt)).limit(1);

  let packageId = existing?.id;
  if (!existing) {
    const [head] = await db.select().from(schema.scenePackageHeads)
      .where(eq(schema.scenePackageHeads.storySceneId, input.storySceneId));
    try {
      const [inserted] = await db.insert(schema.scenePackages).values({
        projectId: project.id,
        groupId: project.groupId,
        storySceneId: input.storySceneId,
        schemaVersion: payload.schemaVersion,
        fingerprint,
        payload,
        parentPackageId: head?.packageId ?? null,
        createdBy: input.auth.user.id,
      }).returning({ id: schema.scenePackages.id });
      packageId = inserted.id;
    } catch (error) {
      // 並行凍結同指紋：unique index（0076）擋下第二筆→冪等取用先到的那筆
      const { isUniqueViolation } = await import("./generationCore");
      if (!isUniqueViolation(error)) throw error;
      const [winner] = await db.select({ id: schema.scenePackages.id }).from(schema.scenePackages).where(and(
        eq(schema.scenePackages.storySceneId, input.storySceneId),
        eq(schema.scenePackages.fingerprint, fingerprint),
      )).limit(1);
      if (!winner) throw error;
      packageId = winner.id;
    }
  }

  await db.insert(schema.scenePackageHeads).values({
    storySceneId: input.storySceneId,
    projectId: project.id,
    groupId: project.groupId,
    packageId: packageId!,
    fingerprint,
    stale: false,
    staleReason: null,
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: schema.scenePackageHeads.storySceneId,
    set: { packageId: packageId!, fingerprint, stale: false, staleReason: null, updatedAt: new Date() },
  });

  return { packageId: packageId!, fingerprint, reused: Boolean(existing), payload: existing?.payload ?? payload };
}

/** 依實際指紋差異標 stale；帶 changed 時只重算依賴該實體的場（targeted） */
export async function refreshScenePackageStaleness(input: {
  auth: AuthState;
  projectId: string;
  changed?: { kind: string; id: string };
}): Promise<{ staleStorySceneIds: string[] }> {
  const project = await loadCreativeContextProject(input.auth, input.projectId, true);
  const heads = await db.select().from(schema.scenePackageHeads)
    .where(eq(schema.scenePackageHeads.projectId, project.id));
  if (!heads.length) return { staleStorySceneIds: [] };
  const packages = await db.select().from(schema.scenePackages)
    .where(inArray(schema.scenePackages.id, heads.map((row) => row.packageId)));
  const byId = new Map(packages.map((row) => [row.id, row]));
  const targets = input.changed
    ? heads.filter((head) => {
      const payload = byId.get(head.packageId)?.payload;
      if (!payload) return false;
      const deps = scenePackageDependencies(payload);
      return deps.entityKeys.includes(`${input.changed!.kind}:${input.changed!.id}`);
    })
    : heads;
  const staleStorySceneIds: string[] = [];
  for (const head of targets) {
    const current = await buildScenePackagePayload({
      auth: input.auth,
      projectId: project.id,
      storySceneId: head.storySceneId,
    });
    const fingerprint = hashScenePackage(current);
    if (fingerprint === head.fingerprint) continue;
    staleStorySceneIds.push(head.storySceneId);
    await db.update(schema.scenePackageHeads).set({
      stale: true,
      staleReason: input.changed ? `${input.changed.kind}:${input.changed.id} 已變更` : "場景脈絡已變更",
      updatedAt: new Date(),
    }).where(eq(schema.scenePackageHeads.storySceneId, head.storySceneId));
  }
  return { staleStorySceneIds };
}
