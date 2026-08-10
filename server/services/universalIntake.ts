import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db, schema } from "../db";
import { requireGroup } from "../trpc";
import type { AuthState } from "./auth";
import {
  MAX_FILE_BYTES,
  adoptTmpFile,
  checkDiskSpace,
  isAllowedUploadMime,
  kindFromMime,
  mimeFromPath,
  removeStoredFile,
  resolveUploadMime,
  tmpDir,
} from "./storage";
import { proxyFetch } from "./http";
import { assertPublicHostOrError, ssrfGuardError } from "./databaseFiles";
import { registerIntelligenceResource } from "./intelligenceLibrary";
import { recordLibraryUsage, registerLibraryResource } from "./libraryResources";
import { createAiTraceSession, recordAiTraceEventSafely, updateAiTraceSession } from "./aiTrace";
import { assertProjectEditable, assertProjectNotArchived } from "./projectAcl";
import {
  aspectRatioOf,
  deterministicMediaMetadataSchema,
  intakePageContextSchema,
  rankSceneMatches,
  shouldBlockDuplicate,
  type DeterministicMediaMetadata,
  type IntakePageContext,
  type IntakeSource,
} from "../../shared/universalIntake";

export interface IntakeFolderContext {
  sessionId: string;
  relativePath: string;
  parentPath: string;
  rootName: string | null;
}

export interface IntakeProvenance {
  source: IntakeSource;
  /** Only set from an explicit tool choice or an ExternalGenerationSession. */
  sourceTool?: string | null;
  importMethod: "file-picker" | "drag-drop" | "clipboard" | "url" | "google-drive" | "desktop" | "mobile-share" | "internal";
  originalUrl?: string | null;
  externalSessionId?: string | null;
  editingSessionId?: string | null;
  sourceExternalId?: string | null;
}

export interface IngestTmpAssetInput {
  auth: AuthState;
  project: typeof schema.projects.$inferSelect;
  tmpPath: string;
  originalName: string;
  mime: string;
  title?: string | null;
  provenance: IntakeProvenance;
  context?: IntakePageContext | null;
  mediaMetadata?: DeterministicMediaMetadata | null;
  forceDuplicate?: boolean;
  baseMeta?: Record<string, unknown>;
  folderImport?: IntakeFolderContext | null;
}

export type IngestTmpAssetResult =
  | {
    ok: false;
    duplicate: true;
    asset: typeof schema.assets.$inferSelect;
  }
  | {
    ok: true;
    duplicate: false;
    asset: typeof schema.assets.$inferSelect;
    traceSessionId: string | null;
    intelligenceId: string | null;
    libraryResourceId: string | null;
    suggestion: null | { bindingId: string; sceneId: string; score: number; reasons: string[] };
  };

export interface ImportUrlIntoProjectInput {
  auth: AuthState;
  projectId: string;
  url: string;
  source?: IntakeSource;
  sourceTool?: string;
  externalSessionId?: string;
  editingSessionId?: string;
  context?: IntakePageContext;
  mediaMetadata?: DeterministicMediaMetadata;
  forceDuplicate?: boolean;
}

export interface ImportDriveFileIntoProjectInput {
  auth: AuthState;
  projectId: string;
  fileId: string;
  externalSessionId?: string;
  editingSessionId?: string;
  context?: IntakePageContext;
  forceDuplicate?: boolean;
}

async function loadEditableIntakeProject(auth: AuthState, projectId: string) {
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
  if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "找不到專案" });
  requireGroup(auth, project.groupId);
  assertProjectNotArchived(project);
  await assertProjectEditable(auth, project);
  return project;
}

export async function sha256File(filePath: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function deterministicImageMetadata(tmpPath: string, mime: string): Promise<DeterministicMediaMetadata> {
  if (!mime.startsWith("image/")) return {};
  try {
    const imported = await import("sharp");
    const sharp = (imported.default ?? imported) as unknown as (input: string) => {
      metadata: () => Promise<{ width?: number; height?: number }>;
    };
    const meta = await sharp(tmpPath).metadata();
    return deterministicMediaMetadataSchema.parse({ width: meta.width, height: meta.height });
  } catch {
    // sharp is optional. Browser-probed dimensions remain available for direct uploads.
    return {};
  }
}

function normalizeMetadata(input: DeterministicMediaMetadata | null | undefined): DeterministicMediaMetadata {
  const parsed = deterministicMediaMetadataSchema.safeParse(input ?? {});
  return parsed.success ? parsed.data : {};
}

async function registerSidecars(input: {
  asset: typeof schema.assets.$inferSelect;
  userId: string;
  originalName: string;
  mime: string;
  sizeBytes: number;
  checksum: string;
  provenance: IntakeProvenance;
  folderImport?: IntakeFolderContext | null;
}): Promise<{ intelligenceId: string; libraryResourceId: string }> {
  const { asset, folderImport } = input;
  const sourceType = folderImport
    ? "folder_import"
    : input.provenance.editingSessionId || input.provenance.source === "external-editor"
      ? "external-editor"
    : input.provenance.sourceTool || input.provenance.externalSessionId
    ? "external-ai"
    : input.provenance.source === "internal-generation"
      ? "ai_generated"
      : input.provenance.source;
  const sourceMetadata = {
    filename: input.originalName,
    mime: input.mime,
    sizeBytes: input.sizeBytes,
    checksum: input.checksum,
    sourceType,
    sourceTool: input.provenance.sourceTool ?? null,
    importMethod: input.provenance.importMethod,
    originalUrl: input.provenance.originalUrl ?? null,
    externalSessionId: input.provenance.externalSessionId ?? null,
    editingSessionId: input.provenance.editingSessionId ?? null,
    sourceExternalId: input.provenance.sourceExternalId ?? null,
    ...(folderImport ? {
      folderImportSessionId: folderImport.sessionId,
      relativePath: folderImport.relativePath,
      parentPath: folderImport.parentPath,
      sourceRootName: folderImport.rootName,
    } : {}),
  };
  const intelligence = await registerIntelligenceResource({
    resourceKind: "asset",
    resourceId: asset.id,
    groupId: asset.groupId,
    projectId: asset.projectId,
    sourceType,
    sourceMetadata,
    createdBy: input.userId,
  });
  const library = await registerLibraryResource({
    groupId: asset.groupId,
    resourceKind: "asset",
    resourceId: asset.id,
    intelligenceId: intelligence.id,
    homeProjectId: asset.projectId,
    displayName: input.originalName || asset.title,
    mime: input.mime,
    sizeBytes: input.sizeBytes,
    checksum: input.checksum,
    sourceRootName: folderImport?.rootName ?? null,
    relativePath: folderImport?.relativePath ?? null,
    parentPath: folderImport?.parentPath ?? null,
    originType: sourceType,
    folderImportSessionId: folderImport?.sessionId ?? null,
    metadata: sourceMetadata,
    createdBy: input.userId,
  });
  await recordLibraryUsage({
    libraryResourceId: library.id,
    projectId: asset.projectId,
    groupId: asset.groupId,
    usage: "production",
    actorId: input.userId,
  });
  if (folderImport) {
    const { recordFolderImportEntryResult } = await import("./folderImport");
    await recordFolderImportEntryResult({
      sessionId: folderImport.sessionId,
      relativePath: folderImport.relativePath,
      status: "uploaded",
      resourceKind: "asset",
      resourceId: asset.id,
      libraryResourceId: library.id,
      intelligenceId: intelligence.id,
      checksum: input.checksum,
    });
  }
  return { intelligenceId: intelligence.id, libraryResourceId: library.id };
}

async function loadExternalSession(input: IngestTmpAssetInput) {
  const id = input.provenance.externalSessionId;
  const contextSceneId = input.context?.currentSceneId;
  const [session] = id
    ? await db.select().from(schema.externalGenerationSessions)
      .where(eq(schema.externalGenerationSessions.id, id))
    : contextSceneId
      ? await db.select().from(schema.externalGenerationSessions).where(and(
        eq(schema.externalGenerationSessions.userId, input.auth.user.id),
        eq(schema.externalGenerationSessions.projectId, input.project.id),
        eq(schema.externalGenerationSessions.sceneId, contextSceneId),
        sql`${schema.externalGenerationSessions.status} in ('prepared', 'opened_external', 'waiting_result')`,
      )).orderBy(desc(schema.externalGenerationSessions.createdAt)).limit(1)
      : [undefined];
  if (!session || session.userId !== input.auth.user.id || session.projectId !== input.project.id) return null;
  return session;
}

async function loadEditingSession(input: IngestTmpAssetInput) {
  const id = input.provenance.editingSessionId;
  if (!id) return null;
  const [session] = await db.select().from(schema.externalEditingSessions)
    .where(eq(schema.externalEditingSessions.id, id));
  if (!session || session.userId !== input.auth.user.id || session.projectId !== input.project.id || session.groupId !== input.project.groupId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "剪輯工作階段與目前專案不相符" });
  }
  if (["cancelled", "completed", "failed"].includes(session.status)) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "這個剪輯工作階段已結束，不能再回傳成果" });
  }
  return session;
}

async function persistEditingReturnBinding(input: {
  auth: AuthState;
  project: typeof schema.projects.$inferSelect;
  asset: typeof schema.assets.$inferSelect;
  session: typeof schema.externalEditingSessions.$inferSelect;
  intelligenceId: string | null;
  libraryResourceId: string | null;
}) {
  const scopeType = input.session.shotIds.length === 1
    ? "shot"
    : input.session.storySceneIds.length === 1
      ? "scene"
      : "project";
  const scopeId = scopeType === "shot"
    ? input.session.shotIds[0]!
    : scopeType === "scene"
      ? input.session.storySceneIds[0]!
      : input.project.id;
  const [binding] = await db.insert(schema.contextBindings).values({
    groupId: input.project.groupId,
    projectId: input.project.id,
    scopeType,
    scopeId,
    resourceKind: "asset",
    resourceId: input.asset.id,
    intelligenceId: input.intelligenceId,
    libraryResourceId: input.libraryResourceId,
    role: "DELIVERY_ASSET",
    priority: "PRIMARY",
    source: "AI_SUGGESTED",
    confidence: 1,
    confirmedByUser: false,
    note: `LumaFusion 回傳 · Editing Session ${input.session.id}`,
    createdBy: input.auth.user.id,
  }).onConflictDoUpdate({
    target: [
      schema.contextBindings.scopeType,
      schema.contextBindings.scopeId,
      schema.contextBindings.resourceKind,
      schema.contextBindings.resourceId,
      schema.contextBindings.role,
    ],
    set: { confidence: 1, updatedAt: new Date() },
  }).returning({ id: schema.contextBindings.id });
  return { bindingId: binding?.id ?? null, scopeType, scopeId };
}

async function persistEditingLineage(input: {
  auth: AuthState;
  asset: typeof schema.assets.$inferSelect;
  session: typeof schema.externalEditingSessions.$inferSelect;
  childIntelligenceId: string | null;
}) {
  if (!input.session.assetIds.length) return;
  const [editingPackage] = await db.select({ manifest: schema.externalEditingPackages.manifest })
    .from(schema.externalEditingPackages)
    .where(eq(schema.externalEditingPackages.sessionId, input.session.id))
    .orderBy(desc(schema.externalEditingPackages.createdAt)).limit(1);
  const manifestAssets = editingPackage?.manifest?.assets ?? [];
  const primaryAssetId = manifestAssets.find((entry) => entry.role === "PRIMARY_MEDIA" || entry.role === "PRIMARY_VIDEO")?.assetId
    ?? input.session.assetIds[0];
  if (primaryAssetId) {
    await db.insert(schema.assetRevisions).values({
      assetId: input.asset.id,
      sourceAssetId: primaryAssetId,
      projectId: input.session.projectId,
      groupId: input.session.groupId,
      editorId: input.session.editorId,
      createdBy: input.auth.user.id,
    }).onConflictDoNothing();
  }
  if (!input.childIntelligenceId) return;
  const parents = await db.select({ id: schema.assetIntelligence.id })
    .from(schema.assetIntelligence).where(and(
      eq(schema.assetIntelligence.resourceKind, "asset"),
      inArray(schema.assetIntelligence.resourceId, input.session.assetIds),
    ));
  for (const parent of parents) {
    await db.insert(schema.intelligenceVersionLinks).values({
      groupId: input.session.groupId,
      parentIntelligenceId: parent.id,
      childIntelligenceId: input.childIntelligenceId,
      versionKind: "external_edit",
      label: `LumaFusion · ${input.session.id}`,
      createdBy: input.auth.user.id,
    }).onConflictDoNothing();
  }
}

async function persistBestSuggestion(input: {
  auth: AuthState;
  project: typeof schema.projects.$inferSelect;
  asset: typeof schema.assets.$inferSelect;
  originalName: string;
  context?: IntakePageContext | null;
  sessionSceneId?: string | null;
  intelligenceId: string | null;
  libraryResourceId: string | null;
}) {
  const scenes = await db.select({
    id: schema.scenes.id,
    title: schema.scenes.title,
    orderIndex: schema.scenes.orderIndex,
    prompt: schema.scenes.prompt,
    action: schema.scenes.action,
    dialogue: schema.scenes.dialogue,
    voiceover: schema.scenes.voiceover,
  }).from(schema.scenes)
    .where(and(eq(schema.scenes.projectId, input.project.id), isNull(schema.scenes.deletedAt)));
  const [best] = rankSceneMatches({
    scenes,
    filename: input.originalName,
    contextSceneId: input.context?.currentSceneId,
    sessionSceneId: input.sessionSceneId ?? undefined,
    limit: 1,
  });
  if (!best) return null;
  const [binding] = await db.insert(schema.contextBindings).values({
    groupId: input.project.groupId,
    projectId: input.project.id,
    scopeType: "shot",
    scopeId: best.sceneId,
    resourceKind: "asset",
    resourceId: input.asset.id,
    intelligenceId: input.intelligenceId,
    libraryResourceId: input.libraryResourceId,
    role: "PRODUCTION_ASSET",
    priority: "PRIMARY",
    source: "AI_SUGGESTED",
    confidence: best.score,
    confirmedByUser: false,
    note: best.reasons.join("；").slice(0, 400),
    createdBy: input.auth.user.id,
  }).onConflictDoUpdate({
    target: [
      schema.contextBindings.scopeType,
      schema.contextBindings.scopeId,
      schema.contextBindings.resourceKind,
      schema.contextBindings.resourceId,
      schema.contextBindings.role,
    ],
    set: { confidence: best.score, note: best.reasons.join("；").slice(0, 400), updatedAt: new Date() },
  }).returning({ id: schema.contextBindings.id });
  return binding ? { bindingId: binding.id, ...best } : null;
}

/**
 * The canonical file finalisation path used by uploads and URL imports.
 * It never waits for AI analysis: bytes and Asset are committed first, then the
 * existing Intelligence queue continues in the background.
 */
export async function ingestTmpAsset(input: IngestTmpAssetInput): Promise<IngestTmpAssetResult> {
  const checksum = await sha256File(input.tmpPath);
  const [duplicate] = await db.select().from(schema.assets).where(and(
    eq(schema.assets.groupId, input.project.groupId),
    eq(schema.assets.sha256, checksum),
    isNull(schema.assets.deletedAt),
  )).orderBy(desc(schema.assets.createdAt)).limit(1);
  if (shouldBlockDuplicate({ duplicateAssetId: duplicate?.id, forceDuplicate: input.forceDuplicate })) {
    return { ok: false, duplicate: true, asset: duplicate! };
  }

  const contextResult = intakePageContextSchema.safeParse(input.context ?? {});
  const context = contextResult.success ? contextResult.data : {};
  const serverMedia = await deterministicImageMetadata(input.tmpPath, input.mime);
  const media = { ...normalizeMetadata(input.mediaMetadata), ...serverMedia };
  const session = await loadExternalSession(input);
  const editingSession = await loadEditingSession(input);
  const sourceType = editingSession ? "external-editor" : (input.provenance.sourceTool || session) ? "external-ai" : input.provenance.source;
  const provenance = {
    sourceType,
    sourceTool: editingSession?.editorId ?? input.provenance.sourceTool ?? session?.externalTool ?? null,
    importMethod: input.provenance.importMethod,
    originalFilename: input.originalName,
    originalUrl: input.provenance.originalUrl ?? null,
    externalSessionId: session?.id ?? input.provenance.externalSessionId ?? null,
    editingSessionId: editingSession?.id ?? input.provenance.editingSessionId ?? null,
    externalEditor: editingSession?.editorId ?? null,
    parentAssetIds: editingSession?.assetIds ?? [],
    sourceExternalId: input.provenance.sourceExternalId ?? null,
    importedAt: new Date().toISOString(),
  };
  const intakeMeta = {
    status: "processing",
    provenance,
    pageContext: context,
    media: {
      ...media,
      aspectRatio: aspectRatioOf(media.width, media.height),
    },
  };
  const { storagePath, sizeBytes } = await adoptTmpFile(input.tmpPath, input.mime);
  let committedAsset: typeof duplicate | undefined;
  try {
    const [created] = await db.insert(schema.assets).values({
      projectId: input.project.id,
      groupId: input.project.groupId,
      kind: kindFromMime(input.mime),
      title: (input.title?.trim() || input.originalName || "帶入成果").slice(0, 80),
      url: "",
      isAiGenerated: false,
      storagePath,
      mime: input.mime,
      sizeBytes,
      uploadedBy: input.auth.user.id,
      sha256: checksum,
      meta: { ...(input.baseMeta ?? {}), intake: intakeMeta },
    }).returning();
    const [asset] = await db.update(schema.assets).set({ url: `/api/assets/${created!.id}/file` })
      .where(eq(schema.assets.id, created!.id)).returning();
    committedAsset = asset;
    const sidecars = await registerSidecars({
      asset: asset!,
      userId: input.auth.user.id,
      originalName: input.originalName,
      mime: input.mime,
      sizeBytes,
      checksum,
      provenance: { ...input.provenance, sourceTool: provenance.sourceTool },
      folderImport: input.folderImport,
    }).catch((error) => {
      console.warn("[intake] sidecar registration deferred:", error instanceof Error ? error.message : error);
      return null;
    });
    const trace = await createAiTraceSession({
      groupId: input.project.groupId,
      projectId: input.project.id,
      userId: input.auth.user.id,
      mode: "intake",
      title: `帶入成果：${asset!.title}`,
      sourceType: "asset_intake",
      sourceId: asset!.id,
      summary: "素材已安全保存，正在整理可能的專案位置",
    }).catch(() => null);
    if (trace) {
      await recordAiTraceEventSafely({
        sessionId: trace.id,
        eventType: "prepared",
        summary: "接收並保存素材",
        payload: { assetId: asset!.id, mime: input.mime, sizeBytes, checksum },
      });
      await recordAiTraceEventSafely({
        sessionId: trace.id,
        eventType: "validation",
        summary: "檔案資訊已解析",
        payload: { ...media, aspectRatio: aspectRatioOf(media.width, media.height) },
      });
    }
    const editingBinding = editingSession ? await persistEditingReturnBinding({
      auth: input.auth,
      project: input.project,
      asset: asset!,
      session: editingSession,
      intelligenceId: sidecars?.intelligenceId ?? null,
      libraryResourceId: sidecars?.libraryResourceId ?? null,
    }) : null;
    const suggestion = editingSession ? null : await persistBestSuggestion({
        auth: input.auth,
        project: input.project,
        asset: asset!,
        originalName: input.originalName,
        context,
        sessionSceneId: session?.sceneId,
        intelligenceId: sidecars?.intelligenceId ?? null,
        libraryResourceId: sidecars?.libraryResourceId ?? null,
      });
    const nextMeta = {
      ...(asset!.meta as Record<string, unknown>),
      intake: {
        ...intakeMeta,
        status: "needs_review",
        traceSessionId: trace?.id ?? null,
        suggestion: suggestion ? {
          bindingId: suggestion.bindingId,
          sceneId: suggestion.sceneId,
          confidence: suggestion.score,
          reasons: suggestion.reasons,
        } : null,
        editingReturn: editingSession && editingBinding ? {
          editingSessionId: editingSession.id,
          editor: editingSession.editorId,
          bindingId: editingBinding.bindingId,
          scopeType: editingBinding.scopeType,
          scopeId: editingBinding.scopeId,
          parentAssetIds: editingSession.assetIds,
        } : null,
      },
    };
    const [updated] = await db.update(schema.assets).set({ meta: nextMeta })
      .where(eq(schema.assets.id, asset!.id)).returning();
    if (session) {
      await db.update(schema.externalGenerationSessions).set({
        status: "result_imported",
        importedAssetId: asset!.id,
        updatedAt: new Date(),
      }).where(eq(schema.externalGenerationSessions.id, session.id));
    }
    if (editingSession) {
      await persistEditingLineage({
        auth: input.auth,
        asset: updated!,
        session: editingSession,
        childIntelligenceId: sidecars?.intelligenceId ?? null,
      });
      await db.update(schema.externalEditingSessions).set({
        status: "needs_review",
        returnedAssetId: updated!.id,
        returnedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(schema.externalEditingSessions.id, editingSession.id));
    }
    if (trace) {
      await recordAiTraceEventSafely({
        sessionId: trace.id,
        eventType: "tool_result",
        summary: suggestion ? "找到可能對應的分鏡" : "尚未找到可靠位置，已放入待整理",
        payload: suggestion ?? { assetId: asset!.id, status: "needs_review" },
      });
      await updateAiTraceSession(trace.id, {
        status: "running",
        summary: suggestion ? "素材已保存並提出分鏡建議，等待使用者確認" : "素材已保存至待整理",
      }).catch(() => undefined);
    }
    return {
      ok: true,
      duplicate: false,
      asset: updated!,
      traceSessionId: trace?.id ?? null,
      intelligenceId: sidecars?.intelligenceId ?? null,
      libraryResourceId: sidecars?.libraryResourceId ?? null,
      suggestion,
    };
  } catch (error) {
    // The Asset row and bytes are the durable boundary. Suggestions, sidecars, and
    // trace events must never turn an already-saved upload into a failed upload.
    if (committedAsset) {
      console.warn("[intake] post-save organization deferred:", error instanceof Error ? error.message : error);
      const currentMeta = (committedAsset.meta as Record<string, unknown> | null) ?? {};
      const currentIntake = (currentMeta.intake as Record<string, unknown> | null) ?? {};
      const [recovered] = await db.update(schema.assets).set({
        meta: {
          ...currentMeta,
          intake: {
            ...currentIntake,
            status: "needs_review",
            organizationError: error instanceof Error ? error.message.slice(0, 300) : "organization_deferred",
          },
        },
      }).where(eq(schema.assets.id, committedAsset.id)).returning().catch(() => []);
      return {
        ok: true,
        duplicate: false,
        asset: recovered ?? committedAsset,
        traceSessionId: null,
        intelligenceId: null,
        libraryResourceId: null,
        suggestion: null,
      };
    }
    await removeStoredFile(storagePath).catch(() => undefined);
    throw error;
  }
}

/**
 * Service-level URL intake used by both the Intake router and Agent tools.
 * Keeping it here prevents the Command Center from reimplementing upload,
 * deduplication, provenance, Intelligence registration or context binding.
 */
export async function importUrlIntoProject(
  input: ImportUrlIntoProjectInput,
): Promise<IngestTmpAssetResult> {
  const project = await loadEditableIntakeProject(input.auth, input.projectId);
  let downloadedPath: string | null = null;
  try {
    const downloaded = await downloadPublicUrlToTmp(input.url);
    downloadedPath = downloaded.tmpPath;
    let mime = downloaded.mime;
    if (mime === "application/xhtml+xml") mime = "text/html";
    if (!mime || mime === "application/octet-stream") mime = mimeFromPath(downloaded.filename);
    const handle = await open(downloaded.tmpPath, "r");
    const head = Buffer.alloc(16);
    await handle.read(head, 0, 16, 0);
    await handle.close();
    const verdict = resolveUploadMime(mime, head);
    if (!verdict || !isAllowedUploadMime(verdict.mime)) {
      throw new TRPCError({ code: "UNSUPPORTED_MEDIA_TYPE", message: "連結內容不是支援的圖片、影片、音訊或文件" });
    }
    mime = verdict.mime;
    const size = (await stat(downloaded.tmpPath)).size;
    const diskError = await checkDiskSpace(size, true);
    if (diskError) throw new TRPCError({ code: "PRECONDITION_FAILED", message: diskError });
    const result = await ingestTmpAsset({
      auth: input.auth,
      project,
      tmpPath: downloaded.tmpPath,
      originalName: downloaded.filename,
      mime,
      provenance: {
        source: input.source ?? "url",
        sourceTool: input.sourceTool,
        importMethod: "url",
        originalUrl: downloaded.finalUrl,
        externalSessionId: input.externalSessionId,
        editingSessionId: input.editingSessionId,
      },
      context: input.context,
      mediaMetadata: input.mediaMetadata,
      forceDuplicate: input.forceDuplicate,
    });
    if (result.ok) downloadedPath = null;
    return result;
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "網址匯入失敗" });
  } finally {
    if (downloadedPath) await unlink(downloadedPath).catch(() => undefined);
  }
}

/** Drive bytes are fetched by the existing connector and immediately handed to
 * the same canonical finalisation path; they are never sent to the LLM. */
export async function importDriveFileIntoProject(
  input: ImportDriveFileIntoProjectInput,
): Promise<IngestTmpAssetResult> {
  const project = await loadEditableIntakeProject(input.auth, input.projectId);
  const { fetchDrivePickedFile } = await import("./integrations");
  const fetched = await fetchDrivePickedFile(input.auth.user.id, input.fileId);
  if (!fetched.ok) throw new TRPCError({ code: "BAD_REQUEST", message: fetched.message });
  let mime = fetched.mime || mimeFromPath(fetched.name);
  const verdict = resolveUploadMime(mime, fetched.buf.subarray(0, 16));
  if (!verdict || !isAllowedUploadMime(verdict.mime)) {
    throw new TRPCError({ code: "UNSUPPORTED_MEDIA_TYPE", message: "這個 Google Drive 檔案格式不支援帶入素材庫" });
  }
  mime = verdict.mime;
  const diskError = await checkDiskSpace(fetched.buf.length, true);
  if (diskError) throw new TRPCError({ code: "PRECONDITION_FAILED", message: diskError });
  const temporaryPath = path.join(tmpDir(), `drive-intake-${randomUUID()}.tmp`);
  await writeFile(temporaryPath, fetched.buf);
  let adopted = false;
  try {
    const result = await ingestTmpAsset({
      auth: input.auth,
      project,
      tmpPath: temporaryPath,
      originalName: fetched.name,
      mime,
      provenance: {
        source: "google-drive",
        importMethod: "google-drive",
        originalUrl: fetched.sourceUrl,
        externalSessionId: input.externalSessionId,
        editingSessionId: input.editingSessionId,
        sourceExternalId: input.fileId,
      },
      context: input.context,
      forceDuplicate: input.forceDuplicate,
      baseMeta: { sourceModifiedTime: fetched.modifiedTime },
    });
    adopted = result.ok;
    return result;
  } finally {
    if (!adopted) await unlink(temporaryPath).catch(() => undefined);
  }
}

function redirectLocation(base: string, location: string): string {
  return new URL(location, base).toString();
}

/** Streaming public URL download with SSRF checks repeated on every redirect. */
export async function downloadPublicUrlToTmp(rawUrl: string): Promise<{
  tmpPath: string;
  mime: string;
  finalUrl: string;
  filename: string;
}> {
  const initialError = ssrfGuardError(rawUrl);
  if (initialError) throw new Error(initialError);
  let current = rawUrl;
  for (let hop = 0; hop <= 5; hop += 1) {
    const url = new URL(current);
    const hostError = await assertPublicHostOrError(url.hostname);
    if (hostError) throw new Error(hostError);
    const response = await proxyFetch(current, { timeoutMs: 30_000, redirect: "manual" });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("網址重新導向不完整");
      current = redirectLocation(current, location);
      const redirectError = ssrfGuardError(current);
      if (redirectError) throw new Error(redirectError);
      continue;
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error("此連結需要外部登入，請先下載成果再匯入。");
    }
    if (!response.ok) throw new Error(`無法下載此連結（HTTP ${response.status}）`);
    const length = Number(response.headers.get("content-length") ?? 0);
    if (length > MAX_FILE_BYTES) throw new Error(`檔案太大（上限 ${Math.round(MAX_FILE_BYTES / 1024 / 1024)}MB）`);
    const mime = (response.headers.get("content-type") ?? "application/octet-stream").split(";", 1)[0]!.trim().toLowerCase();
    // Public HTML pages are valid Intelligence documents. They are stored as
    // attachment-served assets (storage enforces that policy) and indexed by
    // the existing document pipeline. Login walls still fail above at 401/403.
    const disposition = response.headers.get("content-disposition") ?? "";
    const named = disposition.match(/filename\*?=(?:UTF-8''|\")?([^";]+)/i)?.[1];
    const safeDecode = (value: string) => {
      try { return decodeURIComponent(value); } catch { return value; }
    };
    const urlName = safeDecode(path.posix.basename(url.pathname) || "external-result");
    const filename = named ? safeDecode(named.replace(/^"|"$/g, "")) : urlName;
    const tmpPath = path.join(tmpDir(), `intake-${randomUUID()}.tmp`);
    const handle = await open(tmpPath, "wx");
    let total = 0;
    try {
      const reader = response.body?.getReader();
      if (!reader) throw new Error("這個網址沒有可下載的內容");
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_FILE_BYTES) {
          await reader.cancel();
          throw new Error(`檔案太大（上限 ${Math.round(MAX_FILE_BYTES / 1024 / 1024)}MB）`);
        }
        await handle.write(value);
      }
    } catch (error) {
      await handle.close().catch(() => undefined);
      await unlink(tmpPath).catch(() => undefined);
      throw error;
    }
    await handle.close();
    return { tmpPath, mime, finalUrl: current, filename };
  }
  throw new Error("網址重新導向次數過多");
}
