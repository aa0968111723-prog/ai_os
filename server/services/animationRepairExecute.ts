/**
 * Site-assistant animation repair / keep writes.
 *
 * Phone already mutates through executeAnimationStage + scenes.review.
 * The site assistant used to match those capabilities and answer without a
 * generation row or reviewStatus change. These helpers are the same commands
 * plus a read-back so "done" means the database moved.
 */
import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db, schema } from "../db";
import type { AuthState } from "./auth";
import { executeAnimationGenerationStage } from "./animationPipeline";
import { phoneAnimationRepairProposal } from "./phoneAnimation";
import { applyWithRevisionTrpc } from "./revisionGuard";
import { loadCreativeContextProject } from "./storyEntityBinding";
import {
  animationRepairJobsFromProposal,
  type PhoneRepairProposalView,
} from "../../shared/phoneAnimationProjection";

export async function executeAnimationRepairVerified(input: {
  auth: AuthState;
  projectId: string;
}): Promise<
  | { status: "empty"; reason: string; generationIds: [] }
  | { status: "clarify"; question: string; options: Array<{ id: string; label: string }>; generationIds: [] }
  | {
    status: "executed";
    proposal: PhoneRepairProposalView;
    generationIds: string[];
    failed: number;
    total: number;
    verification: { status: "verified" | "unverified"; message: string };
  }
> {
  const planned = await phoneAnimationRepairProposal({
    auth: input.auth,
    projectId: input.projectId,
  });
  if (planned.status === "empty") {
    return { status: "empty", reason: planned.reason, generationIds: [] };
  }
  if (planned.status === "clarify") {
    return {
      status: "clarify",
      question: planned.question,
      options: planned.options,
      generationIds: [],
    };
  }
  const jobs = animationRepairJobsFromProposal(planned.proposal);
  if (jobs.length === 0) {
    return { status: "empty", reason: "這份修復計畫沒有可執行的生成階段。", generationIds: [] };
  }
  const generationIds: string[] = [];
  let failed = 0;
  for (const job of jobs) {
    try {
      const result = await executeAnimationGenerationStage({
        auth: input.auth,
        projectId: input.projectId,
        shotId: job.shotId,
        stage: job.stage,
        modelId: job.modelId,
        clientRequestId: randomUUID(),
      });
      generationIds.push(result.generationId);
    } catch {
      failed += 1;
    }
  }
  if (generationIds.length === 0) {
    return {
      status: "executed",
      proposal: planned.proposal,
      generationIds,
      failed,
      total: jobs.length,
      verification: {
        status: "unverified",
        message: "修復階段都沒有登記到生成工作，因此沒有標示為完成。",
      },
    };
  }
  const rows = await db.select({ id: schema.generations.id })
    .from(schema.generations)
    .where(and(
      eq(schema.generations.projectId, input.projectId),
      inArray(schema.generations.id, generationIds),
    ));
  const verified = rows.length === generationIds.length;
  return {
    status: "executed",
    proposal: planned.proposal,
    generationIds,
    failed,
    total: jobs.length,
    verification: {
      status: verified ? "verified" : "unverified",
      message: verified
        ? `已登記 ${generationIds.length} 筆修復生成（仍是候選，需要再採用）`
        : "修復已送出，但重新讀取未確認全部生成工作。",
    },
  };
}

export async function reviewShotVerified(input: {
  auth: AuthState;
  sceneId: string;
  status: "approved";
}): Promise<{
  shotId: string;
  reviewStatus: string | null;
  verification: { status: "verified" | "unverified"; message: string };
}> {
  const [scene] = await db.select().from(schema.scenes).where(and(
    eq(schema.scenes.id, input.sceneId),
    isNull(schema.scenes.deletedAt),
  ));
  if (!scene) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這一鏡（可能已刪除）" });
  await loadCreativeContextProject(input.auth, scene.projectId, true);
  const { row } = await applyWithRevisionTrpc({
    entity: "scene",
    table: schema.scenes,
    idColumn: schema.scenes.id,
    revColumn: schema.scenes.rev,
    row: scene,
    patch: { reviewStatus: input.status },
    expectedRev: scene.rev,
    baseline: { reviewStatus: scene.reviewStatus },
    extraWhere: isNull(schema.scenes.deletedAt),
    reload: async () => {
      const [fresh] = await db
        .select()
        .from(schema.scenes)
        .where(and(eq(schema.scenes.id, scene.id), isNull(schema.scenes.deletedAt)));
      return fresh;
    },
  });
  const verified = row.reviewStatus === input.status;
  return {
    shotId: scene.id,
    reviewStatus: row.reviewStatus ?? null,
    verification: {
      status: verified ? "verified" : "unverified",
      message: verified
        ? "已保留現用版本並重新讀取確認審核狀態"
        : "保留已寫入，但重新讀取未確認審核狀態",
    },
  };
}
