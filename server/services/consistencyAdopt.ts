/**
 * Explicit Adopt: the only path that may move a shot's current visual pointer.
 */
import { and, eq, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db, schema } from "../db";
import type { AuthState } from "./auth";
import { evaluateGenerationCandidate, shouldAdoptCandidate } from "../../shared/consistencyEval";
import { loadCreativeContextProject } from "./storyEntityBinding";
import { loadShotContextPacket } from "./shotContextPackets";
import { splitGenerationSourceMeta } from "../../shared/generationSourceMeta";

export async function adoptGenerationCurrent(input: {
  auth: AuthState;
  generationId: string;
}): Promise<{ shotId: string; assetId: string; adopted: true }> {
  const [generation] = await db.select().from(schema.generations).where(eq(schema.generations.id, input.generationId));
  if (!generation) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這筆生成" });
  await loadCreativeContextProject(input.auth, generation.projectId, true);
  if (generation.status !== "done" || !generation.resultUrl) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "這筆生成還沒完成，不能採用" });
  }
  if (!generation.sceneId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "這筆生成沒有綁分鏡" });
  }
  const meta = splitGenerationSourceMeta(generation.params).meta;
  if (meta.shotContextPacketId) {
    const frozen = await loadShotContextPacket({
      auth: input.auth,
      projectId: generation.projectId,
      packetId: meta.shotContextPacketId,
    });
    const report = evaluateGenerationCandidate({
      packet: frozen.payload,
      candidate: {
        prompt: generation.prompt,
        characterIds: generation.characterIds,
        lookIds: frozen.payload.looks.map((row) => row.id),
        scenePresetIds: generation.scenePresetIds,
        propIds: generation.propIds,
        status: generation.status,
      },
    });
    if (!shouldAdoptCandidate(report, true)) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: report.issues[0]?.message ?? "一致性不足，不能採用為 current",
      });
    }
  }

  const [asset] = generation.resultUrl
    ? await db.select({ id: schema.assets.id }).from(schema.assets).where(and(
      eq(schema.assets.projectId, generation.projectId),
      eq(schema.assets.url, generation.resultUrl),
      isNull(schema.assets.deletedAt),
    ))
    : [];
  if (!asset) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這筆生成的素材" });

  const [updated] = await db.update(schema.scenes).set({
    assetId: asset.id,
  }).where(and(
    eq(schema.scenes.id, generation.sceneId),
    isNull(schema.scenes.deletedAt),
  )).returning({ id: schema.scenes.id });
  if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這個分鏡" });
  return { shotId: updated.id, assetId: asset.id, adopted: true };
}

export function deliveryBlockers(input: {
  shots: Array<{ id: string; assetId: string | null; reviewStatus: string | null }>;
  staleShotIds: readonly string[];
  rightsBlockers?: readonly string[];
}): string[] {
  const blockers: string[] = [];
  const stale = new Set(input.staleShotIds);
  if (input.shots.some((shot) => !shot.assetId)) blockers.push("還有鏡頭沒有已採用畫面");
  if (input.shots.some((shot) => stale.has(shot.id))) blockers.push("有鏡頭因上游變更而過期");
  if (input.shots.some((shot) => shot.reviewStatus && shot.reviewStatus !== "approved" && shot.reviewStatus !== "ready")) {
    blockers.push("有鏡頭尚未核准");
  }
  for (const reason of input.rightsBlockers ?? []) blockers.push(reason);
  return blockers;
}
