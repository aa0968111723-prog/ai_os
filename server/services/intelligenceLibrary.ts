import { and, asc, desc, eq, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { db, schema } from "../db";
import type { AuthState } from "./auth";
import { listDataHubResources } from "./dataHub";
import type { DataHubResource } from "../../shared/dataHub";
import {
  INTELLIGENCE_ANALYSIS_VERSION,
  LOCAL_CLASSIFIER_MODEL,
  LOCAL_EMBEDDING_DIMENSIONS,
  LOCAL_EMBEDDING_MODEL,
  LOCAL_EMBEDDING_VERSION,
  canonicalTypeOf,
  chunkText,
  confidenceThresholds,
  contentHash,
  cosineSimilarity,
  featureHashEmbedding,
  lexicalOverlap,
  routeConfidence,
  type IntelligenceAnalysisProvider,
  type IntelligenceAnalysis,
  type IntelligenceExtractionStage,
} from "./intelligenceCore";
import { resolveIntelligenceProvider } from "./intelligenceProvider";
import { signAssetUrl, signDbFileUrl } from "./storage";
import {
  FACE_CLUSTER_MODEL,
  applyCategoryFeedback,
  clusterFaceObservations,
  extractEntityCandidates,
  feedbackRerankBoost,
  normalizeEntityName,
  parseLibraryQuery,
  semanticDuplicateThreshold,
  type FaceObservation,
} from "./intelligenceAdvanced";

export const INGESTION_STAGES = [
  "extract_metadata",
  "ocr",
  "transcription",
  "image_analysis",
  "video_analysis",
  "audio_analysis",
  "classification",
  "face_detection",
  "face_embedding",
  "face_clustering",
  "embedding",
  "dedupe",
  "relationship_detection",
] as const;
export type IngestionStage = typeof INGESTION_STAGES[number];

type IntelligenceRow = typeof schema.assetIntelligence.$inferSelect;

export interface RegisterIntelligenceInput {
  resourceKind: "asset" | "knowledge" | "document" | "table";
  resourceId: string;
  groupId: string;
  projectId?: string | null;
  sourceType: string;
  sourceMetadata?: Record<string, unknown>;
  createdBy?: string | null;
  batchId?: string | null;
  force?: boolean;
}

async function resourceAllowsAiAnalysis(input: Pick<RegisterIntelligenceInput, "resourceKind" | "resourceId">): Promise<boolean> {
  if (input.resourceKind === "table") {
    const [table] = await db.select({ id: schema.dataTables.id }).from(schema.dataTables)
      .where(and(
        eq(schema.dataTables.id, input.resourceId),
        isNull(schema.dataTables.deletedAt),
        ne(schema.dataTables.agentAccess, "none"),
      )).limit(1);
    return Boolean(table);
  }
  if (input.resourceKind === "document") {
    const [file] = await db.select({ id: schema.dataFiles.id }).from(schema.dataFiles)
      .innerJoin(schema.dataTables, eq(schema.dataTables.id, schema.dataFiles.tableId))
      .where(and(
        eq(schema.dataFiles.id, input.resourceId),
        isNull(schema.dataTables.deletedAt),
        ne(schema.dataTables.agentAccess, "none"),
      )).limit(1);
    return Boolean(file);
  }
  return true;
}

export async function registerIntelligenceResource(input: RegisterIntelligenceInput): Promise<IntelligenceRow> {
  if (!await resourceAllowsAiAnalysis(input)) {
    throw new Error("Resource is not enabled for AI analysis");
  }
  const now = new Date();
  const [row] = await db
    .insert(schema.assetIntelligence)
    .values({
      resourceKind: input.resourceKind,
      resourceId: input.resourceId,
      groupId: input.groupId,
      projectId: input.projectId ?? null,
      sourceType: input.sourceType,
      sourceMetadata: input.sourceMetadata ?? {},
      createdBy: input.createdBy ?? null,
    })
    .onConflictDoUpdate({
      target: [schema.assetIntelligence.resourceKind, schema.assetIntelligence.resourceId],
      set: {
        groupId: input.groupId,
        projectId: input.projectId ?? null,
        sourceType: input.sourceType,
        sourceMetadata: input.sourceMetadata ?? {},
        updatedAt: now,
        ...(input.force ? { analysisStatus: "pending" } : {}),
      },
    })
    .returning();
  const intelligence = row!;
  await enqueueStage(intelligence.id, "extract_metadata", {
    batchId: input.batchId,
    runKey: input.force ? `manual-${Date.now()}` : "initial",
  });
  return intelligence;
}

async function enqueueStage(
  intelligenceId: string,
  stage: IngestionStage,
  options: { batchId?: string | null; runKey?: string } = {},
): Promise<void> {
  const runKey = options.runKey ?? "initial";
  await db.insert(schema.intelligenceProcessingJobs).values({
    batchId: options.batchId ?? null,
    intelligenceId,
    stage,
    idempotencyKey: `${intelligenceId}:${stage}:${INTELLIGENCE_ANALYSIS_VERSION}:${runKey}`,
    modelVersion: stage === "embedding"
      ? LOCAL_EMBEDDING_MODEL
      : resolveIntelligenceProvider().modelVersion,
  }).onConflictDoNothing();
}

export async function createProcessingBatch(input: {
  groupId: string;
  projectId?: string | null;
  sourceType: string;
  totalItems: number;
  createdBy: string;
}): Promise<string> {
  const [batch] = await db.insert(schema.intelligenceProcessingBatches).values({
    ...input,
    projectId: input.projectId ?? null,
    status: "queued",
  }).returning({ id: schema.intelligenceProcessingBatches.id });
  return batch!.id;
}

interface ResourceSnapshot {
  intelligence: IntelligenceRow;
  title: string;
  text: string;
  mime: string | null;
  legacyKind: string | null;
  checksum: string | null;
  sourceType: string;
  mediaUrl: string | null;
  metadata: Record<string, unknown>;
}

const TABLE_INDEX_MAX_CHARS = 600_000;
const TABLE_INDEX_MAX_ROWS = 10_000;

export function serializeTableForIntelligence(input: {
  id: string;
  name: string;
  description?: string | null;
  fields: Array<{ key: string; label: string; type: string }>;
  rows: Array<{ id: string; data: unknown }>;
  totalRows?: number;
  maxChars?: number;
}): { text: string; indexedRows: number; truncated: boolean } {
  const maxChars = Math.min(2_000_000, Math.max(10_000, input.maxChars ?? TABLE_INDEX_MAX_CHARS));
  const header = [
    `資料表：${input.name}`,
    input.description ? `說明：${input.description}` : "",
    `欄位：${input.fields.map((field) => `${field.label}(${field.key}:${field.type})`).join("、")}`,
  ].filter(Boolean).join("\n");
  const lines = [header];
  let length = header.length;
  let indexedRows = 0;
  for (const row of input.rows) {
    const data = row.data && typeof row.data === "object" && !Array.isArray(row.data)
      ? row.data as Record<string, unknown> : {};
    const values = input.fields.flatMap((field) => {
      const value = data[field.key];
      if (value === null || value === undefined || value === "") return [];
      const rendered = typeof value === "object" ? JSON.stringify(value) : String(value);
      return [`${field.label}: ${rendered.slice(0, 2_000)}`];
    });
    const line = `[row:${row.id}] ${values.join(" | ") || "（空白資料列）"}`;
    if (length + line.length + 1 > maxChars) break;
    lines.push(line);
    length += line.length + 1;
    indexedRows += 1;
  }
  const totalRows = Math.max(input.rows.length, input.totalRows ?? input.rows.length);
  const truncated = indexedRows < input.rows.length || totalRows > input.rows.length;
  if (truncated) lines.push(`[索引已截斷：已納入 ${indexedRows}/${totalRows} 列，完整資料仍保留於原資料表]`);
  return { text: lines.join("\n"), indexedRows, truncated };
}

async function loadResourceSnapshot(intelligenceId: string): Promise<ResourceSnapshot | null> {
  const [intel] = await db.select().from(schema.assetIntelligence)
    .where(eq(schema.assetIntelligence.id, intelligenceId));
  if (!intel) return null;

  if (intel.resourceKind === "asset") {
    const [asset] = await db.select().from(schema.assets)
      .where(and(eq(schema.assets.id, intel.resourceId), isNull(schema.assets.deletedAt)));
    if (!asset) return null;
    const [description] = await db.select({ content: schema.knowledge.content })
      .from(schema.knowledge)
      .where(and(eq(schema.knowledge.sourceAssetId, asset.id), isNull(schema.knowledge.deletedAt)))
      .orderBy(desc(schema.knowledge.createdAt)).limit(1);
    return {
      intelligence: intel,
      title: asset.title,
      text: description?.content ?? "",
      mime: asset.mime,
      legacyKind: asset.kind,
      checksum: asset.sha256,
      sourceType: asset.isAiGenerated ? "ai_generated" : "upload",
      mediaUrl: asset.storagePath ? signAssetUrl(asset.id, 900) : (/^https?:\/\//i.test(asset.url) ? asset.url : null),
      metadata: {
        ...intel.metadata,
        filename: asset.title,
        sizeBytes: asset.sizeBytes,
        mime: asset.mime,
        createdAt: asset.createdAt.toISOString(),
        locked: asset.locked,
        legacyMeta: asset.meta,
      },
    };
  }

  if (intel.resourceKind === "knowledge") {
    const [knowledge] = await db.select().from(schema.knowledge)
      .where(and(eq(schema.knowledge.id, intel.resourceId), isNull(schema.knowledge.deletedAt)));
    if (!knowledge) return null;
    return {
      intelligence: intel,
      title: knowledge.title,
      text: knowledge.content,
      mime: "text/plain",
      legacyKind: knowledge.kind,
      checksum: contentHash(knowledge.content),
      sourceType: knowledge.sourceProvider ?? (knowledge.sourceAssetId ? "upload" : "manual"),
      mediaUrl: null,
      metadata: {
        ...intel.metadata,
        knowledgeKind: knowledge.kind,
        sourceUrl: knowledge.sourceUrl,
        sourceExternalId: knowledge.sourceExternalId,
        createdAt: knowledge.createdAt.toISOString(),
      },
    };
  }

  if (intel.resourceKind === "document") {
    const [file] = await db.select({
      id: schema.dataFiles.id,
      name: schema.dataFiles.name,
      mime: schema.dataFiles.mime,
      sizeBytes: schema.dataFiles.sizeBytes,
      textContent: schema.dataFiles.textContent,
      sourceProvider: schema.dataFiles.sourceProvider,
      sourceUrl: schema.dataFiles.sourceUrl,
      sourceExternalId: schema.dataFiles.sourceExternalId,
      storagePath: schema.dataFiles.storagePath,
      createdAt: schema.dataFiles.createdAt,
    }).from(schema.dataFiles)
      .innerJoin(schema.dataTables, eq(schema.dataTables.id, schema.dataFiles.tableId))
      .where(and(
        eq(schema.dataFiles.id, intel.resourceId),
        isNull(schema.dataTables.deletedAt),
        ne(schema.dataTables.agentAccess, "none"),
      ));
    if (!file) return null;
    return {
      intelligence: intel,
      title: file.name,
      text: file.textContent ?? "",
      mime: file.mime,
      legacyKind: "document",
      checksum: file.textContent ? contentHash(file.textContent) : null,
      sourceType: file.sourceProvider ?? (file.sourceUrl ? "url" : "upload"),
      mediaUrl: file.storagePath ? signDbFileUrl(file.id, 900) : (/^https?:\/\//i.test(file.sourceUrl ?? "") ? file.sourceUrl : null),
      metadata: {
        ...intel.metadata,
        filename: file.name,
        sizeBytes: file.sizeBytes,
        mime: file.mime,
        sourceUrl: file.sourceUrl,
        sourceExternalId: file.sourceExternalId,
        createdAt: file.createdAt.toISOString(),
      },
    };
  }
  if (intel.resourceKind === "table") {
    const [table] = await db.select().from(schema.dataTables)
      .where(and(
        eq(schema.dataTables.id, intel.resourceId),
        isNull(schema.dataTables.deletedAt),
        ne(schema.dataTables.agentAccess, "none"),
      ));
    if (!table || !table.groupId) return null;
    const [rows, [rowTotal]] = await Promise.all([
      db.select({ id: schema.dataRows.id, data: schema.dataRows.data })
        .from(schema.dataRows)
        .where(eq(schema.dataRows.tableId, table.id))
        .orderBy(asc(schema.dataRows.createdAt))
        .limit(TABLE_INDEX_MAX_ROWS),
      db.select({ count: sql<number>`count(*)::int` }).from(schema.dataRows)
        .where(eq(schema.dataRows.tableId, table.id)),
    ]);
    const tableFields = Array.isArray(table.fields)
      ? table.fields as Array<{ key: string; label: string; type: string }>
      : [];
    const rowCount = Number(rowTotal?.count ?? rows.length);
    const serialized = serializeTableForIntelligence({
      id: table.id,
      name: table.name,
      description: table.description,
      fields: tableFields,
      rows,
      totalRows: rowCount,
    });
    return {
      intelligence: intel,
      title: table.name,
      text: serialized.text,
      mime: "application/vnd.aios.database+json",
      legacyKind: "table",
      checksum: contentHash(serialized.text),
      sourceType: "manual",
      mediaUrl: null,
      metadata: {
        ...intel.metadata,
        tableId: table.id,
        scope: table.scope,
        rowCount,
        indexedRowCount: serialized.indexedRows,
        indexTruncated: serialized.truncated,
        fieldCount: tableFields.length,
        updatedAt: table.updatedAt.toISOString(),
      },
    };
  }
  return null;
}

async function processMetadata(snapshot: ResourceSnapshot): Promise<void> {
  const canonicalType = canonicalTypeOf({
    mime: snapshot.mime,
    name: snapshot.title,
    legacyKind: snapshot.legacyKind,
  });
  await db.update(schema.assetIntelligence).set({
    canonicalType,
    checksum: snapshot.checksum,
    sourceType: snapshot.sourceType,
    metadata: snapshot.metadata,
    analysisStatus: "processing",
    updatedAt: new Date(),
  }).where(eq(schema.assetIntelligence.id, snapshot.intelligence.id));
  await db.delete(schema.intelligenceDataSources)
    .where(eq(schema.intelligenceDataSources.intelligenceId, snapshot.intelligence.id));
  await db.insert(schema.intelligenceDataSources).values({
    intelligenceId: snapshot.intelligence.id,
    sourceType: snapshot.sourceType,
    sourceUrl: typeof snapshot.metadata.sourceUrl === "string" ? snapshot.metadata.sourceUrl : null,
    externalId: typeof snapshot.metadata.sourceExternalId === "string" ? snapshot.metadata.sourceExternalId : null,
    provider: snapshot.sourceType,
    metadata: snapshot.intelligence.sourceMetadata,
    syncedAt: new Date(),
  });
}

function nestedString(record: Record<string, unknown>, keys: string[]): string | null {
  const sources = [record, ...(Object.values(record).filter((value): value is Record<string, unknown> => (
    !!value && typeof value === "object" && !Array.isArray(value)
  )))];
  for (const source of sources) {
    for (const key of keys) {
      const value = source[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  return null;
}

async function processOptionalExtraction(
  snapshot: ResourceSnapshot,
  stage: IntelligenceExtractionStage,
  provider: IntelligenceAnalysisProvider,
): Promise<void> {
  const [latest] = await db.select().from(schema.assetIntelligence).where(eq(schema.assetIntelligence.id, snapshot.intelligence.id));
  if (!latest) return;
  const pipeline = latest.metadata.pipeline && typeof latest.metadata.pipeline === "object"
    ? latest.metadata.pipeline as Record<string, unknown> : {};
  const canonicalType = latest.canonicalType;
  const applies = stage === "ocr" ? ["IMAGE", "DOCUMENT", "PRESENTATION"].includes(canonicalType)
    : stage === "transcription" ? ["AUDIO", "VIDEO"].includes(canonicalType)
      : stage === "image_analysis" ? canonicalType === "IMAGE"
        : stage === "video_analysis" ? canonicalType === "VIDEO"
          : stage === "audio_analysis" ? canonicalType === "AUDIO"
            : ["IMAGE", "VIDEO"].includes(canonicalType);
  if (!applies) {
    await db.update(schema.assetIntelligence).set({ metadata: { ...latest.metadata, pipeline: { ...pipeline, [stage]: "not_applicable" } }, updatedAt: new Date() })
      .where(eq(schema.assetIntelligence.id, latest.id));
    return;
  }
  const legacyText = stage === "ocr"
    ? nestedString(snapshot.metadata, ["ocrText", "ocr", "extractedText"])
    : stage === "transcription" ? nestedString(snapshot.metadata, ["transcript", "transcription", "speechText"]) : null;
  const providerResult = !legacyText && provider.extract ? await provider.extract(stage, {
    intelligenceId: latest.id,
    groupId: latest.groupId,
    title: snapshot.title,
    canonicalType: latest.canonicalType as Parameters<IntelligenceAnalysisProvider["analyze"]>[0]["canonicalType"],
    mime: snapshot.mime,
    text: snapshot.text,
    mediaUrl: snapshot.mediaUrl,
    metadata: snapshot.metadata,
  }) : null;
  const extractedText = legacyText ?? providerResult?.text ?? null;
  if (extractedText) {
    await db.insert(schema.intelligenceSegments).values({
      intelligenceId: latest.id,
      segmentKind: stage === "ocr" ? "document_page" : "speech",
      ordinal: 0,
      text: extractedText,
      confidence: legacyText ? 1 : 0.9,
      metadata: legacyText ? { importedFromLegacyMetadata: true } : { provider: providerResult?.modelVersion },
    }).onConflictDoUpdate({
      target: [schema.intelligenceSegments.intelligenceId, schema.intelligenceSegments.segmentKind, schema.intelligenceSegments.ordinal],
      set: { text: extractedText, confidence: 1 },
    });
  }
  for (const segment of providerResult?.segments ?? []) {
    await db.insert(schema.intelligenceSegments).values({
      intelligenceId: latest.id,
      segmentKind: segment.kind,
      ordinal: segment.ordinal,
      startMs: segment.startMs ?? null,
      endMs: segment.endMs ?? null,
      text: segment.text ?? null,
      speaker: segment.speaker ?? null,
      confidence: segment.confidence ?? null,
      metadata: segment.metadata ?? {},
    }).onConflictDoUpdate({
      target: [schema.intelligenceSegments.intelligenceId, schema.intelligenceSegments.segmentKind, schema.intelligenceSegments.ordinal],
      set: {
        startMs: segment.startMs ?? null, endMs: segment.endMs ?? null, text: segment.text ?? null,
        speaker: segment.speaker ?? null, confidence: segment.confidence ?? null, metadata: segment.metadata ?? {},
      },
    });
  }
  if (stage === "face_detection" && providerResult?.faces) {
    await db.delete(schema.faceClusterMembers).where(eq(schema.faceClusterMembers.intelligenceId, latest.id));
    await db.delete(schema.detectedFaces).where(eq(schema.detectedFaces.intelligenceId, latest.id));
    if (providerResult.faces.length) await db.insert(schema.detectedFaces).values(providerResult.faces.map((face) => ({
      intelligenceId: latest.id,
      faceIndex: face.faceIndex,
      boundingBox: face.boundingBox,
      embedding: face.embedding,
      embeddingModel: face.embeddingModel ?? providerResult.modelVersion,
      quality: face.quality ?? null,
      status: face.embedding?.length ? "unclustered" : "detected",
    })));
  }
  let capabilityReady = Boolean(extractedText || providerResult);
  if (stage === "face_embedding" && !capabilityReady) {
    const [embedded] = await db.select({ id: schema.detectedFaces.id }).from(schema.detectedFaces)
      .where(and(eq(schema.detectedFaces.intelligenceId, latest.id), isNotNull(schema.detectedFaces.embedding))).limit(1);
    capabilityReady = Boolean(embedded);
  }
  const providerMetadata = providerResult?.metadata ?? {};
  await db.update(schema.assetIntelligence).set({
    metadata: {
      ...latest.metadata,
      ...providerMetadata,
      ...(providerResult?.analysis ? { providerAnalysis: providerResult.analysis } : {}),
      pipeline: { ...pipeline, [stage]: legacyText ? "extracted" : capabilityReady ? "provider_complete" : "provider_pending" },
      ...(providerResult ? { providerModels: { ...(latest.metadata.providerModels as Record<string, unknown> | undefined), [stage]: providerResult.modelVersion } } : {}),
    },
    updatedAt: new Date(),
  }).where(eq(schema.assetIntelligence.id, latest.id));
}

async function upsertTags(intelligence: IntelligenceRow, tags: string[], confidence: number): Promise<void> {
  for (const key of tags) {
    const [facet, value] = key.split(":", 2);
    const [tag] = await db.insert(schema.intelligenceTags).values({
      groupId: intelligence.groupId,
      key,
      label: (value ?? key).replace(/-/g, " "),
      facet: value ? facet : null,
      canonical: key.startsWith("type:"),
    }).onConflictDoUpdate({
      target: [schema.intelligenceTags.groupId, schema.intelligenceTags.key],
      set: { label: (value ?? key).replace(/-/g, " ") },
    }).returning({ id: schema.intelligenceTags.id });
    if (!tag) continue;
    await db.insert(schema.assetIntelligenceTags).values({
      intelligenceId: intelligence.id,
      tagId: tag.id,
      confidence,
      source: "ai",
      confirmed: false,
    }).onConflictDoUpdate({
      target: [schema.assetIntelligenceTags.intelligenceId, schema.assetIntelligenceTags.tagId],
      set: { confidence, source: "ai" },
    });
  }
}

async function ensureReviewItem(input: {
  intelligence: IntelligenceRow;
  kind: string;
  prompt: string;
  prediction: unknown;
  confidence: number;
}): Promise<void> {
  const [existing] = await db.select({ id: schema.aiReviewItems.id })
    .from(schema.aiReviewItems)
    .where(and(
      eq(schema.aiReviewItems.intelligenceId, input.intelligence.id),
      eq(schema.aiReviewItems.kind, input.kind),
      eq(schema.aiReviewItems.status, "pending"),
    )).limit(1);
  if (existing) {
    await db.update(schema.aiReviewItems).set({
      prompt: input.prompt,
      prediction: input.prediction,
      confidence: input.confidence,
      priority: Math.round((1 - input.confidence) * 100),
    }).where(eq(schema.aiReviewItems.id, existing.id));
    return;
  }
  await db.insert(schema.aiReviewItems).values({
    groupId: input.intelligence.groupId,
    projectId: input.intelligence.projectId,
    intelligenceId: input.intelligence.id,
    kind: input.kind,
    prompt: input.prompt,
    prediction: input.prediction,
    confidence: input.confidence,
    priority: Math.round((1 - input.confidence) * 100),
  });
}

async function processClassification(
  snapshot: ResourceSnapshot,
  provider: IntelligenceAnalysisProvider,
): Promise<void> {
  const canonicalType = canonicalTypeOf({ mime: snapshot.mime, name: snapshot.title, legacyKind: snapshot.legacyKind });
  const providerResult: IntelligenceAnalysis = snapshot.intelligence.resourceKind === "table" ? {
    category: "Structured Database",
    summary: `${snapshot.title}，共 ${Number(snapshot.metadata.rowCount ?? 0)} 列結構化資料`,
    description: snapshot.text.slice(0, 2_000),
    tags: [
      "type:spreadsheet",
      "source:database",
      "structure:table",
    ],
    categoryConfidence: 1,
    tagConfidence: 1,
    language: null,
    modelVersion: "aios-structured-database-v1",
    rationale: "資料表型態、欄位結構與列數來自資料庫 schema，不需模型猜測",
  } : await provider.analyze({
    intelligenceId: snapshot.intelligence.id,
    groupId: snapshot.intelligence.groupId,
    title: snapshot.title,
    canonicalType,
    mime: snapshot.mime,
    text: snapshot.text,
    mediaUrl: snapshot.mediaUrl,
    metadata: snapshot.metadata,
  });
  const feedback = await db.select({
    action: schema.aiFeedbackEvents.action,
    prediction: schema.aiFeedbackEvents.prediction,
    correction: schema.aiFeedbackEvents.userCorrection,
  }).from(schema.aiFeedbackEvents)
    .where(and(
      eq(schema.aiFeedbackEvents.groupId, snapshot.intelligence.groupId),
      eq(schema.aiFeedbackEvents.entityType, "category"),
    )).orderBy(desc(schema.aiFeedbackEvents.createdAt)).limit(100);
  const result = applyCategoryFeedback(providerResult, feedback);
  const routing = routeConfidence(result.categoryConfidence);
  await db.update(schema.assetIntelligence).set({
    canonicalType,
    category: result.category,
    summary: result.summary,
    description: result.description,
    language: result.language,
    dynamicTags: result.tags,
    categoryConfidence: result.categoryConfidence,
    tagConfidence: result.tagConfidence,
    projectConfidence: snapshot.intelligence.projectId ? 1 : null,
    metadata: {
      ...snapshot.metadata,
      ...(result.extractedMetadata ?? {}),
      ...(result.perceptualFingerprint ? { perceptualFingerprint: result.perceptualFingerprint } : {}),
    },
    analysisStatus: routing === "high" ? "processing" : "needs_review",
    modelVersion: result.modelVersion,
    analysisVersion: INTELLIGENCE_ANALYSIS_VERSION,
    lastAnalyzedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(schema.assetIntelligence.id, snapshot.intelligence.id));

  if (result.segments?.length) {
    const segmentKinds = [...new Set(result.segments.map((segment) => segment.kind))];
    await db.delete(schema.intelligenceSegments).where(and(
      eq(schema.intelligenceSegments.intelligenceId, snapshot.intelligence.id),
      inArray(schema.intelligenceSegments.segmentKind, segmentKinds),
    ));
    for (const segment of result.segments) {
      await db.insert(schema.intelligenceSegments).values({
        intelligenceId: snapshot.intelligence.id,
        segmentKind: segment.kind,
        ordinal: segment.ordinal,
        startMs: segment.startMs ?? null,
        endMs: segment.endMs ?? null,
        text: segment.text ?? null,
        speaker: segment.speaker ?? null,
        confidence: segment.confidence ?? null,
        metadata: segment.metadata ?? {},
      }).onConflictDoUpdate({
        target: [schema.intelligenceSegments.intelligenceId, schema.intelligenceSegments.segmentKind, schema.intelligenceSegments.ordinal],
        set: {
          startMs: segment.startMs ?? null, endMs: segment.endMs ?? null,
          text: segment.text ?? null, speaker: segment.speaker ?? null,
          confidence: segment.confidence ?? null, metadata: segment.metadata ?? {},
        },
      });
    }
  }
  const previousClusterRows = await db.select({ clusterId: schema.faceClusterMembers.clusterId })
    .from(schema.faceClusterMembers)
    .where(eq(schema.faceClusterMembers.intelligenceId, snapshot.intelligence.id));
  await db.delete(schema.faceClusterMembers)
    .where(eq(schema.faceClusterMembers.intelligenceId, snapshot.intelligence.id));
  await db.delete(schema.detectedFaces)
    .where(eq(schema.detectedFaces.intelligenceId, snapshot.intelligence.id));
  for (const clusterId of new Set(previousClusterRows.map((row) => row.clusterId))) {
    const remaining = await db.select({ id: schema.faceClusterMembers.id })
      .from(schema.faceClusterMembers)
      .where(eq(schema.faceClusterMembers.clusterId, clusterId));
    await db.update(schema.faceClusters).set({ faceCount: remaining.length, updatedAt: new Date() })
      .where(eq(schema.faceClusters.id, clusterId));
  }
  if (result.faces?.length) {
    await db.insert(schema.detectedFaces).values(result.faces.map((face) => ({
      intelligenceId: snapshot.intelligence.id,
      faceIndex: face.faceIndex,
      boundingBox: face.boundingBox,
      embedding: face.embedding,
      embeddingModel: face.embeddingModel ?? (face.embedding ? FACE_CLUSTER_MODEL : null),
      quality: face.quality ?? null,
      status: face.embedding?.length ? "unclustered" : "detected",
    })));
  }

  await db.update(schema.aiClassifications).set({ status: "superseded", updatedAt: new Date() })
    .where(and(
      eq(schema.aiClassifications.intelligenceId, snapshot.intelligence.id),
      inArray(schema.aiClassifications.dimension, ["category", "tags"]),
      ne(schema.aiClassifications.status, "superseded"),
    ));
  await db.insert(schema.aiClassifications).values([
    {
      intelligenceId: snapshot.intelligence.id,
      dimension: "category",
      value: result.category,
      confidence: result.categoryConfidence,
      routing,
      status: routing === "high" ? "accepted" : "suggested",
      rationale: result.rationale,
      modelVersion: result.modelVersion,
    },
    {
      intelligenceId: snapshot.intelligence.id,
      dimension: "tags",
      value: result.tags,
      confidence: result.tagConfidence,
      routing: routeConfidence(result.tagConfidence),
      status: routeConfidence(result.tagConfidence) === "high" ? "accepted" : "suggested",
      rationale: "從標題、可讀文字與來源 metadata 萃取多維標籤",
      modelVersion: result.modelVersion,
    },
  ]);
  await db.delete(schema.assetIntelligenceTags).where(and(
    eq(schema.assetIntelligenceTags.intelligenceId, snapshot.intelligence.id),
    eq(schema.assetIntelligenceTags.source, "ai"),
    eq(schema.assetIntelligenceTags.confirmed, false),
  ));
  await upsertTags(snapshot.intelligence, result.tags, result.tagConfidence);
  if (routing !== "high") {
    await ensureReviewItem({
      intelligence: snapshot.intelligence,
      kind: "category",
      prompt: "這份資料的分類正確嗎？",
      prediction: { category: result.category, tags: result.tags, title: snapshot.title },
      confidence: result.categoryConfidence,
    });
  } else {
    // A model upgrade or richer extraction can turn an earlier uncertain
    // suggestion into a deterministic/high-confidence result. Do not leave a
    // stale pending card that describes the superseded prediction.
    await db.update(schema.aiReviewItems).set({
      status: "resolved",
      resolution: { autoResolved: true, category: result.category, tags: result.tags },
      resolvedAt: new Date(),
    }).where(and(
      eq(schema.aiReviewItems.intelligenceId, snapshot.intelligence.id),
      eq(schema.aiReviewItems.kind, "category"),
      eq(schema.aiReviewItems.status, "pending"),
    ));
  }
}

async function processEmbedding(snapshot: ResourceSnapshot): Promise<void> {
  const [latest] = await db.select().from(schema.assetIntelligence)
    .where(eq(schema.assetIntelligence.id, snapshot.intelligence.id));
  if (!latest) return;
  const documentText = snapshot.text.trim() || [snapshot.title, latest.category, latest.summary, ...(latest.dynamicTags ?? [])]
    .filter(Boolean).join("\n");
  const chunks = chunkText(documentText);
  await db.delete(schema.intelligenceEmbeddings).where(eq(schema.intelligenceEmbeddings.intelligenceId, latest.id));
  await db.delete(schema.intelligenceChunks).where(eq(schema.intelligenceChunks.intelligenceId, latest.id));
  const sourceChunks = chunks.length ? chunks : [snapshot.title];
  for (let ordinal = 0; ordinal < sourceChunks.length; ordinal += 1) {
    const text = sourceChunks[ordinal]!;
    const [chunk] = await db.insert(schema.intelligenceChunks).values({
      intelligenceId: latest.id,
      ordinal,
      text,
      tokenCount: Math.max(1, Math.ceil(text.length / 3)),
      contentHash: contentHash(text),
      metadata: { title: snapshot.title },
    }).returning({ id: schema.intelligenceChunks.id });
    await db.insert(schema.intelligenceEmbeddings).values({
      intelligenceId: latest.id,
      chunkId: chunk!.id,
      embeddingKind: latest.canonicalType === "IMAGE" ? "image_text" : "text",
      vector: featureHashEmbedding(text),
      dimensions: LOCAL_EMBEDDING_DIMENSIONS,
      embeddingModel: LOCAL_EMBEDDING_MODEL,
      embeddingVersion: LOCAL_EMBEDDING_VERSION,
      embeddingStatus: "ready",
    });
  }
}

async function processFaceClustering(snapshot: ResourceSnapshot): Promise<void> {
  const pending = await db.select().from(schema.detectedFaces)
    .where(and(
      eq(schema.detectedFaces.intelligenceId, snapshot.intelligence.id),
      eq(schema.detectedFaces.status, "unclustered"),
    ));
  const observations: FaceObservation[] = pending.flatMap((face) => Array.isArray(face.embedding) && face.embedding.length
    ? [{
      intelligenceId: face.intelligenceId,
      faceIndex: face.faceIndex,
      embedding: face.embedding,
      quality: face.quality ?? undefined,
      boundingBox: face.boundingBox ?? undefined,
    }]
    : []);
  if (!observations.length) return;

  const existing = await db.select({
    clusterId: schema.detectedFaces.clusterId,
    embedding: schema.detectedFaces.embedding,
  }).from(schema.detectedFaces)
    .innerJoin(schema.assetIntelligence, eq(schema.assetIntelligence.id, schema.detectedFaces.intelligenceId))
    .where(and(
      eq(schema.assetIntelligence.groupId, snapshot.intelligence.groupId),
      ne(schema.detectedFaces.intelligenceId, snapshot.intelligence.id),
    ));
  const threshold = Number(process.env.INTELLIGENCE_FACE_SIMILARITY ?? 0.86);
  const unmatched: FaceObservation[] = [];
  for (const observation of observations) {
    let best: { clusterId: string; similarity: number } | null = null;
    for (const candidate of existing) {
      if (!candidate.clusterId || !Array.isArray(candidate.embedding)) continue;
      const similarity = cosineSimilarity(observation.embedding, candidate.embedding);
      if (!best || similarity > best.similarity) best = { clusterId: candidate.clusterId, similarity };
    }
    if (best && best.similarity >= threshold) {
      await db.update(schema.detectedFaces).set({
        clusterId: best.clusterId, status: "clustered", updatedAt: new Date(),
      }).where(and(
        eq(schema.detectedFaces.intelligenceId, observation.intelligenceId),
        eq(schema.detectedFaces.faceIndex, observation.faceIndex),
      ));
      await db.insert(schema.faceClusterMembers).values({
        clusterId: best.clusterId,
        intelligenceId: observation.intelligenceId,
        faceIndex: observation.faceIndex,
        boundingBox: observation.boundingBox,
        embedding: observation.embedding,
        embeddingModel: FACE_CLUSTER_MODEL,
        similarity: best.similarity,
      }).onConflictDoNothing();
      await db.update(schema.faceClusters).set({
        faceCount: sql`${schema.faceClusters.faceCount} + 1`,
        updatedAt: new Date(),
      }).where(eq(schema.faceClusters.id, best.clusterId));
    } else {
      unmatched.push(observation);
    }
  }

  const clusters = clusterFaceObservations(unmatched, threshold);
  const [countRow] = await db.select({ count: sql<number>`count(*)::int` })
    .from(schema.faceClusters)
    .where(eq(schema.faceClusters.groupId, snapshot.intelligence.groupId));
  let ordinal = Number(countRow?.count ?? 0);
  for (const cluster of clusters) {
    ordinal += 1;
    const representative = cluster.members[0]!;
    const [created] = await db.insert(schema.faceClusters).values({
      groupId: snapshot.intelligence.groupId,
      projectId: snapshot.intelligence.projectId,
      label: `未命名人物 ${String(ordinal).padStart(2, "0")}`,
      representativeIntelligenceId: representative.intelligenceId,
      faceCount: cluster.members.length,
      confidence: cluster.confidence,
      status: "unconfirmed",
    }).returning({ id: schema.faceClusters.id });
    if (!created) continue;
    await db.insert(schema.faceClusterMembers).values(cluster.members.map((member) => ({
      clusterId: created.id,
      intelligenceId: member.intelligenceId,
      faceIndex: member.faceIndex,
      boundingBox: member.boundingBox,
      embedding: member.embedding,
      embeddingModel: FACE_CLUSTER_MODEL,
      similarity: cosineSimilarity(cluster.centroid, member.embedding),
    }))).onConflictDoNothing();
    for (const member of cluster.members) {
      await db.update(schema.detectedFaces).set({
        clusterId: created.id, status: "clustered", updatedAt: new Date(),
      }).where(and(
        eq(schema.detectedFaces.intelligenceId, member.intelligenceId),
        eq(schema.detectedFaces.faceIndex, member.faceIndex),
      ));
    }
    await ensureReviewItem({
      intelligence: snapshot.intelligence,
      kind: "person",
      prompt: "這個人物是誰？",
      prediction: { clusterId: created.id, label: `未命名人物 ${String(ordinal).padStart(2, "0")}` },
      confidence: Math.min(0.94, cluster.confidence),
    });
  }
}

async function addDuplicatePair(input: {
  intelligence: IntelligenceRow;
  otherId: string;
  method: string;
  similarity: number;
}): Promise<void> {
  const [membership] = await db.select({ groupId: schema.duplicateGroupMembers.duplicateGroupId })
    .from(schema.duplicateGroupMembers)
    .where(eq(schema.duplicateGroupMembers.intelligenceId, input.otherId)).limit(1);
  let duplicateGroupId = membership?.groupId;
  if (!duplicateGroupId) {
    const [group] = await db.insert(schema.duplicateGroups).values({
      groupId: input.intelligence.groupId,
      method: input.method,
      primaryIntelligenceId: input.otherId,
    }).returning({ id: schema.duplicateGroups.id });
    duplicateGroupId = group!.id;
    await db.insert(schema.duplicateGroupMembers).values({
      duplicateGroupId,
      intelligenceId: input.otherId,
      similarity: 1,
    }).onConflictDoNothing();
  }
  await db.insert(schema.duplicateGroupMembers).values({
    duplicateGroupId,
    intelligenceId: input.intelligence.id,
    similarity: input.similarity,
  }).onConflictDoNothing();
}

async function processDeduplication(snapshot: ResourceSnapshot): Promise<void> {
  const checksum = snapshot.checksum;
  if (checksum) {
    const [other] = await db.select({ id: schema.assetIntelligence.id })
      .from(schema.assetIntelligence)
      .where(and(
        eq(schema.assetIntelligence.groupId, snapshot.intelligence.groupId),
        eq(schema.assetIntelligence.checksum, checksum),
        ne(schema.assetIntelligence.id, snapshot.intelligence.id),
      )).limit(1);
    if (other) {
      await addDuplicatePair({ intelligence: snapshot.intelligence, otherId: other.id, method: "checksum", similarity: 1 });
      return;
    }
  }

  const [ownEmbedding] = await db.select({ vector: schema.intelligenceEmbeddings.vector })
    .from(schema.intelligenceEmbeddings)
    .where(and(
      eq(schema.intelligenceEmbeddings.intelligenceId, snapshot.intelligence.id),
      eq(schema.intelligenceEmbeddings.embeddingStatus, "ready"),
    )).limit(1);
  if (!Array.isArray(ownEmbedding?.vector)) return;
  const candidates = await db.select({
    id: schema.assetIntelligence.id,
    vector: schema.intelligenceEmbeddings.vector,
  }).from(schema.assetIntelligence)
    .innerJoin(schema.intelligenceEmbeddings, eq(schema.intelligenceEmbeddings.intelligenceId, schema.assetIntelligence.id))
    .where(and(
      eq(schema.assetIntelligence.groupId, snapshot.intelligence.groupId),
      eq(schema.assetIntelligence.canonicalType, snapshot.intelligence.canonicalType),
      ne(schema.assetIntelligence.id, snapshot.intelligence.id),
      eq(schema.intelligenceEmbeddings.embeddingStatus, "ready"),
    ));
  let best: { id: string; similarity: number } | null = null;
  for (const candidate of candidates) {
    if (!Array.isArray(candidate.vector)) continue;
    const similarity = cosineSimilarity(ownEmbedding.vector, candidate.vector);
    if (!best || similarity > best.similarity) best = { id: candidate.id, similarity };
  }
  if (best && best.similarity >= semanticDuplicateThreshold()) {
    await addDuplicatePair({
      intelligence: snapshot.intelligence,
      otherId: best.id,
      method: snapshot.intelligence.canonicalType === "IMAGE" ? "perceptual_near" : "semantic_near",
      similarity: best.similarity,
    });
  }
}

async function processRelationships(snapshot: ResourceSnapshot): Promise<void> {
  const projectId = snapshot.intelligence.projectId;
  await db.delete(schema.entityRelationships).where(and(
    eq(schema.entityRelationships.fromType, "asset_intelligence"),
    eq(schema.entityRelationships.fromId, snapshot.intelligence.id),
    inArray(schema.entityRelationships.source, ["ai", "rule", "system"]),
  ));
  await db.delete(schema.assetIntelligenceEntities).where(and(
    eq(schema.assetIntelligenceEntities.intelligenceId, snapshot.intelligence.id),
    inArray(schema.assetIntelligenceEntities.source, ["ai", "rule"]),
  ));
  const upsertRelationship = async (input: {
    relationType: string; toType: string; toId: string; confidence: number; source?: string; status?: string;
  }) => {
    const relationshipStatus = input.status ?? (routeConfidence(input.confidence) === "high" ? "confirmed" : "suggested");
    await db.insert(schema.entityRelationships).values({
      groupId: snapshot.intelligence.groupId,
      projectId,
      fromType: "asset_intelligence",
      fromId: snapshot.intelligence.id,
      relationType: input.relationType,
      toType: input.toType,
      toId: input.toId,
      confidence: input.confidence,
      source: input.source ?? "ai",
      status: relationshipStatus,
    }).onConflictDoUpdate({
      target: [
        schema.entityRelationships.fromType,
        schema.entityRelationships.fromId,
        schema.entityRelationships.relationType,
        schema.entityRelationships.toType,
        schema.entityRelationships.toId,
      ],
      set: { confidence: input.confidence, status: relationshipStatus, updatedAt: new Date() },
    });
  };
  if (projectId) {
    await upsertRelationship({ relationType: "BELONGS_TO", toType: "project", toId: projectId, confidence: 1, source: "system", status: "confirmed" });
  }
  if (snapshot.intelligence.resourceKind === "table") {
    const [[table], bindings] = await Promise.all([
      db.select({ fields: schema.dataTables.fields }).from(schema.dataTables)
        .where(eq(schema.dataTables.id, snapshot.intelligence.resourceId)),
      db.select({ projectId: schema.projectDataBindings.projectId }).from(schema.projectDataBindings)
        .where(and(
          eq(schema.projectDataBindings.resourceKind, "table"),
          eq(schema.projectDataBindings.resourceId, snapshot.intelligence.resourceId),
        )),
    ]);
    const projectKeys = Array.isArray(table?.fields)
      ? (table.fields as Array<{ key?: unknown; type?: unknown }>)
        .filter((field) => field.type === "project" && typeof field.key === "string")
        .map((field) => field.key as string)
      : [];
    const rows = projectKeys.length ? await db.select({ data: schema.dataRows.data }).from(schema.dataRows)
      .where(eq(schema.dataRows.tableId, snapshot.intelligence.resourceId))
      .orderBy(asc(schema.dataRows.createdAt))
      .limit(TABLE_INDEX_MAX_ROWS) : [];
    const canonicalUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const candidateProjectIds = new Set(bindings.map((binding) => binding.projectId));
    for (const row of rows) {
      const data = row.data && typeof row.data === "object" && !Array.isArray(row.data)
        ? row.data as Record<string, unknown> : {};
      for (const key of projectKeys) {
        const value = data[key];
        if (typeof value === "string" && canonicalUuid.test(value)) candidateProjectIds.add(value);
      }
    }
    const projectCandidates = [...candidateProjectIds].filter((id) => canonicalUuid.test(id));
    const linkedProjects = projectCandidates.length ? await db.select({ id: schema.projects.id }).from(schema.projects)
      .where(and(
        eq(schema.projects.groupId, snapshot.intelligence.groupId),
        inArray(schema.projects.id, projectCandidates),
      )) : [];
    for (const linkedProject of linkedProjects) {
      await upsertRelationship({
        relationType: "BELONGS_TO",
        toType: "project",
        toId: linkedProject.id,
        confidence: 1,
        source: "system",
        status: "confirmed",
      });
    }
  }

  const [latest] = await db.select().from(schema.assetIntelligence)
    .where(eq(schema.assetIntelligence.id, snapshot.intelligence.id));
  const searchableText = [snapshot.title, snapshot.text, latest?.summary, latest?.description, ...(latest?.dynamicTags ?? [])]
    .filter(Boolean).join("\n");
  if (projectId) {
    const [characters, scenePresets, scenes, people] = await Promise.all([
      db.select({ id: schema.characters.id, name: schema.characters.name }).from(schema.characters)
        .where(eq(schema.characters.projectId, projectId)),
      db.select({ id: schema.scenePresets.id, name: schema.scenePresets.name }).from(schema.scenePresets)
        .where(eq(schema.scenePresets.projectId, projectId)),
      db.select({ id: schema.scenes.id, title: schema.scenes.title }).from(schema.scenes)
        .where(and(eq(schema.scenes.projectId, projectId), isNull(schema.scenes.deletedAt))),
      db.select({ id: schema.people.id, name: schema.people.name }).from(schema.people)
        .where(and(eq(schema.people.groupId, snapshot.intelligence.groupId), eq(schema.people.projectId, projectId))),
    ]);
    for (const character of characters) {
      if (character.name.length >= 2 && searchableText.includes(character.name)) {
        await upsertRelationship({ relationType: "MENTIONS", toType: "character", toId: character.id, confidence: 0.93 });
      }
    }
    for (const preset of scenePresets) {
      if (preset.name.length >= 2 && searchableText.includes(preset.name)) {
        await upsertRelationship({ relationType: "RELATED_TO", toType: "location", toId: preset.id, confidence: 0.9 });
      }
    }
    for (const scene of scenes) {
      if (scene.title.length >= 2 && searchableText.includes(scene.title)) {
        await upsertRelationship({ relationType: "REFERENCE_FOR", toType: "shot", toId: scene.id, confidence: 0.88 });
      }
    }
    for (const person of people) {
      if (person.name.length >= 2 && searchableText.includes(person.name)) {
        await upsertRelationship({ relationType: "MENTIONS", toType: "person", toId: person.id, confidence: 0.94 });
      }
    }
  }

  for (const candidate of extractEntityCandidates(searchableText)) {
    const normalizedName = normalizeEntityName(candidate.name);
    const [entity] = await db.insert(schema.intelligenceEntities).values({
      groupId: snapshot.intelligence.groupId,
      projectId,
      entityType: candidate.type,
      name: candidate.name,
      normalizedName,
    }).onConflictDoUpdate({
      target: [
        schema.intelligenceEntities.groupId,
        schema.intelligenceEntities.projectId,
        schema.intelligenceEntities.entityType,
        schema.intelligenceEntities.normalizedName,
      ],
      set: { updatedAt: new Date() },
    }).returning({ id: schema.intelligenceEntities.id });
    if (!entity) continue;
    await db.insert(schema.assetIntelligenceEntities).values({
      intelligenceId: snapshot.intelligence.id,
      entityId: entity.id,
      relationType: "MENTIONS",
      confidence: candidate.confidence,
      source: "rule",
      status: routeConfidence(candidate.confidence) === "high" ? "confirmed" : "suggested",
    }).onConflictDoUpdate({
      target: [
        schema.assetIntelligenceEntities.intelligenceId,
        schema.assetIntelligenceEntities.entityId,
        schema.assetIntelligenceEntities.relationType,
      ],
      set: { confidence: candidate.confidence, updatedAt: new Date() },
    });
    await upsertRelationship({ relationType: "MENTIONS", toType: candidate.type.toLowerCase(), toId: entity.id, confidence: candidate.confidence, source: "rule" });
  }

  if (snapshot.intelligence.resourceKind === "asset") {
    const revisions = await db.select().from(schema.assetRevisions).where(or(
      eq(schema.assetRevisions.assetId, snapshot.intelligence.resourceId),
      eq(schema.assetRevisions.sourceAssetId, snapshot.intelligence.resourceId),
    ));
    for (const revision of revisions) {
      const assetIds = [revision.sourceAssetId, revision.assetId];
      const rows = await db.select({ id: schema.assetIntelligence.id, resourceId: schema.assetIntelligence.resourceId })
        .from(schema.assetIntelligence)
        .where(and(eq(schema.assetIntelligence.resourceKind, "asset"), inArray(schema.assetIntelligence.resourceId, assetIds)));
      const parent = rows.find((row) => row.resourceId === revision.sourceAssetId);
      const child = rows.find((row) => row.resourceId === revision.assetId);
      if (!parent || !child) continue;
      await db.insert(schema.intelligenceVersionLinks).values({
        groupId: revision.groupId,
        parentIntelligenceId: parent.id,
        childIntelligenceId: child.id,
        versionKind: "edited",
        createdBy: revision.createdBy,
        createdAt: revision.createdAt,
      }).onConflictDoNothing();
    }
    if (projectId) {
      const usedByScenes = await db.select({ id: schema.scenes.id }).from(schema.scenes).where(and(
        eq(schema.scenes.projectId, projectId),
        or(
          eq(schema.scenes.assetId, snapshot.intelligence.resourceId),
          eq(schema.scenes.narrationAssetId, snapshot.intelligence.resourceId),
          eq(schema.scenes.musicAssetId, snapshot.intelligence.resourceId),
          eq(schema.scenes.ambienceAssetId, snapshot.intelligence.resourceId),
        ),
      ));
      for (const scene of usedByScenes) {
        await upsertRelationship({ relationType: "USED_IN", toType: "shot", toId: scene.id, confidence: 1, source: "system", status: "confirmed" });
      }
    }
  }
}

const NEXT_STAGE = new Map<IngestionStage, IngestionStage | null>([
  ["extract_metadata", "ocr"],
  ["ocr", "transcription"],
  ["transcription", "image_analysis"],
  ["image_analysis", "video_analysis"],
  ["video_analysis", "audio_analysis"],
  ["audio_analysis", "classification"],
  ["classification", "face_detection"],
  ["face_detection", "face_embedding"],
  ["face_embedding", "face_clustering"],
  ["face_clustering", "embedding"],
  ["embedding", "dedupe"],
  ["dedupe", "relationship_detection"],
  ["relationship_detection", null],
]);

export function nextIngestionStage(stage: IngestionStage): IngestionStage | null {
  return NEXT_STAGE.get(stage) ?? null;
}

export function completedAnalysisStatus(currentStatus: string | null | undefined, failedJobs: number): "ready" | "needs_review" | "partial" {
  if (failedJobs > 0) return "partial";
  return currentStatus === "needs_review" ? "needs_review" : "ready";
}

export async function processIntelligenceJob(
  job: typeof schema.intelligenceProcessingJobs.$inferSelect,
  provider: IntelligenceAnalysisProvider = resolveIntelligenceProvider(),
): Promise<void> {
  const snapshot = await loadResourceSnapshot(job.intelligenceId);
  if (!snapshot) throw new Error("來源資料已不存在或已移入回收桶");
  switch (job.stage as IngestionStage) {
    case "extract_metadata": await processMetadata(snapshot); break;
    case "ocr": await processOptionalExtraction(snapshot, "ocr", provider); break;
    case "transcription": await processOptionalExtraction(snapshot, "transcription", provider); break;
    case "image_analysis": await processOptionalExtraction(snapshot, "image_analysis", provider); break;
    case "video_analysis": await processOptionalExtraction(snapshot, "video_analysis", provider); break;
    case "audio_analysis": await processOptionalExtraction(snapshot, "audio_analysis", provider); break;
    case "classification": await processClassification(snapshot, provider); break;
    case "face_detection": await processOptionalExtraction(snapshot, "face_detection", provider); break;
    case "face_embedding": await processOptionalExtraction(snapshot, "face_embedding", provider); break;
    case "face_clustering": await processFaceClustering(snapshot); break;
    case "embedding": await processEmbedding(snapshot); break;
    case "dedupe": await processDeduplication(snapshot); break;
    case "relationship_detection": await processRelationships(snapshot); break;
    default: throw new Error(`不支援的 ingestion stage：${job.stage}`);
  }
}

export type IntelligenceJobOutcome = "completed" | "requeued" | "idle";

export async function claimAndProcessIntelligenceJob(
  provider: IntelligenceAnalysisProvider = resolveIntelligenceProvider(),
): Promise<IntelligenceJobOutcome> {
  const [candidate] = await db.select().from(schema.intelligenceProcessingJobs)
    .where(eq(schema.intelligenceProcessingJobs.status, "queued"))
    .orderBy(asc(schema.intelligenceProcessingJobs.createdAt)).limit(1);
  if (!candidate) return "idle";
  const [claimed] = await db.update(schema.intelligenceProcessingJobs).set({
    status: "running",
    progress: 5,
    attempt: candidate.attempt + 1,
    claimedAt: new Date(),
    startedAt: new Date(),
    updatedAt: new Date(),
  }).where(and(
    eq(schema.intelligenceProcessingJobs.id, candidate.id),
    eq(schema.intelligenceProcessingJobs.status, "queued"),
  )).returning();
  if (!claimed) return "idle";

  const next = nextIngestionStage(claimed.stage as IngestionStage);
  try {
    await processIntelligenceJob(claimed, provider);
    await db.update(schema.intelligenceProcessingJobs).set({
      status: "done", progress: 100, error: null, completedAt: new Date(), updatedAt: new Date(),
    }).where(eq(schema.intelligenceProcessingJobs.id, claimed.id));
    if (next) {
      await enqueueStage(claimed.intelligenceId, next, { batchId: claimed.batchId, runKey: jobRunKey(claimed.idempotencyKey) });
    } else {
      const [[failed], [latest]] = await Promise.all([
        db.select({ count: sql<number>`count(*)::int` })
          .from(schema.intelligenceProcessingJobs)
          .where(and(
            eq(schema.intelligenceProcessingJobs.intelligenceId, claimed.intelligenceId),
            eq(schema.intelligenceProcessingJobs.status, "failed"),
          )),
        db.select({ analysisStatus: schema.assetIntelligence.analysisStatus })
          .from(schema.assetIntelligence)
          .where(eq(schema.assetIntelligence.id, claimed.intelligenceId)),
      ]);
      const analysisStatus = completedAnalysisStatus(latest?.analysisStatus, Number(failed?.count ?? 0));
      await db.update(schema.assetIntelligence).set({
        analysisStatus,
        updatedAt: new Date(),
      }).where(eq(schema.assetIntelligence.id, claimed.intelligenceId));
    }
  } catch (error) {
    const terminal = claimed.attempt >= claimed.maxAttempts;
    await db.update(schema.intelligenceProcessingJobs).set({
      status: terminal ? "failed" : "queued",
      progress: 0,
      error: error instanceof Error ? error.message.slice(0, 800) : "處理失敗",
      completedAt: terminal ? new Date() : null,
      updatedAt: new Date(),
    }).where(eq(schema.intelligenceProcessingJobs.id, claimed.id));
    if (terminal) {
      await db.update(schema.assetIntelligence).set({ analysisStatus: "partial", updatedAt: new Date() })
        .where(eq(schema.assetIntelligence.id, claimed.intelligenceId));
      // A failed capability must not block independent downstream capabilities.
      if (next) await enqueueStage(claimed.intelligenceId, next, { batchId: claimed.batchId, runKey: jobRunKey(claimed.idempotencyKey) });
    }
    if (claimed.batchId) await refreshProcessingBatch(claimed.batchId);
    return terminal ? "completed" : "requeued";
  }
  if (claimed.batchId) await refreshProcessingBatch(claimed.batchId);
  return "completed";
}

function jobRunKey(idempotencyKey: string): string {
  return idempotencyKey.split(":").slice(3).join(":") || "initial";
}

async function refreshProcessingBatch(batchId: string): Promise<void> {
  const jobs = await db.select({
    intelligenceId: schema.intelligenceProcessingJobs.intelligenceId,
    status: schema.intelligenceProcessingJobs.status,
  }).from(schema.intelligenceProcessingJobs).where(eq(schema.intelligenceProcessingJobs.batchId, batchId));
  const perAsset = new Map<string, string[]>();
  for (const job of jobs) perAsset.set(job.intelligenceId, [...(perAsset.get(job.intelligenceId) ?? []), job.status]);
  let completedItems = 0; let failedItems = 0; let activeItems = 0;
  for (const statuses of perAsset.values()) {
    if (statuses.some((status) => status === "queued" || status === "running")) activeItems += 1;
    else {
      completedItems += 1;
      if (statuses.some((status) => status === "failed")) failedItems += 1;
    }
  }
  await db.update(schema.intelligenceProcessingBatches).set({
    completedItems,
    failedItems,
    status: activeItems > 0 ? "processing" : "done",
    completedAt: activeItems > 0 ? null : new Date(),
    updatedAt: new Date(),
  }).where(eq(schema.intelligenceProcessingBatches.id, batchId));
}

/** Enrols old rows in small slices; no production-blocking migration backfill. */
export async function enrollLegacyIntelligence(limit = 12): Promise<number> {
  const perKind = Math.max(1, Math.floor(limit / 4));
  const [assets, knowledge, documents, tables] = await Promise.all([
    db.select({
      id: schema.assets.id, groupId: schema.assets.groupId, projectId: schema.assets.projectId,
      createdBy: schema.assets.uploadedBy, isAiGenerated: schema.assets.isAiGenerated,
    }).from(schema.assets)
      .leftJoin(schema.assetIntelligence, and(
        eq(schema.assetIntelligence.resourceKind, "asset"),
        eq(schema.assetIntelligence.resourceId, schema.assets.id),
      ))
      .where(and(isNull(schema.assets.deletedAt), isNull(schema.assetIntelligence.id)))
      .limit(perKind),
    db.select({
      id: schema.knowledge.id, groupId: schema.knowledge.groupId, projectId: schema.knowledge.projectId,
      createdBy: schema.knowledge.createdBy, source: schema.knowledge.sourceProvider,
    }).from(schema.knowledge)
      .leftJoin(schema.assetIntelligence, and(
        eq(schema.assetIntelligence.resourceKind, "knowledge"),
        eq(schema.assetIntelligence.resourceId, schema.knowledge.id),
      ))
      .where(and(isNull(schema.knowledge.deletedAt), isNull(schema.assetIntelligence.id)))
      .limit(perKind),
    db.select({
      id: schema.dataFiles.id, groupId: schema.dataTables.groupId,
      createdBy: schema.dataFiles.uploadedBy, source: schema.dataFiles.sourceProvider,
    }).from(schema.dataFiles)
      .innerJoin(schema.dataTables, eq(schema.dataTables.id, schema.dataFiles.tableId))
      .leftJoin(schema.assetIntelligence, and(
        eq(schema.assetIntelligence.resourceKind, "document"),
        eq(schema.assetIntelligence.resourceId, schema.dataFiles.id),
      ))
      .where(and(
        isNull(schema.dataTables.deletedAt),
        ne(schema.dataTables.agentAccess, "none"),
        isNull(schema.assetIntelligence.id),
      ))
      .limit(perKind),
    db.select({
      id: schema.dataTables.id,
      groupId: schema.dataTables.groupId,
      createdBy: schema.dataTables.createdBy,
      intelligenceId: schema.assetIntelligence.id,
      analysisStatus: schema.assetIntelligence.analysisStatus,
    }).from(schema.dataTables)
      .leftJoin(schema.assetIntelligence, and(
        eq(schema.assetIntelligence.resourceKind, "table"),
        eq(schema.assetIntelligence.resourceId, schema.dataTables.id),
      ))
      .where(and(
        isNull(schema.dataTables.deletedAt),
        isNotNull(schema.dataTables.groupId),
        ne(schema.dataTables.agentAccess, "none"),
        or(
          isNull(schema.assetIntelligence.id),
          and(
            sql`${schema.assetIntelligence.analysisStatus} not in ('pending', 'processing')`,
            sql`${schema.dataTables.updatedAt} > coalesce(${schema.assetIntelligence.lastAnalyzedAt}, timestamp 'epoch')`,
            or(
              ne(schema.assetIntelligence.analysisStatus, "partial"),
              sql`${schema.assetIntelligence.updatedAt} < now() - interval '1 hour'`,
            ),
          ),
        ),
      ))
      .orderBy(asc(schema.dataTables.updatedAt))
      .limit(perKind),
  ]);
  for (const row of assets) await registerIntelligenceResource({
    resourceKind: "asset", resourceId: row.id, groupId: row.groupId, projectId: row.projectId,
    sourceType: row.isAiGenerated ? "ai_generated" : "upload", createdBy: row.createdBy,
  });
  for (const row of knowledge) await registerIntelligenceResource({
    resourceKind: "knowledge", resourceId: row.id, groupId: row.groupId, projectId: row.projectId,
    sourceType: row.source ?? "manual", createdBy: row.createdBy,
  });
  for (const row of documents) {
    if (!row.groupId) continue;
    await registerIntelligenceResource({
      resourceKind: "document", resourceId: row.id, groupId: row.groupId, projectId: null,
      sourceType: row.source ?? "upload", createdBy: row.createdBy,
    });
  }
  for (const row of tables) {
    if (!row.groupId) continue;
    await registerIntelligenceResource({
      resourceKind: "table",
      resourceId: row.id,
      groupId: row.groupId,
      projectId: null,
      sourceType: "manual",
      createdBy: row.createdBy,
      force: Boolean(row.intelligenceId),
    });
  }
  return assets.length + knowledge.length + documents.length + tables.length;
}

export type IntelligenceBackfillMode = "pending" | "model_changed" | "all";

export function isIntelligenceBackfillEligible(
  row: Pick<IntelligenceRow, "analysisStatus" | "analysisVersion" | "modelVersion">,
  mode: IntelligenceBackfillMode,
  targetModelVersion: string,
): boolean {
  if (mode === "all") return true;
  if (mode === "pending") return ["pending", "partial", "failed"].includes(row.analysisStatus);
  return row.analysisVersion !== INTELLIGENCE_ANALYSIS_VERSION || row.modelVersion !== targetModelVersion;
}

/** Schedules a bounded, resumable re-analysis. It never performs provider work in the request. */
export async function scheduleIntelligenceBackfill(input: {
  groupId: string;
  projectId?: string | null;
  mode: IntelligenceBackfillMode;
  limit: number;
  createdBy: string;
  dryRun?: boolean;
  targetModelVersion?: string;
}): Promise<{ batchId: string | null; scheduled: number; eligible: number }> {
  const targetModelVersion = input.targetModelVersion ?? resolveIntelligenceProvider().modelVersion;
  const boundedLimit = Math.min(500, Math.max(1, input.limit));
  const rows = await db.select().from(schema.assetIntelligence).where(and(
    eq(schema.assetIntelligence.groupId, input.groupId),
    ...(input.projectId ? [eq(schema.assetIntelligence.projectId, input.projectId)] : []),
  )).orderBy(asc(schema.assetIntelligence.updatedAt)).limit(Math.min(2_000, boundedLimit * 4));
  const eligibleRows = rows.filter((row) => isIntelligenceBackfillEligible(row, input.mode, targetModelVersion));
  const selected = eligibleRows.slice(0, boundedLimit);
  if (input.dryRun || !selected.length) return { batchId: null, scheduled: 0, eligible: eligibleRows.length };
  const batchId = await createProcessingBatch({
    groupId: input.groupId,
    projectId: input.projectId,
    sourceType: `backfill:${input.mode}`,
    totalItems: selected.length,
    createdBy: input.createdBy,
  });
  const runKey = `backfill-${INTELLIGENCE_ANALYSIS_VERSION}-${targetModelVersion}-${Date.now()}`;
  await db.update(schema.assetIntelligence).set({ analysisStatus: "pending", updatedAt: new Date() })
    .where(inArray(schema.assetIntelligence.id, selected.map((row) => row.id)));
  for (const row of selected) await enqueueStage(row.id, "extract_metadata", { batchId, runKey });
  return { batchId, scheduled: selected.length, eligible: eligibleRows.length };
}

export interface HybridSearchResult {
  resource: DataHubResource;
  score: number;
  scoreBreakdown: { metadata: number; fullText: number; semantic: number; relationship: number; entity: number; feedback: number };
  intelligence: null | {
    id: string;
    canonicalType: string;
    category: string | null;
    summary: string | null;
    tags: string[];
    confidence: number | null;
    analysisStatus: string;
  };
  sourceTrace: Array<{ kind: string; label: string; score: number }>;
}

export function filterVisibleIntelligenceRows<T extends { resourceKind: string; resourceId: string }>(
  visible: readonly Pick<DataHubResource, "kind" | "rawId">[],
  rows: readonly T[],
): T[] {
  const allowed = new Set(visible.map((resource) => `${resource.kind}:${resource.rawId}`));
  return rows.filter((row) => allowed.has(`${row.resourceKind}:${row.resourceId}`));
}

export function filterAiReadableResources<T extends Pick<DataHubResource, "ai">>(resources: readonly T[]): T[] {
  return resources.filter((resource) => resource.ai.access !== "none");
}

export async function hybridSearchIntelligence(
  auth: AuthState,
  input: { q: string; projectId?: string; limit?: number },
): Promise<{ results: HybridSearchResult[]; retrievalDebug: Record<string, unknown>; retrievalRunId: string | null }> {
  const started = Date.now();
  const parsed = parseLibraryQuery(input.q);
  const listed = await listDataHubResources(auth, { projectId: input.projectId, perKindLimit: 200 });
  // Human-visible is not the same as AI-readable. In particular, database
  // owners can keep a table visible in the UI while agentAccess=none. Apply
  // that boundary before loading any chunks or embeddings.
  const visible = {
    ...listed,
    resources: filterAiReadableResources(listed.resources),
  };
  const ids = [...new Set(visible.resources.map((resource) => resource.rawId))];
  const allRows = ids.length ? await db.select().from(schema.assetIntelligence)
    .where(inArray(schema.assetIntelligence.resourceId, ids)) : [];
  const rows = filterVisibleIntelligenceRows(visible.resources, allRows);
  const byResource = new Map(rows.map((row) => [`${row.resourceKind}:${row.resourceId}`, row]));
  const intelligenceIds = rows.map((row) => row.id);
  const searchQuery = sql`websearch_to_tsquery('simple', ${parsed.positive})`;
  const intelligenceDocument = sql`to_tsvector('simple', coalesce(${schema.assetIntelligence.summary}, '') || ' ' || coalesce(${schema.assetIntelligence.description}, '') || ' ' || coalesce(${schema.assetIntelligence.category}, ''))`;
  const chunkDocument = sql`to_tsvector('simple', ${schema.intelligenceChunks.text})`;
  const [intelligenceTextRows, chunkTextRows] = intelligenceIds.length ? await Promise.all([
    db.select({
      intelligenceId: schema.assetIntelligence.id,
      rank: sql<number>`ts_rank_cd(${intelligenceDocument}, ${searchQuery})::real`,
    }).from(schema.assetIntelligence).where(and(
      inArray(schema.assetIntelligence.id, intelligenceIds),
      sql`${intelligenceDocument} @@ ${searchQuery}`,
    )),
    db.select({
      intelligenceId: schema.intelligenceChunks.intelligenceId,
      rank: sql<number>`max(ts_rank_cd(${chunkDocument}, ${searchQuery}))::real`,
    }).from(schema.intelligenceChunks).where(and(
      inArray(schema.intelligenceChunks.intelligenceId, intelligenceIds),
      sql`${chunkDocument} @@ ${searchQuery}`,
    )).groupBy(schema.intelligenceChunks.intelligenceId),
  ]) : [[], []];
  const databaseTextRanks = new Map<string, number>();
  for (const item of [...intelligenceTextRows, ...chunkTextRows]) {
    databaseTextRanks.set(item.intelligenceId, Math.max(databaseTextRanks.get(item.intelligenceId) ?? 0, Number(item.rank)));
  }
  const embeddings = intelligenceIds.length ? await db.select({
    intelligenceId: schema.intelligenceEmbeddings.intelligenceId,
    vector: schema.intelligenceEmbeddings.vector,
  }).from(schema.intelligenceEmbeddings).where(and(
    inArray(schema.intelligenceEmbeddings.intelligenceId, intelligenceIds),
    eq(schema.intelligenceEmbeddings.embeddingStatus, "ready"),
  )) : [];
  const vectors = new Map<string, number[][]>();
  for (const item of embeddings) {
    if (!Array.isArray(item.vector)) continue;
    const grouped = vectors.get(item.intelligenceId);
    if (grouped) grouped.push(item.vector);
    else vectors.set(item.intelligenceId, [item.vector]);
  }
  const entityRows = intelligenceIds.length ? await db.select({
    intelligenceId: schema.assetIntelligenceEntities.intelligenceId,
    name: schema.intelligenceEntities.name,
  }).from(schema.assetIntelligenceEntities)
    .innerJoin(schema.intelligenceEntities, eq(schema.intelligenceEntities.id, schema.assetIntelligenceEntities.entityId))
    .where(inArray(schema.assetIntelligenceEntities.intelligenceId, intelligenceIds)) : [];
  const entityNames = new Map<string, string[]>();
  for (const row of entityRows) entityNames.set(row.intelligenceId, [...(entityNames.get(row.intelligenceId) ?? []), row.name]);
  const relationshipRows = intelligenceIds.length ? await db.select({
    intelligenceId: schema.entityRelationships.fromId,
    count: sql<number>`count(*)::int`,
  }).from(schema.entityRelationships).where(and(
    eq(schema.entityRelationships.fromType, "asset_intelligence"),
    inArray(schema.entityRelationships.fromId, intelligenceIds),
  )).groupBy(schema.entityRelationships.fromId) : [];
  const relationshipCounts = new Map(relationshipRows.map((row) => [row.intelligenceId, Number(row.count)]));
  const groupIds = [...new Set(auth.groups.map((group) => group.groupId))];
  const feedbackEvents = groupIds.length ? await db.select({
    action: schema.aiFeedbackEvents.action,
    prediction: schema.aiFeedbackEvents.prediction,
    correction: schema.aiFeedbackEvents.userCorrection,
    createdBy: schema.aiFeedbackEvents.createdBy,
  }).from(schema.aiFeedbackEvents).where(and(
    inArray(schema.aiFeedbackEvents.groupId, groupIds),
    ...(input.projectId ? [or(eq(schema.aiFeedbackEvents.projectId, input.projectId), isNull(schema.aiFeedbackEvents.projectId))!] : []),
  )).orderBy(desc(schema.aiFeedbackEvents.createdAt)).limit(300) : [];
  const queryVector = featureHashEmbedding(parsed.positive);
  const normalizedQuery = parsed.positive.normalize("NFKC").toLocaleLowerCase("zh-TW");

  const scored = visible.resources.map<HybridSearchResult>((resource) => {
    const intelligence = byResource.get(`${resource.kind}:${resource.rawId}`);
    const tags = intelligence?.dynamicTags ?? [];
    const entities = intelligence ? entityNames.get(intelligence.id) ?? [] : [];
    const candidate = [resource.title, resource.projectTitle, intelligence?.category, intelligence?.summary, intelligence?.description, ...tags, ...entities]
      .filter(Boolean).join(" ");
    const normalizedCandidate = candidate.normalize("NFKC").toLocaleLowerCase("zh-TW");
    const metadata = normalizedCandidate.includes(normalizedQuery) ? 1 : lexicalOverlap(parsed.positive, [resource.title, intelligence?.category, ...tags].filter(Boolean).join(" "));
    const fullText = Math.max(
      lexicalOverlap(parsed.positive, candidate),
      Math.min(1, (databaseTextRanks.get(intelligence?.id ?? "") ?? 0) * 4),
    );
    const semantic = intelligence
      ? Math.max(0, ...(vectors.get(intelligence.id) ?? []).map((vector) => cosineSimilarity(queryVector, vector)))
      : 0;
    const entity = lexicalOverlap(parsed.positive, entities.join(" "));
    const relationship = Math.min(1, (input.projectId && resource.projectId === input.projectId ? 0.7 : 0)
      + Math.min(0.3, (relationshipCounts.get(intelligence?.id ?? "") ?? 0) * 0.05));
    const feedback = feedbackRerankBoost({
      query: parsed.positive,
      category: intelligence?.category,
      tags,
      events: feedbackEvents,
      userId: auth.user.id,
    });
    const score = Math.max(0, metadata * 0.26 + fullText * 0.20 + semantic * 0.30 + relationship * 0.06 + entity * 0.13 + feedback * 0.05);
    return {
      resource,
      score: Number(score.toFixed(4)),
      scoreBreakdown: { metadata, fullText, semantic, relationship, entity, feedback },
      intelligence: intelligence ? {
        id: intelligence.id,
        canonicalType: intelligence.canonicalType,
        category: intelligence.category,
        summary: intelligence.summary,
        tags,
        confidence: intelligence.categoryConfidence,
        analysisStatus: intelligence.analysisStatus,
      } : null,
      sourceTrace: [
        { kind: "metadata", label: "名稱與標籤", score: metadata },
        { kind: "full_text", label: "全文", score: fullText },
        { kind: "semantic", label: "語意", score: semantic },
        { kind: "entity", label: "實體", score: entity },
        { kind: "relationship", label: "關係圖", score: relationship },
        { kind: "feedback", label: "使用者修正", score: Math.max(0, feedback) },
      ].filter((item) => item.score > 0),
    };
  }).filter((item) => {
    const haystack = [item.resource.title, item.resource.projectTitle, item.intelligence?.category, item.intelligence?.summary, ...(item.intelligence?.tags ?? [])]
      .filter(Boolean).join(" ").normalize("NFKC").toLocaleLowerCase("zh-TW");
    if (parsed.excludedTerms.some((term) => haystack.includes(term))) return false;
    if (parsed.intent === "unassigned" && item.resource.projectId) return false;
    if (parsed.intent === "unclassified" && item.intelligence?.analysisStatus === "ready") return false;
    if (parsed.intent === "unused" && (relationshipCounts.get(item.intelligence?.id ?? "") ?? 0) > 1) return false;
    return item.score >= 0.08;
  })
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.min(100, Math.max(1, input.limit ?? 40)));

  const debug = {
    permissionFilteredCandidates: visible.resources.length,
    intelligenceCandidates: rows.length,
    returned: scored.length,
    embeddingModel: LOCAL_EMBEDDING_MODEL,
    feedbackEventsConsidered: feedbackEvents.length,
    fullTextIndexMatches: databaseTextRanks.size,
    intent: parsed.intent,
    excludedTerms: parsed.excludedTerms,
    elapsedMs: Date.now() - started,
  };
  const groupId = input.projectId
    ? visible.resources.find((resource) => resource.projectId === input.projectId)?.groupId ?? auth.groups[0]?.groupId
    : auth.groups[0]?.groupId;
  let retrievalRunId: string | null = null;
  if (groupId) {
    const [run] = await db.insert(schema.intelligenceRetrievalRuns).values({
      groupId,
      projectId: input.projectId ?? null,
      userId: auth.user.id,
      query: input.q,
      intent: parsed.intent,
      candidateCount: visible.resources.length,
      returnedCount: scored.length,
      embeddingModel: LOCAL_EMBEDDING_MODEL,
      latencyMs: Date.now() - started,
      debug,
    }).returning({ id: schema.intelligenceRetrievalRuns.id });
    retrievalRunId = run?.id ?? null;
    const traceRows = scored.flatMap((result, rank) => result.intelligence && retrievalRunId ? [{
      runId: retrievalRunId,
      intelligenceId: result.intelligence.id,
      rank: rank + 1,
      retrievalScore: result.score,
      scoreBreakdown: result.scoreBreakdown,
    }] : []);
    if (traceRows.length) await db.insert(schema.intelligenceRetrievalSources).values(traceRows);
  }
  return { results: scored, retrievalDebug: debug, retrievalRunId };
}

export async function retrieveIntelligenceContext(
  auth: AuthState,
  input: { q: string; projectId?: string; limit?: number; budgetChars?: number },
) {
  const search = await hybridSearchIntelligence(auth, {
    q: input.q,
    projectId: input.projectId,
    limit: Math.min(30, Math.max(3, input.limit ?? 12)),
  });
  const intelligenceIds = search.results.flatMap((result) => result.intelligence ? [result.intelligence.id] : []);
  const chunks = intelligenceIds.length ? await db.select().from(schema.intelligenceChunks)
    .where(inArray(schema.intelligenceChunks.intelligenceId, intelligenceIds)) : [];
  const sources = intelligenceIds.length ? await db.select().from(schema.intelligenceDataSources)
    .where(inArray(schema.intelligenceDataSources.intelligenceId, intelligenceIds)) : [];
  const sourceByIntelligence = new Map(sources.map((source) => [source.intelligenceId, source]));
  const candidates = search.results.flatMap((result) => {
    if (!result.intelligence) return [];
    const resourceChunks = chunks.filter((chunk) => chunk.intelligenceId === result.intelligence!.id);
    const selected = resourceChunks.length ? resourceChunks : [{
      id: null,
      intelligenceId: result.intelligence.id,
      ordinal: 0,
      text: result.intelligence.summary ?? result.resource.title,
    }];
    return selected.map((chunk) => {
      const chunkScore = lexicalOverlap(input.q, chunk.text);
      return {
        intelligenceId: result.intelligence!.id,
        chunkId: chunk.id,
        title: result.resource.title,
        resourceKind: result.resource.kind,
        resourceId: result.resource.rawId,
        text: chunk.text,
        score: Number((result.score * 0.72 + chunkScore * 0.28).toFixed(4)),
        source: sourceByIntelligence.get(result.intelligence!.id) ?? null,
        scoreBreakdown: { ...result.scoreBreakdown, reranker: chunkScore },
      };
    });
  }).sort((left, right) => right.score - left.score);
  const budget = Math.min(40_000, Math.max(1_000, input.budgetChars ?? 12_000));
  let used = 0;
  const selected: typeof candidates = [];
  const perAsset = new Map<string, number>();
  const deferred: typeof candidates = [];
  for (const candidate of candidates) {
    if (selected.length >= (input.limit ?? 12)) break;
    if ((perAsset.get(candidate.intelligenceId) ?? 0) >= 2) { deferred.push(candidate); continue; }
    const remaining = budget - used;
    if (remaining <= 0) break;
    const text = candidate.text.slice(0, remaining);
    if (!text) continue;
    selected.push({ ...candidate, text });
    perAsset.set(candidate.intelligenceId, (perAsset.get(candidate.intelligenceId) ?? 0) + 1);
    used += text.length;
  }
  for (const candidate of deferred) {
    if (selected.length >= (input.limit ?? 12) || used >= budget) break;
    const text = candidate.text.slice(0, budget - used);
    if (!text) continue;
    selected.push({ ...candidate, text });
    used += text.length;
  }
  const context = selected.map((source, index) => (
    `[來源 ${index + 1}｜${source.title}｜score ${source.score}]\n${source.text}`
  )).join("\n\n");
  return {
    context,
    sources: selected,
    retrievalRunId: search.retrievalRunId,
    retrievalDebug: { ...search.retrievalDebug, rerankedChunks: candidates.length, includedChars: used, budgetChars: budget, diversityCapPerAsset: 2 },
  };
}

export async function intelligenceSummary(auth: AuthState, projectId?: string) {
  const groupIds = [...new Set(auth.groups.map((group) => group.groupId))];
  if (!groupIds.length) return emptySummary();
  const base = [inArray(schema.assetIntelligence.groupId, groupIds)];
  if (projectId) base.push(eq(schema.assetIntelligence.projectId, projectId));
  const [analysis, review, clusters, duplicates, jobs] = await Promise.all([
    db.select({
      total: sql<number>`count(*)::int`,
      pending: sql<number>`count(*) filter (where ${schema.assetIntelligence.analysisStatus} in ('pending','processing'))::int`,
      needsReview: sql<number>`count(*) filter (where ${schema.assetIntelligence.analysisStatus} = 'needs_review')::int`,
      unassigned: sql<number>`count(*) filter (where ${schema.assetIntelligence.projectId} is null)::int`,
    }).from(schema.assetIntelligence).where(and(...base)),
    db.select({ count: sql<number>`count(*)::int` }).from(schema.aiReviewItems)
      .where(and(inArray(schema.aiReviewItems.groupId, groupIds), eq(schema.aiReviewItems.status, "pending"), ...(projectId ? [eq(schema.aiReviewItems.projectId, projectId)] : []))),
    db.select({ count: sql<number>`count(*)::int` }).from(schema.faceClusters)
      .where(and(inArray(schema.faceClusters.groupId, groupIds), eq(schema.faceClusters.status, "unconfirmed"), ...(projectId ? [eq(schema.faceClusters.projectId, projectId)] : []))),
    db.select({ count: sql<number>`count(*)::int` }).from(schema.duplicateGroups)
      .where(and(inArray(schema.duplicateGroups.groupId, groupIds), eq(schema.duplicateGroups.status, "pending"))),
    db.select({
      active: sql<number>`count(*) filter (where ${schema.intelligenceProcessingJobs.status} in ('queued','running'))::int`,
      failed: sql<number>`count(*) filter (where ${schema.intelligenceProcessingJobs.status} = 'failed')::int`,
    }).from(schema.intelligenceProcessingJobs)
      .innerJoin(schema.assetIntelligence, eq(schema.assetIntelligence.id, schema.intelligenceProcessingJobs.intelligenceId))
      .where(and(...base)),
  ]);
  return {
    total: Number(analysis[0]?.total ?? 0),
    analysisPending: Number(analysis[0]?.pending ?? 0),
    aiReview: Number(review[0]?.count ?? 0),
    unnamedPeople: Number(clusters[0]?.count ?? 0),
    possibleDuplicates: Number(duplicates[0]?.count ?? 0),
    unassignedProject: Number(analysis[0]?.unassigned ?? 0),
    activeJobs: Number(jobs[0]?.active ?? 0),
    failedJobs: Number(jobs[0]?.failed ?? 0),
  };
}

function emptySummary() {
  return { total: 0, analysisPending: 0, aiReview: 0, unnamedPeople: 0, possibleDuplicates: 0, unassignedProject: 0, activeJobs: 0, failedJobs: 0 };
}

export { confidenceThresholds };
