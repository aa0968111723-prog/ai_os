/**
 * PR-6C: Artifact quarantine → scan → Asset import.
 * Reuses storage.adoptTmpFile + assets table; no parallel storage system.
 */
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { and, eq, isNull, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db, schema } from "../../db";
import { requireGroup } from "../../trpc";
import type { AuthState } from "../auth";
import { assertProjectEditable, assertProjectNotArchived } from "../projectAcl";
import { adoptTmpFile, kindFromMime, tmpDir } from "../storage";
import { notifyAgentProgress } from "../realtime";
import { recordAgentEventSafely } from "../agentEventCore";
import {
  COMPUTER_ARTIFACT_MAX_BYTES,
  isComputerArtifactIngestionEnabled,
  isComputerRuntimeEnabled,
  isComputerSessionTerminal,
  type ComputerOutputContract,
} from "../../../shared/computerRuntime";
import { validateComputerNavigationUrl } from "../../../shared/computerRuntimePolicy";
import { computerEventToAgentObservationSummary } from "../../../shared/computerEvents";

export type ArtifactRow = typeof schema.computerArtifacts.$inferSelect;

function quarantineRoot(): string {
  const root = path.join(tmpDir(), "computer-quarantine");
  mkdirSync(root, { recursive: true });
  return root;
}

function assertIngestionEnabled(): void {
  if (!isComputerRuntimeEnabled() || !isComputerArtifactIngestionEnabled()) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "成品回收尚未啟用（COMPUTER_ARTIFACT_INGESTION_ENABLED）",
    });
  }
}

/** Magic-byte sniff for common media (not full libmagic). */
export function sniffMime(buf: Buffer): string | null {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (buf.length >= 12 && buf.toString("ascii", 4, 8) === "ftyp") return "video/mp4";
  if (buf.length >= 4 && buf.toString("ascii", 0, 4) === "%PDF") return "application/pdf";
  if (buf.length >= 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return "video/webm";
  return null;
}

/** Block classic EICAR test signature and empty payloads. */
export function scanArtifactBytes(buf: Buffer, declaredMime?: string | null): {
  status: "clean" | "blocked" | "failed";
  mime: string | null;
  reason?: string;
} {
  if (!buf.length) {
    return { status: "failed", mime: null, reason: "empty file" };
  }
  if (buf.length > COMPUTER_ARTIFACT_MAX_BYTES) {
    return { status: "blocked", mime: null, reason: `file exceeds ${COMPUTER_ARTIFACT_MAX_BYTES} bytes` };
  }
  const textHead = buf.subarray(0, Math.min(buf.length, 256)).toString("utf8");
  if (textHead.includes("EICAR-STANDARD-ANTIVIRUS-TEST-FILE")) {
    return { status: "blocked", mime: "text/plain", reason: "malware signature blocked" };
  }
  // Reject HTML/JS disguised as media
  const lower = textHead.trimStart().toLowerCase();
  if (lower.startsWith("<!doctype html") || lower.startsWith("<html") || lower.startsWith("<script")) {
    return { status: "blocked", mime: "text/html", reason: "html/js payload not allowed as artifact" };
  }
  const sniffed = sniffMime(buf);
  const mime = sniffed ?? declaredMime ?? "application/octet-stream";
  const allowed =
    mime.startsWith("image/")
    || mime.startsWith("video/")
    || mime.startsWith("audio/")
    || mime === "application/pdf"
    || mime === "text/plain"
    || mime === "text/markdown";
  if (!allowed) {
    return { status: "blocked", mime, reason: `mime not allowed: ${mime}` };
  }
  return { status: "clean", mime };
}

function sha256Buffer(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

async function loadSessionAuth(auth: AuthState, sessionId: string) {
  const [session] = await db.select().from(schema.computerSessions).where(eq(schema.computerSessions.id, sessionId));
  if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "找不到工作電腦 session" });
  requireGroup(auth, session.groupId);
  if (session.userId !== auth.user.id) {
    const role = requireGroup(auth, session.groupId);
    if (role === "member") throw new TRPCError({ code: "FORBIDDEN", message: "沒有權限操作此 session 的成品" });
  }
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, session.projectId));
  if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "找不到專案" });
  assertProjectNotArchived({ status: project.status });
  await assertProjectEditable(auth, { id: project.id, groupId: project.groupId });
  return { session, project };
}

async function emitArtifactEvent(input: {
  session: typeof schema.computerSessions.$inferSelect;
  eventType: "computer:artifact_detected" | "computer:artifact_imported";
  summary: string;
  artifactId: string;
  assetId?: string | null;
}): Promise<void> {
  if (input.session.runId) {
    await recordAgentEventSafely({
      runId: input.session.runId,
      groupId: input.session.groupId,
      projectId: input.session.projectId,
      stepId: input.session.stepId,
      eventKey: `computer:${input.session.id}:${input.eventType}:${input.artifactId.slice(0, 8)}`,
      eventType: "observation",
      summary: computerEventToAgentObservationSummary(input.eventType, input.summary),
      data: {
        schemaVersion: 1,
        eventType: input.eventType,
        summary: input.summary,
        computer: {
          sessionId: input.session.id,
          runtimeKind: input.session.runtimeKind,
          controlHolder: input.session.controlHolder,
        },
        artifactId: input.artifactId,
        assetId: input.assetId ?? null,
      },
    });
  } else {
    try {
      notifyAgentProgress(input.session.projectId, {
        runId: input.session.id,
        eventKey: `computer:${input.eventType}:${input.artifactId}`,
        groupId: input.session.groupId,
      });
    } catch { /* non-fatal */ }
  }
}

/**
 * Register bytes already in memory (mock download / test fixture) into quarantine + scan.
 */
export async function registerArtifactFromBytes(input: {
  auth: AuthState;
  sessionId: string;
  actionId: string;
  filename: string;
  bytes: Buffer;
  declaredMime?: string;
  sourceUrlSanitized?: string;
  providerFileRef?: string;
  outputContract?: ComputerOutputContract;
}): Promise<ArtifactRow> {
  assertIngestionEnabled();
  const { session } = await loadSessionAuth(input.auth, input.sessionId);
  if (isComputerSessionTerminal(session.status)) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "session 已結束，無法再匯入成品" });
  }

  // Idempotent by actionId
  if (input.actionId) {
    const [byAction] = await db
      .select()
      .from(schema.computerArtifacts)
      .where(eq(schema.computerArtifacts.actionId, input.actionId))
      .limit(1);
    if (byAction) return byAction;
  }

  const scan = scanArtifactBytes(input.bytes, input.declaredMime);
  const hash = sha256Buffer(input.bytes);

  // Idempotent by session+sha256
  const [byHash] = await db
    .select()
    .from(schema.computerArtifacts)
    .where(and(
      eq(schema.computerArtifacts.sessionId, session.id),
      eq(schema.computerArtifacts.sha256, hash),
    ))
    .limit(1);
  if (byHash) return byHash;

  const qName = `${session.id.slice(0, 8)}_${hash.slice(0, 16)}_${path.basename(input.filename).slice(0, 40)}`;
  const qPath = path.join(quarantineRoot(), qName);
  await writeFile(qPath, input.bytes);

  const importStatus = scan.status === "clean" ? "ready" : "failed";
  const [row] = await db.insert(schema.computerArtifacts).values({
    sessionId: session.id,
    projectId: session.projectId,
    groupId: session.groupId,
    actionId: input.actionId,
    sourceUrlSanitized: input.sourceUrlSanitized ?? null,
    providerFileRef: input.providerFileRef ?? null,
    filename: input.filename.slice(0, 200),
    mimeType: scan.mime,
    sizeBytes: input.bytes.length,
    sha256: hash,
    scanStatus: scan.status,
    importStatus: scan.status === "blocked" ? "failed" : importStatus,
    quarantinePath: qPath,
    errorCode: scan.status === "clean" ? null : "COMPUTER_ARTIFACT_SCAN_FAILED",
    errorMessage: scan.reason ?? null,
    outputContract: (input.outputContract as Record<string, unknown> | undefined) ?? null,
  }).returning();

  await emitArtifactEvent({
    session,
    eventType: "computer:artifact_detected",
    summary: scan.status === "clean"
      ? `偵測到成品 ${input.filename}`
      : `成品被擋下：${scan.reason}`,
    artifactId: row.id,
  });

  return row;
}

/**
 * Download from a public https URL into quarantine (SSRF-guarded), then scan.
 */
export async function registerArtifactFromUrl(input: {
  auth: AuthState;
  sessionId: string;
  actionId: string;
  url: string;
  filename?: string;
  outputContract?: ComputerOutputContract;
}): Promise<ArtifactRow> {
  assertIngestionEnabled();
  const check = validateComputerNavigationUrl(input.url);
  if (!check.ok || !check.sanitizedUrl) {
    throw new TRPCError({ code: "BAD_REQUEST", message: check.message ?? "不安全的下載網址" });
  }

  const res = await fetch(check.sanitizedUrl, {
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
    headers: { "User-Agent": "Aios-ComputerRuntime/1.0" },
  }).catch((err) => {
    throw new TRPCError({
      code: "BAD_GATEWAY",
      message: err instanceof Error ? err.message : "下載失敗",
    });
  });
  if (!res.ok) {
    throw new TRPCError({ code: "BAD_GATEWAY", message: `下載失敗 HTTP ${res.status}` });
  }
  const len = Number(res.headers.get("content-length") || 0);
  if (len > COMPUTER_ARTIFACT_MAX_BYTES) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "檔案過大" });
  }
  const ab = await res.arrayBuffer();
  const bytes = Buffer.from(ab);
  if (bytes.length > COMPUTER_ARTIFACT_MAX_BYTES) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "檔案過大" });
  }
  const mime = res.headers.get("content-type")?.split(";")[0]?.trim() ?? undefined;
  const name = input.filename
    || path.basename(new URL(check.sanitizedUrl).pathname)
    || `download-${randomUUID().slice(0, 8)}`;

  return registerArtifactFromBytes({
    auth: input.auth,
    sessionId: input.sessionId,
    actionId: input.actionId,
    filename: name,
    bytes,
    declaredMime: mime,
    sourceUrlSanitized: check.sanitizedUrl,
    outputContract: input.outputContract,
  });
}

/**
 * Mock provider: register a sample PNG as "detected download" for demos/tests.
 */
export async function detectMockArtifact(input: {
  auth: AuthState;
  sessionId: string;
  actionId?: string;
  outputContract?: ComputerOutputContract;
}): Promise<ArtifactRow> {
  // 1x1 PNG
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  return registerArtifactFromBytes({
    auth: input.auth,
    sessionId: input.sessionId,
    actionId: input.actionId ?? `detect:${input.sessionId}:${randomUUID().slice(0, 8)}`,
    filename: "mock-result.png",
    bytes: png,
    declaredMime: "image/png",
    providerFileRef: "mock://download/mock-result.png",
    outputContract: input.outputContract,
  });
}

export async function importArtifactToProject(input: {
  auth: AuthState;
  artifactId: string;
  forceDuplicate?: boolean;
}): Promise<{ artifact: ArtifactRow; assetId: string; duplicate: boolean }> {
  assertIngestionEnabled();
  const [artifact] = await db
    .select()
    .from(schema.computerArtifacts)
    .where(eq(schema.computerArtifacts.id, input.artifactId))
    .limit(1);
  if (!artifact) throw new TRPCError({ code: "NOT_FOUND", message: "找不到成品紀錄" });

  const { session, project } = await loadSessionAuth(input.auth, artifact.sessionId);

  // Already imported
  if (artifact.importStatus === "imported" && artifact.assetId) {
    return { artifact, assetId: artifact.assetId, duplicate: false };
  }
  if (artifact.scanStatus !== "clean" || artifact.importStatus === "failed") {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: artifact.errorMessage ?? "成品未通過掃描，無法匯入",
    });
  }
  if (!artifact.sha256 || !artifact.quarantinePath || !existsSync(artifact.quarantinePath)) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "隔離檔案遺失，請重新偵測下載" });
  }

  // Group-level dedupe by sha256
  const [existingAsset] = await db
    .select()
    .from(schema.assets)
    .where(and(
      eq(schema.assets.groupId, project.groupId),
      eq(schema.assets.sha256, artifact.sha256),
      isNull(schema.assets.deletedAt),
    ))
    .limit(1);

  if (existingAsset && !input.forceDuplicate) {
    const [updated] = await db.update(schema.computerArtifacts).set({
      importStatus: "duplicate",
      assetId: existingAsset.id,
      updatedAt: new Date(),
    }).where(eq(schema.computerArtifacts.id, artifact.id)).returning();
    return { artifact: updated, assetId: existingAsset.id, duplicate: true };
  }

  await db.update(schema.computerArtifacts).set({
    importStatus: "importing",
    updatedAt: new Date(),
  }).where(eq(schema.computerArtifacts.id, artifact.id));

  const mime = artifact.mimeType ?? "application/octet-stream";
  // Copy quarantine file to a fresh tmp path for adoptTmpFile (it renames/moves)
  const tmpCopy = path.join(tmpDir(), `computer-import-${randomUUID()}`);
  const bytes = readFileSync(artifact.quarantinePath);
  await writeFile(tmpCopy, bytes);

  let assetId: string;
  try {
    const { storagePath, sizeBytes } = await adoptTmpFile(tmpCopy, mime);
    const contract = (artifact.outputContract ?? {}) as ComputerOutputContract;
    const kind = kindFromMime(mime);
    const [created] = await db.insert(schema.assets).values({
      projectId: project.id,
      groupId: project.groupId,
      kind,
      title: (contract.title || artifact.filename || "外部工作電腦成品").slice(0, 80),
      url: "",
      isAiGenerated: true,
      storagePath,
      mime,
      sizeBytes,
      uploadedBy: input.auth.user.id,
      sha256: artifact.sha256,
      originUrl: artifact.sourceUrlSanitized,
      meta: {
        provenance: {
          source: "external_computer_runtime",
          sourceType: "external_computer_runtime",
          sessionId: session.id,
          provider: session.provider,
          artifactId: artifact.id,
          importedAt: new Date().toISOString(),
          attachTo: contract.attachTo ?? "project",
          sceneId: contract.sceneId ?? artifact.sceneId ?? null,
          shotId: contract.shotId ?? artifact.shotId ?? null,
        },
      },
    }).returning();
    const [asset] = await db.update(schema.assets).set({
      url: `/api/assets/${created.id}/file`,
    }).where(eq(schema.assets.id, created.id)).returning();
    assetId = asset.id;
  } catch (err) {
    await db.update(schema.computerArtifacts).set({
      importStatus: "failed",
      errorCode: "COMPUTER_IMPORT_FAILED",
      errorMessage: err instanceof Error ? err.message : "import failed",
      updatedAt: new Date(),
    }).where(eq(schema.computerArtifacts.id, artifact.id));
    try { unlinkSync(tmpCopy); } catch { /* */ }
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: err instanceof Error ? err.message : "匯入素材失敗",
    });
  }

  const contract = (artifact.outputContract ?? {}) as ComputerOutputContract;
  const [updated] = await db.update(schema.computerArtifacts).set({
    importStatus: "imported",
    assetId,
    sceneId: contract.sceneId ?? artifact.sceneId ?? null,
    shotId: contract.shotId ?? artifact.shotId ?? null,
    updatedAt: new Date(),
  }).where(eq(schema.computerArtifacts.id, artifact.id)).returning();

  // Optional: soft-link to scene asset if sceneId provided
  if (updated.sceneId) {
    try {
      await db.update(schema.scenes).set({
        assetId: assetId,
        rev: sql`${schema.scenes.rev} + 1`,
      }).where(and(
        eq(schema.scenes.id, updated.sceneId),
        eq(schema.scenes.projectId, project.id),
        isNull(schema.scenes.deletedAt),
      ));
    } catch {
      /* non-fatal — asset still in library */
    }
  }

  await emitArtifactEvent({
    session,
    eventType: "computer:artifact_imported",
    summary: `已匯入素材 ${updated.filename}`,
    artifactId: updated.id,
    assetId,
  });

  return { artifact: updated, assetId, duplicate: false };
}

export async function listArtifactsForSession(
  auth: AuthState,
  sessionId: string,
): Promise<ArtifactRow[]> {
  if (!isComputerRuntimeEnabled()) return [];
  await loadSessionAuth(auth, sessionId);
  return db
    .select()
    .from(schema.computerArtifacts)
    .where(eq(schema.computerArtifacts.sessionId, sessionId));
}
