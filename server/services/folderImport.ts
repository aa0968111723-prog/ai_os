/**
 * Folder Import 2.0 — session 服務。
 *
 * 流程（§3）：
 *   Folder → Folder Scan → Folder Manifest → Import Session → Upload Queue
 *   → Asset / Library Resource → **既有** Intelligence Pipeline → Review
 *
 * 這個檔案負責中間那段有狀態的部分：manifest 落庫、與上一次匯入比對差異、
 * 逐檔回報上傳結果、以及把進度拆成「上傳」與「AI 理解」兩條分開的線。
 *
 * ★ 不建立第二套 AI job queue：session 只是掛上既有的
 *   `intelligence_processing_batches`，實際分析仍由 intelligenceRunner 逐 stage 執行。
 * ★ 不建立第二套上傳路徑：bytes 仍走既有的 `POST /api/upload`。
 * ★ 本機絕對路徑永遠不進這裡（shared/folderImport.normalizeRelativePath 會擋掉，
 *   router 再擋一次）。
 */
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "../db";
import {
  diffFolderManifest,
  folderImportOutcome,
  folderImportProgress,
  looksLikeAbsoluteLocalPath,
  normalizeRelativePath,
  parentPathOf,
  fileNameOf,
  type FolderImportEntryStatus,
  type FolderImportMode,
  type FolderImportProgressStage,
  type FolderImportSessionStatus,
  type FolderImportSourceType,
  type FolderManifestEntry,
} from "../../shared/folderImport";
import { createProcessingBatch } from "./intelligenceLibrary";

export type FolderImportSessionRow = typeof schema.folderImportSessions.$inferSelect;
export type FolderImportEntryRow = typeof schema.folderImportEntries.$inferSelect;

const MAX_ENTRIES_PER_SESSION = 20_000;

export interface CreateFolderImportSessionInput {
  groupId: string;
  projectId?: string | null;
  displayName: string;
  sourceType: FolderImportSourceType;
  sourceRootId?: string | null;
  mode: FolderImportMode;
  entries: readonly FolderManifestEntry[];
  createdBy: string;
}

export interface CreateFolderImportSessionResult {
  session: FolderImportSessionRow;
  entries: FolderImportEntryRow[];
  counts: { unchanged: number; added: number; modified: number; missing: number };
  previousSessionId: string | null;
}

/**
 * 找同一個資料夾的上一次 session，作為差異比對的基準。
 *
 * 桌面版有穩定的 `sourceRootId`；瀏覽器沒有（每次選檔都是新的 handle），
 * 所以退而以 group + displayName 比對——這是 web 能做到的最誠實的比對依據，
 * 而不是假裝瀏覽器記得使用者的資料夾。
 */
async function findPreviousSession(input: {
  groupId: string;
  sourceRootId?: string | null;
  displayName: string;
}): Promise<FolderImportSessionRow | null> {
  const [row] = await db.select().from(schema.folderImportSessions).where(and(
    eq(schema.folderImportSessions.groupId, input.groupId),
    input.sourceRootId
      ? eq(schema.folderImportSessions.sourceRootId, input.sourceRootId)
      : eq(schema.folderImportSessions.displayName, input.displayName),
  )).orderBy(desc(schema.folderImportSessions.createdAt)).limit(1);
  return row ?? null;
}

/**
 * 建立 Import Session：落 manifest、比對上一次、算出這次真的要傳哪些檔。
 *
 * ★ UNCHANGED 一律標成 `skipped`，不重傳、也不重跑 AI 分析（§8 / §38）。
 * ★ MISSING **只標記**，絕不刪除任何雲端資料——刪不刪是使用者的決定。
 */
export async function createFolderImportSession(
  input: CreateFolderImportSessionInput,
): Promise<CreateFolderImportSessionResult> {
  const manifest: FolderManifestEntry[] = [];
  const seen = new Set<string>();
  for (const entry of input.entries) {
    if (manifest.length >= MAX_ENTRIES_PER_SESSION) break;
    const relativePath = normalizeRelativePath(entry.relativePath);
    // 第二層防呆：絕對路徑在 shared 層已被擋，這裡再擋一次才不會因為某個呼叫端漏用而外洩
    if (!relativePath || looksLikeAbsoluteLocalPath(entry.relativePath)) continue;
    if (seen.has(relativePath)) continue;
    seen.add(relativePath);
    manifest.push({
      ...entry,
      relativePath,
      parentPath: parentPathOf(relativePath),
      filename: fileNameOf(relativePath),
    });
  }

  const previous = await findPreviousSession({
    groupId: input.groupId,
    sourceRootId: input.sourceRootId,
    displayName: input.displayName,
  });
  const previousEntries = previous
    ? await db.select().from(schema.folderImportEntries)
      .where(eq(schema.folderImportEntries.sessionId, previous.id))
    : [];
  const diff = diffFolderManifest(
    previousEntries.map((entry) => ({
      relativePath: entry.relativePath,
      size: Number(entry.sizeBytes ?? 0),
      lastModified: entry.sourceLastModifiedAt ? entry.sourceLastModifiedAt.getTime() : null,
      checksum: entry.checksum,
      uploadStatus: entry.uploadStatus as FolderImportEntryStatus,
    })),
    manifest,
  );

  const [session] = await db.insert(schema.folderImportSessions).values({
    groupId: input.groupId,
    projectId: input.projectId ?? null,
    sourceType: input.sourceType,
    sourceRootId: input.sourceRootId ?? null,
    displayName: input.displayName.slice(0, 200),
    mode: input.mode,
    previousSessionId: previous?.id ?? null,
    totalFiles: manifest.length,
    skippedFiles: diff.counts.UNCHANGED,
    missingFiles: diff.counts.MISSING,
    totalBytes: manifest.reduce((sum, entry) => sum + entry.size, 0),
    status: "uploading",
    createdBy: input.createdBy,
  }).returning();

  const previousByPath = new Map(previousEntries.map((entry) => [entry.relativePath, entry]));
  const rows = diff.items.map((item) => {
    const previousEntry = previousByPath.get(item.relativePath);
    const unchanged = item.state === "UNCHANGED";
    return {
      sessionId: session!.id,
      relativePath: item.relativePath,
      parentPath: item.entry?.parentPath ?? parentPathOf(item.relativePath),
      filename: item.entry?.filename ?? fileNameOf(item.relativePath),
      sizeBytes: item.entry?.size ?? Number(previousEntry?.sizeBytes ?? 0),
      mime: item.entry?.mime ?? previousEntry?.mime ?? null,
      sourceLastModifiedAt: item.entry?.lastModified != null ? new Date(item.entry.lastModified) : null,
      checksum: unchanged ? previousEntry?.checksum ?? null : null,
      diffState: item.state,
      // 沒有變動的檔案直接沿用上一次的成果；來源消失的只標記，不刪任何東西
      uploadStatus: (item.state === "MISSING" ? "missing" : unchanged ? "skipped" : "pending") as FolderImportEntryStatus,
      resourceKind: unchanged ? previousEntry?.resourceKind ?? null : null,
      resourceId: unchanged ? previousEntry?.resourceId ?? null : null,
      libraryResourceId: unchanged ? previousEntry?.libraryResourceId ?? null : null,
      intelligenceId: unchanged ? previousEntry?.intelligenceId ?? null : null,
    };
  });
  const entries = rows.length
    ? await db.insert(schema.folderImportEntries).values(rows).returning()
    : [];

  return {
    session: session!,
    entries,
    counts: {
      unchanged: diff.counts.UNCHANGED,
      added: diff.counts.NEW,
      modified: diff.counts.MODIFIED,
      missing: diff.counts.MISSING,
    },
    previousSessionId: previous?.id ?? null,
  };
}

/** 還沒傳完的檔案（重新開啟 session 時的續傳清單——已完成的不重傳，§7）。 */
export async function pendingFolderImportEntries(
  sessionId: string,
  limit = 5_000,
): Promise<FolderImportEntryRow[]> {
  return db.select().from(schema.folderImportEntries).where(and(
    eq(schema.folderImportEntries.sessionId, sessionId),
    inArray(schema.folderImportEntries.uploadStatus, ["pending", "uploading", "failed"]),
  )).orderBy(asc(schema.folderImportEntries.relativePath)).limit(limit);
}

/**
 * 回報單一檔案的上傳結果。由 `/api/upload` 在素材落地之後呼叫。
 *
 * 冪等：同一個 entry 重複回報 uploaded 不會把計數灌兩次（計數一律重算，不做 +1）。
 */
export async function recordFolderImportEntryResult(input: {
  sessionId: string;
  relativePath: string;
  status: Extract<FolderImportEntryStatus, "uploaded" | "failed" | "skipped">;
  resourceKind?: string | null;
  resourceId?: string | null;
  libraryResourceId?: string | null;
  intelligenceId?: string | null;
  checksum?: string | null;
  error?: string | null;
}): Promise<FolderImportEntryRow | null> {
  const relativePath = normalizeRelativePath(input.relativePath);
  if (!relativePath) return null;
  const [row] = await db.update(schema.folderImportEntries).set({
    uploadStatus: input.status,
    resourceKind: input.resourceKind ?? null,
    resourceId: input.resourceId ?? null,
    libraryResourceId: input.libraryResourceId ?? null,
    intelligenceId: input.intelligenceId ?? null,
    checksum: input.checksum ?? null,
    error: input.error ? input.error.slice(0, 500) : null,
    attempt: sql`${schema.folderImportEntries.attempt} + 1`,
    updatedAt: new Date(),
  }).where(and(
    eq(schema.folderImportEntries.sessionId, input.sessionId),
    eq(schema.folderImportEntries.relativePath, relativePath),
  )).returning();
  if (row) await refreshFolderImportSession(input.sessionId);
  return row ?? null;
}

/** 依 entries 現況重算 session 計數與狀態（一律重算，不做增量加減）。 */
export async function refreshFolderImportSession(sessionId: string): Promise<FolderImportSessionRow | null> {
  const [counts] = await db.select({
    total: sql<number>`count(*) filter (where ${schema.folderImportEntries.diffState} <> 'MISSING')::int`,
    uploaded: sql<number>`count(*) filter (where ${schema.folderImportEntries.uploadStatus} = 'uploaded')::int`,
    skipped: sql<number>`count(*) filter (where ${schema.folderImportEntries.uploadStatus} = 'skipped')::int`,
    failed: sql<number>`count(*) filter (where ${schema.folderImportEntries.uploadStatus} = 'failed')::int`,
    missing: sql<number>`count(*) filter (where ${schema.folderImportEntries.uploadStatus} = 'missing')::int`,
  }).from(schema.folderImportEntries)
    .where(eq(schema.folderImportEntries.sessionId, sessionId));
  const [current] = await db.select().from(schema.folderImportSessions)
    .where(eq(schema.folderImportSessions.id, sessionId));
  if (!current) return null;
  if (current.status === "cancelled") return current;
  const totals = {
    totalFiles: Number(counts?.total ?? 0),
    uploadedFiles: Number(counts?.uploaded ?? 0),
    failedFiles: Number(counts?.failed ?? 0),
    skippedFiles: Number(counts?.skipped ?? 0),
  };
  const status: FolderImportSessionStatus = folderImportOutcome(totals);
  const [row] = await db.update(schema.folderImportSessions).set({
    ...totals,
    missingFiles: Number(counts?.missing ?? 0),
    status,
    completedAt: status === "uploading" ? null : new Date(),
    updatedAt: new Date(),
  }).where(eq(schema.folderImportSessions.id, sessionId)).returning();
  return row ?? null;
}

/**
 * 把這個 session 匯入的資料掛上一個既有的 Intelligence processing batch。
 *
 * 為什麼是「掛上」而不是「建立佇列」：分析工作本來就已經由
 * `registerIntelligenceResource()` 在上傳當下排進 `intelligence_processing_jobs`；
 * batch 只是讓 session 可以問「這批的 AI 進度到哪」。
 */
export async function ensureFolderImportBatch(session: FolderImportSessionRow): Promise<string | null> {
  if (session.processingBatchId) return session.processingBatchId;
  if (session.totalFiles <= 0) return null;
  const batchId = await createProcessingBatch({
    groupId: session.groupId,
    projectId: session.projectId,
    sourceType: `folder_import:${session.sourceType}`,
    totalItems: session.totalFiles,
    createdBy: session.createdBy,
  });
  await db.update(schema.folderImportSessions)
    .set({ processingBatchId: batchId, updatedAt: new Date() })
    .where(eq(schema.folderImportSessions.id, session.id));
  return batchId;
}

export interface FolderImportSessionStatusView {
  session: FolderImportSessionRow;
  stages: FolderImportProgressStage[];
  analyzedFiles: number;
  reviewFiles: number;
  failedEntries: Array<{ relativePath: string; error: string | null }>;
  missingEntries: Array<{ relativePath: string }>;
}

/**
 * Session 狀態：**上傳與 AI 理解分開算**。
 *
 * `analyzedFiles` 來自 `asset_intelligence.analysis_status`（真的分析完了），
 * 不是上傳數。畫面上「AI 已理解 512 / 827」因此是真的，不是把上傳進度換個標籤。
 */
export async function folderImportSessionStatus(sessionId: string): Promise<FolderImportSessionStatusView | null> {
  const [session] = await db.select().from(schema.folderImportSessions)
    .where(eq(schema.folderImportSessions.id, sessionId));
  if (!session) return null;
  const entries = await db.select({
    relativePath: schema.folderImportEntries.relativePath,
    uploadStatus: schema.folderImportEntries.uploadStatus,
    intelligenceId: schema.folderImportEntries.intelligenceId,
    error: schema.folderImportEntries.error,
  }).from(schema.folderImportEntries)
    .where(eq(schema.folderImportEntries.sessionId, sessionId));
  const intelligenceIds = entries.flatMap((entry) => entry.intelligenceId ? [entry.intelligenceId] : []);
  const [analysis, review] = await Promise.all([
    intelligenceIds.length ? db.select({
      ready: sql<number>`count(*) filter (where ${schema.assetIntelligence.analysisStatus} in ('ready','needs_review','partial'))::int`,
    }).from(schema.assetIntelligence)
      .where(inArray(schema.assetIntelligence.id, intelligenceIds)) : Promise.resolve([{ ready: 0 }]),
    intelligenceIds.length ? db.select({ count: sql<number>`count(*)::int` })
      .from(schema.aiReviewItems).where(and(
        inArray(schema.aiReviewItems.intelligenceId, intelligenceIds),
        eq(schema.aiReviewItems.status, "pending"),
      )) : Promise.resolve([{ count: 0 }]),
  ]);
  const analyzedFiles = Number(analysis[0]?.ready ?? 0);
  const reviewFiles = Number(review[0]?.count ?? 0);
  return {
    session,
    analyzedFiles,
    reviewFiles,
    stages: folderImportProgress({
      totalFiles: session.totalFiles,
      uploadedFiles: session.uploadedFiles,
      failedFiles: session.failedFiles,
      skippedFiles: session.skippedFiles,
      analyzedFiles,
      reviewFiles,
      status: session.status as FolderImportSessionStatus,
    }),
    failedEntries: entries.filter((entry) => entry.uploadStatus === "failed")
      .slice(0, 50)
      .map((entry) => ({ relativePath: entry.relativePath, error: entry.error })),
    missingEntries: entries.filter((entry) => entry.uploadStatus === "missing")
      .slice(0, 100)
      .map((entry) => ({ relativePath: entry.relativePath })),
  };
}

export async function listFolderImportSessions(input: {
  groupIds: readonly string[];
  projectId?: string | null;
  limit?: number;
}): Promise<FolderImportSessionRow[]> {
  if (!input.groupIds.length) return [];
  return db.select().from(schema.folderImportSessions).where(and(
    inArray(schema.folderImportSessions.groupId, [...input.groupIds]),
    ...(input.projectId ? [eq(schema.folderImportSessions.projectId, input.projectId)] : []),
  )).orderBy(desc(schema.folderImportSessions.createdAt)).limit(Math.min(50, Math.max(1, input.limit ?? 20)));
}

/**
 * 取消 session。
 * ★ 只停止「還沒傳的」，已經進站的資料完全不動——與「中斷來源不刪已匯入內容」同一條原則。
 */
export async function cancelFolderImportSession(sessionId: string): Promise<void> {
  await db.update(schema.folderImportEntries)
    .set({ uploadStatus: "skipped", updatedAt: new Date() })
    .where(and(
      eq(schema.folderImportEntries.sessionId, sessionId),
      inArray(schema.folderImportEntries.uploadStatus, ["pending", "uploading"]),
    ));
  await db.update(schema.folderImportSessions)
    .set({ status: "cancelled", completedAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.folderImportSessions.id, sessionId));
}
