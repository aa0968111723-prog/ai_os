import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db, schema } from "../db";
import { requireGroup } from "../trpc";
import type { AuthState } from "./auth";
import { assertProjectEditable, assertProjectNotArchived } from "./projectAcl";
import { resolveContext } from "./contextResolver";
import { extFromMime } from "./storage";
import {
  EDITING_PACKAGE_TTL_HOURS,
  LUMAFUSION_ADAPTER,
  editingManifestSchema,
  editingPackageFileName,
  stableEditingFileName,
  type EditingAssetRole,
  type EditingHandoffMode,
  type EditingManifest,
  type EditingSelectionType,
} from "../../shared/externalEditing";
import type { AssistantReturnContext } from "../../shared/assistantActions";
import type { AgentQuestionDefinition } from "../../shared/agentQuestions";
import { resolveOrAskAgentQuestion } from "../../shared/agentQuestions";

type AssetRow = typeof schema.assets.$inferSelect;
type ShotRow = typeof schema.scenes.$inferSelect;

export interface EditingSelectionInput {
  projectId: string;
  selectionType: EditingSelectionType;
  storySceneIds?: string[];
  shotIds?: string[];
}

export interface PrepareEditingHandoffInput extends EditingSelectionInput {
  editorId: "lumafusion";
  handoffMode: EditingHandoffMode;
  primaryAssetOverrides?: Record<string, string>;
  originAssistantRunId?: string;
  originConversationId?: string;
  originSurface?: string;
  returnContext?: AssistantReturnContext;
}

interface Candidate {
  assetId: string;
  role: EditingAssetRole;
  storySceneId: string | null;
  shotId: string | null;
  sourceAssetId: string | null;
  locked: boolean;
}

async function loadEditableProject(auth: AuthState, projectId: string) {
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
  if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "找不到專案" });
  requireGroup(auth, project.groupId);
  assertProjectNotArchived(project);
  await assertProjectEditable(auth, project);
  return project;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function durationMsOf(asset: AssetRow): number | null {
  const meta = asset.meta && typeof asset.meta === "object" ? asset.meta as Record<string, unknown> : null;
  const media = meta?.media && typeof meta.media === "object" ? meta.media as Record<string, unknown> : null;
  const seconds = typeof media?.durationSec === "number" ? media.durationSec
    : typeof meta?.durationSec === "number" ? meta.durationSec
      : null;
  return seconds != null && Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 1_000) : null;
}

function optionalMetaString(meta: Record<string, unknown> | null, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = meta?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

async function resolveSelection(projectId: string, selection: EditingSelectionInput) {
  const allShots = await db.select().from(schema.scenes).where(and(
    eq(schema.scenes.projectId, projectId),
    isNull(schema.scenes.deletedAt),
  )).orderBy(asc(schema.scenes.orderIndex));
  const allScenes = await db.select().from(schema.storyScenes)
    .where(eq(schema.storyScenes.projectId, projectId)).orderBy(asc(schema.storyScenes.orderIndex));

  const requestedScenes = unique(selection.storySceneIds ?? []);
  const requestedShots = unique(selection.shotIds ?? []);
  let shots: ShotRow[];
  if (selection.selectionType === "project") {
    shots = allShots;
  } else if (selection.selectionType === "story_scene") {
    if (requestedScenes.length !== 1) throw new TRPCError({ code: "BAD_REQUEST", message: "請選擇一個 Scene" });
    shots = allShots.filter((shot) => shot.storySceneId === requestedScenes[0]);
  } else if (selection.selectionType === "shot") {
    if (requestedShots.length !== 1) throw new TRPCError({ code: "BAD_REQUEST", message: "請選擇一個 Shot" });
    shots = allShots.filter((shot) => shot.id === requestedShots[0]);
  } else {
    if (!requestedShots.length) throw new TRPCError({ code: "BAD_REQUEST", message: "請至少選擇一個 Shot" });
    const set = new Set(requestedShots);
    shots = allShots.filter((shot) => set.has(shot.id));
  }
  if (!shots.length) throw new TRPCError({ code: "BAD_REQUEST", message: "選取範圍內沒有可交接的 Shot" });
  if (requestedShots.some((id) => !allShots.some((shot) => shot.id === id))) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "有 Shot 不屬於這個專案" });
  }
  if (requestedScenes.some((id) => !allScenes.some((scene) => scene.id === id))) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "有 Scene 不屬於這個專案" });
  }
  const storySceneIds = unique(shots.map((shot) => shot.storySceneId).filter((id): id is string => !!id));
  return { shots, storyScenes: allScenes.filter((scene) => storySceneIds.includes(scene.id)), storySceneIds };
}

function ambiguityQuestion(shot: ShotRow, options: AssetRow[]): AgentQuestionDefinition {
  return {
    questionType: "asset_picker",
    title: `選擇「${shot.title}」的主要剪輯素材`,
    description: "這個 Shot 尚未指定主要素材，但有多個可用參考。請選一個版本再建立交接包。",
    required: true,
    options: options.map((asset) => ({
      id: asset.id,
      label: asset.title,
      description: [asset.kind, asset.mime].filter(Boolean).join(" · "),
      metadata: { shotId: shot.id, createdAt: asset.createdAt.toISOString() },
    })),
    allowCustom: false,
    context: {
      reason: "主要素材版本不明確；外部交接前需要人類確認。",
      slot: "assetIds",
      entityType: "asset",
      candidateCount: options.length,
      facts: [`Shot：${shot.title}`, `候選素材：${options.length} 個`],
    },
  };
}

async function collectEditingAssets(auth: AuthState, project: Awaited<ReturnType<typeof loadEditableProject>>, shots: ShotRow[], overrides: Record<string, string> = {}) {
  const candidates: Candidate[] = [];
  const contextByShot: Record<string, unknown> = {};
  const questions: AgentQuestionDefinition[] = [];

  for (const shot of shots) {
    const resolved = await resolveContext({
      auth,
      projectId: project.id,
      sceneId: shot.storySceneId,
      shotId: shot.id,
      intent: "video",
      allowGlobalRetrieval: false,
      includeSuggested: true,
    });
    const resolvedRefs = [
      ...resolved.visualReferences,
      ...resolved.styleReferences,
      ...resolved.characterReferences,
      ...resolved.locationReferences,
      ...resolved.audioReferences,
      ...resolved.relatedAssets,
    ].filter((ref) => ref.resourceKind === "asset");
    // A Context match is not automatically permission to copy every related
    // Library item into a handoff. Include confirmed/locked references and
    // non-suggested PRIMARY bindings; keep other suggestions available only as
    // explicit primary-version choices when a Shot has no selected asset.
    const refs = resolvedRefs.filter((ref) => ref.confirmed
      || ref.priority === "LOCKED"
      || (ref.priority === "PRIMARY" && ref.source !== "AI_SUGGESTED"));
    contextByShot[shot.id] = {
      shot: { id: shot.id, title: shot.title, orderIndex: shot.orderIndex, storySceneId: shot.storySceneId },
      bindingIds: unique(resolvedRefs.map((ref) => ref.bindingId).filter((id): id is string => !!id)),
      contextAssetIds: unique(resolvedRefs.map((ref) => ref.resourceId)),
      packagedContextAssetIds: unique(refs.map((ref) => ref.resourceId)),
      truncated: resolved.truncated,
    };

    const primaryId = overrides[shot.id] ?? shot.assetId;
    if (primaryId) candidates.push({ assetId: primaryId, role: "PRIMARY_MEDIA", storySceneId: shot.storySceneId, shotId: shot.id, sourceAssetId: null, locked: true });
    if (shot.narrationAssetId) candidates.push({ assetId: shot.narrationAssetId, role: "VOICEOVER", storySceneId: shot.storySceneId, shotId: shot.id, sourceAssetId: null, locked: true });
    if (shot.musicAssetId) candidates.push({ assetId: shot.musicAssetId, role: "MUSIC", storySceneId: shot.storySceneId, shotId: shot.id, sourceAssetId: null, locked: false });
    if (shot.ambienceAssetId) candidates.push({ assetId: shot.ambienceAssetId, role: "AMBIENCE", storySceneId: shot.storySceneId, shotId: shot.id, sourceAssetId: null, locked: false });

    for (const ref of refs) {
      const role: EditingAssetRole = ref.role === "CHARACTER_REFERENCE" ? "CHARACTER_REFERENCE"
        : ref.role === "LOCATION_REFERENCE" ? "LOCATION_REFERENCE"
          : ref.role === "AUDIO_REFERENCE" ? "SFX"
              : "VISUAL_REFERENCE";
      candidates.push({ assetId: ref.resourceId, role, storySceneId: shot.storySceneId, shotId: shot.id, sourceAssetId: null, locked: ref.priority === "LOCKED" });
    }

    if (!primaryId) {
      const visualIds = unique(resolvedRefs.filter((ref) => ["VISUAL_REFERENCE", "CHARACTER_REFERENCE", "LOCATION_REFERENCE", "PRODUCTION_ASSET"].includes(ref.role)).map((ref) => ref.resourceId));
      if (visualIds.length) {
        const optionRows = await db.select().from(schema.assets).where(and(
          inArray(schema.assets.id, visualIds),
          eq(schema.assets.projectId, project.id),
          eq(schema.assets.groupId, project.groupId),
          isNull(schema.assets.deletedAt),
        ));
        const question = ambiguityQuestion(shot, optionRows);
        const resolution = resolveOrAskAgentQuestion({
          candidates: question.options,
          question,
          requiresHumanJudgment: optionRows.length > 1,
        });
        if (resolution.kind === "resolved" && typeof resolution.value === "string") {
          candidates.push({
            assetId: resolution.value,
            role: "PRIMARY_MEDIA",
            storySceneId: shot.storySceneId,
            shotId: shot.id,
            sourceAssetId: null,
            locked: true,
          });
        } else if (resolution.kind === "question") {
          questions.push(resolution.question);
        }
      }
    }
  }

  // The same asset can also be present in resolved Context. Preserve the strongest
  // semantic role so a PRIMARY_MEDIA entry is never downgraded to a reference.
  const roleRank: Record<EditingAssetRole, number> = {
    PRIMARY_MEDIA: 100,
    PRIMARY_VIDEO: 95,
    EDITED_MASTER: 90,
    VOICEOVER: 80,
    DIALOGUE: 75,
    MUSIC: 70,
    AMBIENCE: 65,
    SFX: 60,
    ALT_VIDEO: 50,
    SUBTITLE: 45,
    CHARACTER_REFERENCE: 30,
    LOCATION_REFERENCE: 30,
    VISUAL_REFERENCE: 20,
  };
  const byAssetId = new Map<string, Candidate>();
  for (const candidate of candidates) {
    const current = byAssetId.get(candidate.assetId);
    if (!current || roleRank[candidate.role] > roleRank[current.role]) {
      byAssetId.set(candidate.assetId, candidate);
    } else if (candidate.locked && !current.locked) {
      byAssetId.set(candidate.assetId, { ...current, locked: true });
    }
  }
  const deduped = [...byAssetId.values()];
  const ids = deduped.map((candidate) => candidate.assetId);
  const assets = ids.length ? await db.select().from(schema.assets).where(and(
    inArray(schema.assets.id, ids),
    eq(schema.assets.projectId, project.id),
    eq(schema.assets.groupId, project.groupId),
    isNull(schema.assets.deletedAt),
  )).orderBy(asc(schema.assets.createdAt)) : [];
  const allowed = new Set(assets.map((asset) => asset.id));
  const missing = ids.filter((id) => !allowed.has(id));
  if (missing.length) throw new TRPCError({ code: "BAD_REQUEST", message: "交接範圍包含不存在或無權存取的素材" });

  const revisions = ids.length ? await db.select().from(schema.assetRevisions)
    .where(inArray(schema.assetRevisions.assetId, ids)).orderBy(desc(schema.assetRevisions.createdAt)) : [];
  const sourceByAssetId = new Map<string, string>();
  for (const revision of revisions) {
    if (!sourceByAssetId.has(revision.assetId)) sourceByAssetId.set(revision.assetId, revision.sourceAssetId);
  }
  for (const candidate of deduped) candidate.sourceAssetId = sourceByAssetId.get(candidate.assetId) ?? null;

  for (const asset of assets) {
    const candidate = byAssetId.get(asset.id);
    if (!candidate || candidate.role === "PRIMARY_MEDIA") continue;
    if (asset.mime === "application/x-subrip" || /\.(srt|vtt)$/i.test(asset.title)) candidate.role = "SUBTITLE";
  }

  return { candidates: deduped, assets, contextByShot, questions };
}

export async function previewEditingHandoff(auth: AuthState, input: EditingSelectionInput & { primaryAssetOverrides?: Record<string, string> }) {
  const project = await loadEditableProject(auth, input.projectId);
  const selection = await resolveSelection(project.id, input);
  const collected = await collectEditingAssets(auth, project, selection.shots, input.primaryAssetOverrides);
  return {
    adapter: LUMAFUSION_ADAPTER,
    project: { id: project.id, title: project.title },
    selection: {
      type: input.selectionType,
      storySceneIds: selection.storySceneIds,
      shotIds: selection.shots.map((shot) => shot.id),
      storyScenes: selection.storyScenes.map((scene) => ({ id: scene.id, title: scene.title, orderIndex: scene.orderIndex })),
      shots: selection.shots.map((shot) => ({ id: shot.id, title: shot.title, orderIndex: shot.orderIndex, storySceneId: shot.storySceneId })),
    },
    assets: collected.assets.map((asset) => ({ id: asset.id, title: asset.title, kind: asset.kind, mime: asset.mime, sizeBytes: asset.sizeBytes, sha256: asset.sha256 })),
    questions: collected.questions,
  };
}

export async function prepareEditingHandoff(auth: AuthState, input: PrepareEditingHandoffInput) {
  if (input.editorId !== "lumafusion") throw new TRPCError({ code: "BAD_REQUEST", message: "尚未支援這個剪輯器" });
  const project = await loadEditableProject(auth, input.projectId);
  const selection = await resolveSelection(project.id, input);
  const collected = await collectEditingAssets(auth, project, selection.shots, input.primaryAssetOverrides);
  if (collected.questions.length) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "請先確認主要素材版本，再建立交接包" });
  }
  const now = new Date();
  const expiresAt = new Date(now.getTime() + EDITING_PACKAGE_TTL_HOURS * 60 * 60 * 1_000);

  return db.transaction(async (tx) => {
    const [session] = await tx.insert(schema.externalEditingSessions).values({
      editorId: input.editorId,
      projectId: project.id,
      groupId: project.groupId,
      userId: auth.user.id,
      selectionType: input.selectionType,
      storySceneIds: selection.storySceneIds,
      shotIds: selection.shots.map((shot) => shot.id),
      assetIds: collected.assets.map((asset) => asset.id),
      contextSnapshot: { byShot: collected.contextByShot, capturedAt: now.toISOString() },
      status: "preparing",
      originAssistantRunId: input.originAssistantRunId ?? null,
      originConversationId: input.originConversationId ?? null,
      originSurface: input.originSurface ?? null,
      returnContext: input.returnContext ?? null,
    }).returning();

    const byId = new Map(collected.candidates.map((candidate) => [candidate.assetId, candidate]));
    const shotById = new Map(selection.shots.map((shot) => [shot.id, shot]));
    const sceneById = new Map(selection.storyScenes.map((scene) => [scene.id, scene]));
    const manifest: EditingManifest = editingManifestSchema.parse({
      schema: "aios.external-editing-manifest",
      schemaVersion: "1.0",
      version: "1.0",
      createdAt: now.toISOString(),
      editor: { id: "lumafusion", name: LUMAFUSION_ADAPTER.name },
      editingSessionId: session.id,
      project: {
        id: project.id,
        title: project.title,
        aspectRatio: project.format ?? null,
        frameRate: null,
        timelineDurationMs: Math.round(selection.shots.reduce((sum, shot) => sum + (shot.durationSec ?? 0), 0) * 1_000),
      },
      selection: { type: input.selectionType, storySceneIds: selection.storySceneIds, shotIds: selection.shots.map((shot) => shot.id) },
      assets: collected.assets.map((asset, index) => {
        const candidate = byId.get(asset.id)!;
        const shot = candidate.shotId ? shotById.get(candidate.shotId) : null;
        const storyScene = candidate.storySceneId ? sceneById.get(candidate.storySceneId) : null;
        const location = [
          storyScene ? `S${String(Math.max(1, storyScene.orderIndex)).padStart(2, "0")}` : null,
          shot ? `SH${String(Math.max(1, shot.orderIndex)).padStart(3, "0")}` : null,
        ].filter(Boolean).join("_");
        const fileName = stableEditingFileName({
          index,
          role: candidate.role,
          title: [location, asset.title].filter(Boolean).join("_"),
          extension: extFromMime(asset.mime ?? ""),
        });
        const assetMeta = asset.meta && typeof asset.meta === "object" ? asset.meta as Record<string, unknown> : null;
        return {
          assetId: asset.id,
          fileName,
          relativePath: `media/${fileName}`,
          kind: asset.kind,
          role: candidate.role,
          mime: asset.mime,
          sizeBytes: asset.sizeBytes,
          sha256: asset.sha256,
          projectId: project.id,
          storySceneId: candidate.storySceneId,
          sceneId: candidate.storySceneId,
          shotId: candidate.shotId,
          sourceAssetId: candidate.sourceAssetId,
          durationMs: durationMsOf(asset),
          version: null,
          subtitle: candidate.role === "SUBTITLE" ? {
            sourceAssetId: asset.id,
            language: optionalMetaString(assetMeta, "language", "subtitleLanguage"),
            timingSource: optionalMetaString(assetMeta, "timingSource", "subtitleTimingSource"),
          } : null,
          locked: asset.locked || candidate.locked,
        };
      }),
      return: { method: "universal-intake", editingSessionId: session.id, acceptedKinds: ["video", "audio", "image", "doc"] },
      notes: [
        "此 ZIP 是媒體交接包，不是 LumaFusion 專案檔。",
        "請保留 aios-manifest.json，以便核對來源與回傳工作階段。",
      ],
    });
    const [editingPackage] = await tx.insert(schema.externalEditingPackages).values({
      sessionId: session.id,
      userId: auth.user.id,
      handoffMode: input.handoffMode,
      fileName: editingPackageFileName(project.title, session.id),
      manifest,
      assetIds: collected.assets.map((asset) => asset.id),
      expiresAt,
    }).returning();
    const [readySession] = await tx.update(schema.externalEditingSessions).set({ status: "ready", updatedAt: now })
      .where(eq(schema.externalEditingSessions.id, session.id)).returning();
    return { session: readySession, package: editingPackage, adapter: LUMAFUSION_ADAPTER };
  });
}

export async function listEditingSessions(auth: AuthState, projectId: string) {
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
  if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "找不到專案" });
  requireGroup(auth, project.groupId);
  const sessions = await db.select().from(schema.externalEditingSessions).where(and(
    eq(schema.externalEditingSessions.projectId, project.id),
    eq(schema.externalEditingSessions.groupId, project.groupId),
  )).orderBy(desc(schema.externalEditingSessions.createdAt)).limit(50);
  if (!sessions.length) return [];
  const packages = await db.select().from(schema.externalEditingPackages).where(inArray(
    schema.externalEditingPackages.sessionId,
    sessions.map((session) => session.id),
  )).orderBy(desc(schema.externalEditingPackages.createdAt));
  return sessions.map((session) => ({
    ...session,
    package: packages.find((item) => item.sessionId === session.id) ?? null,
    adapter: LUMAFUSION_ADAPTER,
  }));
}

export async function markEditingSessionHandedOff(auth: AuthState, sessionId: string) {
  const [session] = await db.select().from(schema.externalEditingSessions).where(eq(schema.externalEditingSessions.id, sessionId));
  if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "找不到剪輯工作階段" });
  requireGroup(auth, session.groupId);
  if (session.userId !== auth.user.id) throw new TRPCError({ code: "FORBIDDEN", message: "只有建立者可以更新交接狀態" });
  if (["cancelled", "completed", "failed"].includes(session.status)) return session;
  const [updated] = await db.update(schema.externalEditingSessions).set({
    status: session.status === "ready" ? "handed_off" : session.status,
    handedOffAt: session.handedOffAt ?? new Date(),
    updatedAt: new Date(),
  }).where(eq(schema.externalEditingSessions.id, session.id)).returning();
  return updated;
}

export async function reprepareEditingPackage(auth: AuthState, sessionId: string, handoffMode?: EditingHandoffMode) {
  const [session] = await db.select().from(schema.externalEditingSessions)
    .where(eq(schema.externalEditingSessions.id, sessionId));
  if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "找不到剪輯工作階段" });
  requireGroup(auth, session.groupId);
  if (session.userId !== auth.user.id) throw new TRPCError({ code: "FORBIDDEN", message: "只有建立者可以重新準備交接包" });
  if (["cancelled", "failed", "completed"].includes(session.status)) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "這個工作階段已結束，無法重新準備交接包" });
  }
  const project = await loadEditableProject(auth, session.projectId);
  const [latestPackage] = await db.select().from(schema.externalEditingPackages)
    .where(eq(schema.externalEditingPackages.sessionId, session.id))
    .orderBy(desc(schema.externalEditingPackages.createdAt)).limit(1);
  if (!latestPackage) throw new TRPCError({ code: "NOT_FOUND", message: "找不到原交接包" });

  const sourceManifest = editingManifestSchema.parse(latestPackage.manifest);
  const assets = session.assetIds.length ? await db.select().from(schema.assets).where(and(
    inArray(schema.assets.id, session.assetIds),
    eq(schema.assets.projectId, project.id),
    eq(schema.assets.groupId, project.groupId),
    isNull(schema.assets.deletedAt),
  )) : [];
  if (assets.length !== session.assetIds.length) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "部分原始素材已不存在或無權存取，無法重新準備" });
  }
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const now = new Date();
  const manifest = editingManifestSchema.parse({
    ...sourceManifest,
    createdAt: now.toISOString(),
    assets: sourceManifest.assets.map((item) => {
      const asset = assetById.get(item.assetId)!;
      return { ...item, mime: asset.mime, sizeBytes: asset.sizeBytes, sha256: asset.sha256, locked: asset.locked || item.locked };
    }),
  });
  const expiresAt = new Date(now.getTime() + EDITING_PACKAGE_TTL_HOURS * 60 * 60 * 1_000);

  return db.transaction(async (tx) => {
    await tx.update(schema.externalEditingPackages).set({ revokedAt: now, updatedAt: now })
      .where(and(eq(schema.externalEditingPackages.sessionId, session.id), isNull(schema.externalEditingPackages.revokedAt)));
    const [editingPackage] = await tx.insert(schema.externalEditingPackages).values({
      sessionId: session.id,
      userId: auth.user.id,
      handoffMode: handoffMode ?? latestPackage.handoffMode,
      fileName: editingPackageFileName(project.title, session.id),
      manifest,
      assetIds: session.assetIds,
      expiresAt,
    }).returning();
    const [updatedSession] = await tx.update(schema.externalEditingSessions).set({
      status: session.status === "preparing" ? "ready" : session.status,
      error: null,
      updatedAt: now,
    }).where(eq(schema.externalEditingSessions.id, session.id)).returning();
    return { session: updatedSession, package: editingPackage, adapter: LUMAFUSION_ADAPTER };
  });
}

export async function cancelEditingSession(auth: AuthState, sessionId: string) {
  const [session] = await db.select().from(schema.externalEditingSessions).where(eq(schema.externalEditingSessions.id, sessionId));
  if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "找不到剪輯工作階段" });
  requireGroup(auth, session.groupId);
  if (session.userId !== auth.user.id) throw new TRPCError({ code: "FORBIDDEN", message: "只有建立者可以取消交接" });
  if (["returned", "needs_review", "completed"].includes(session.status)) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "已有回傳成果，不能取消這個工作階段" });
  }
  const now = new Date();
  return db.transaction(async (tx) => {
    await tx.update(schema.externalEditingPackages).set({ revokedAt: now, updatedAt: now })
      .where(eq(schema.externalEditingPackages.sessionId, session.id));
    const [updated] = await tx.update(schema.externalEditingSessions).set({ status: "cancelled", updatedAt: now })
      .where(eq(schema.externalEditingSessions.id, session.id)).returning();
    return updated;
  });
}

export async function completeEditingSession(auth: AuthState, sessionId: string) {
  const [session] = await db.select().from(schema.externalEditingSessions).where(eq(schema.externalEditingSessions.id, sessionId));
  if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "找不到剪輯工作階段" });
  requireGroup(auth, session.groupId);
  await assertProjectEditable(auth, { id: session.projectId, groupId: session.groupId });
  if (!session.returnedAssetId) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "尚未回傳剪輯成果" });
  const [updated] = await db.update(schema.externalEditingSessions).set({ status: "completed", completedAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.externalEditingSessions.id, session.id)).returning();
  return updated;
}
