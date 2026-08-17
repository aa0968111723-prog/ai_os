/**
 * Durable start/end frame extraction for real video assets.
 *
 * Extraction is explicit and idempotent. It never runs as a paid cascade, never
 * becomes Canon, and records parent lineage in the existing asset_revisions table.
 */
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db, schema } from "../db";
import type { AuthState } from "./auth";
import { loadCreativeContextProject } from "./storyEntityBinding";
import { readStoredFile, saveBuffer } from "./storage";

const execFileAsync = promisify(execFile);
const EXTRACTOR_VERSION = "ffmpeg-end-frame.v1";

function deterministicUuid(material: string): string {
  const hex = createHash("sha256").update(material).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}

type DerivedFrameMeta = {
  derivedFrame?: {
    kind?: unknown;
    parentAssetId?: unknown;
    extractorVersion?: unknown;
    timestampMs?: unknown;
  };
};

export async function findDerivedEndFrameAssetId(input: {
  projectId: string;
  parentAssetId: string;
}): Promise<string | null> {
  const revisions = await db.select({ assetId: schema.assetRevisions.assetId })
    .from(schema.assetRevisions)
    .where(and(
      eq(schema.assetRevisions.projectId, input.projectId),
      eq(schema.assetRevisions.sourceAssetId, input.parentAssetId),
    ));
  if (!revisions.length) return null;
  const rows = await db.select({ id: schema.assets.id, meta: schema.assets.meta })
    .from(schema.assets)
    .where(and(
      inArray(schema.assets.id, revisions.map((row) => row.assetId)),
      isNull(schema.assets.deletedAt),
    ));
  return rows.find((row) => {
    const derived = (row.meta as DerivedFrameMeta | null)?.derivedFrame;
    return derived?.kind === "end_frame"
      && derived.parentAssetId === input.parentAssetId
      && derived.extractorVersion === EXTRACTOR_VERSION;
  })?.id ?? null;
}

export async function extractEndFrame(input: {
  auth: AuthState;
  videoAssetId: string;
}): Promise<{ assetId: string; parentAssetId: string; timestampMs: number; reused: boolean }> {
  const [video] = await db.select().from(schema.assets).where(and(
    eq(schema.assets.id, input.videoAssetId),
    isNull(schema.assets.deletedAt),
  ));
  if (!video) throw new TRPCError({ code: "NOT_FOUND", message: "找不到影片素材" });
  await loadCreativeContextProject(input.auth, video.projectId, true);
  if (video.kind !== "video") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "只有影片可以抽取結尾影格" });
  }
  if (!video.storagePath) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "影片尚未落地到永久儲存，暫時無法抽取結尾影格",
    });
  }

  const existing = await findDerivedEndFrameAssetId({
    projectId: video.projectId,
    parentAssetId: video.id,
  });
  if (existing) return { assetId: existing, parentAssetId: video.id, timestampMs: 0, reused: true };

  const dir = await mkdtemp(join(tmpdir(), "aios-end-frame-"));
  const inputPath = join(dir, "source-video");
  const outputPath = join(dir, "end-frame.png");
  try {
    await writeFile(inputPath, await readStoredFile(video.storagePath));
    let durationSec = 0;
    try {
      const probe = await execFileAsync("ffprobe", [
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        inputPath,
      ], { timeout: 30_000 });
      durationSec = Number(probe.stdout.trim()) || 0;
    } catch {
      // ffmpeg can still extract via -sseof; timestamp remains 0 when probe is unavailable.
    }
    try {
      await execFileAsync("ffmpeg", [
        "-hide_banner", "-loglevel", "error", "-y",
        "-sseof", "-0.05", "-i", inputPath,
        "-frames:v", "1", outputPath,
      ], { timeout: 60_000 });
    } catch (error) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: `無法從這支影片抽取結尾影格：${error instanceof Error ? error.message : "ffmpeg 失敗"}`,
      });
    }
    const png = await readFile(outputPath);
    if (png.length < 32) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "影片沒有可用的結尾影格" });
    }
    const stored = await saveBuffer(png, "image/png");
    const assetId = deterministicUuid(`${video.id}:${EXTRACTOR_VERSION}`);
    const timestampMs = Math.max(0, Math.round((durationSec - 0.05) * 1000));
    await db.transaction(async (tx) => {
      await tx.insert(schema.assets).values({
        id: assetId,
        projectId: video.projectId,
        groupId: video.groupId,
        kind: "image",
        title: `${video.title}・結尾影格`,
        url: `/api/assets/${assetId}/file`,
        storagePath: stored.storagePath,
        mime: "image/png",
        sizeBytes: stored.sizeBytes,
        isAiGenerated: video.isAiGenerated,
        uploadedBy: input.auth.user.id,
        meta: {
          derivedFrame: {
            kind: "end_frame",
            parentAssetId: video.id,
            extractorVersion: EXTRACTOR_VERSION,
            timestampMs,
          },
        },
      }).onConflictDoNothing();
      await tx.insert(schema.assetRevisions).values({
        assetId,
        sourceAssetId: video.id,
        projectId: video.projectId,
        groupId: video.groupId,
        createdBy: input.auth.user.id,
      }).onConflictDoNothing();
    });
    return { assetId, parentAssetId: video.id, timestampMs, reused: false };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

