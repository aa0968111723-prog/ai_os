/**
 * Explicit Adopt: the only path that may move a shot's current visual pointer.
 */
import { and, asc, eq, gt, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db, schema } from "../db";
import type { AuthState } from "./auth";
import { evaluateGenerationCandidate, shouldAdoptCandidate } from "../../shared/consistencyEval";
import { loadCreativeContextProject } from "./storyEntityBinding";
import { loadShotContextPacket } from "./shotContextPackets";
import { splitGenerationSourceMeta } from "../../shared/generationSourceMeta";
import { deriveShotEndState } from "../../shared/scriptChanges";
import type { ShotContextPacketPayload } from "../../shared/shotContextPacket";

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
  let frozenPayload: ShotContextPacketPayload | null = null;
  if (meta.shotContextPacketId) {
    const frozen = await loadShotContextPacket({
      auth: input.auth,
      projectId: generation.projectId,
      packetId: meta.shotContextPacketId,
    });
    frozenPayload = frozen.payload;
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

  // 指標移動與 end-state 抽取同一個交易：兩個人同時 Adopt 不同結果時，
  // scenes.assetId 與 shot_continuity_states 永遠是同一筆生成的一對（last-write-wins 但成對）。
  const updated = await db.transaction(async (tx) => {
    const [row] = await tx.update(schema.scenes).set({
      assetId: asset.id,
    }).where(and(
      eq(schema.scenes.id, generation.sceneId!),
      isNull(schema.scenes.deletedAt),
    )).returning({ id: schema.scenes.id });
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這個分鏡" });

    // §11：Adopt 是 end-state 的抽取點——這一鏡「確定長這樣」之後，
    // 濕度／傷勢／造型狀態才能可靠地流進下一鏡的 start-state。
    if (frozenPayload) {
      const endState = deriveShotEndState({
        currentStart: frozenPayload.continuity.currentStart,
        authorizedChanges: frozenPayload.scriptAuthorizedChanges ?? [],
        environment: frozenPayload.environment,
      });
      await tx.insert(schema.shotContinuityStates).values({
        shotId: row.id,
        projectId: generation.projectId,
        groupId: generation.groupId,
        endState,
        sourceGenerationId: generation.id,
        sourceAssetId: asset.id,
        extractedAt: new Date(),
        updatedAt: new Date(),
      }).onConflictDoUpdate({
        target: schema.shotContinuityStates.shotId,
        set: {
          endState,
          sourceGenerationId: generation.id,
          sourceAssetId: asset.id,
          extractedAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }
    return row;
  });

  // end-state 變了＝下一鏡的 previousEnd 過期：立刻重算下一鏡指紋並標 stale
  // （fire-and-forget 會讓「亂序 Adopt」餵舊狀態給已凍結的下一鏡——這裡同步做，失敗不擋 Adopt）
  if (frozenPayload) {
    try {
      const { buildShotContextPacketPayload, hashShotContextPacket } = await import("./shotContextPackets");
      const [nextShot] = await db.select({ id: schema.scenes.id })
        .from(schema.scenes)
        .where(and(
          eq(schema.scenes.projectId, generation.projectId),
          isNull(schema.scenes.deletedAt),
          gt(schema.scenes.orderIndex, (await db.select({ orderIndex: schema.scenes.orderIndex })
            .from(schema.scenes).where(eq(schema.scenes.id, updated.id)))[0]?.orderIndex ?? 0),
        ))
        .orderBy(asc(schema.scenes.orderIndex))
        .limit(1);
      if (nextShot) {
        const [head] = await db.select().from(schema.shotContextPacketHeads)
          .where(eq(schema.shotContextPacketHeads.shotId, nextShot.id));
        if (head) {
          const rebuilt = await buildShotContextPacketPayload({
            auth: input.auth,
            projectId: generation.projectId,
            shotId: nextShot.id,
          });
          if (hashShotContextPacket(rebuilt) !== head.fingerprint) {
            await db.update(schema.shotContextPacketHeads).set({
              stale: true,
              staleReason: "上一鏡已採用新結果，連戲狀態已變",
              updatedAt: new Date(),
            }).where(eq(schema.shotContextPacketHeads.shotId, nextShot.id));
          }
        }
      }
    } catch (error) {
      console.warn("[adopt] next-shot staleness skipped:", error instanceof Error ? error.message : error);
    }
  }
  return { shotId: updated.id, assetId: asset.id, adopted: true };
}

export function deliveryBlockers(input: {
  shots: Array<{ id: string; assetId: string | null; reviewStatus: string | null }>;
  staleShotIds: readonly string[];
}): string[] {
  const blockers: string[] = [];
  const stale = new Set(input.staleShotIds);
  if (input.shots.some((shot) => !shot.assetId)) blockers.push("還有鏡頭沒有已採用畫面");
  if (input.shots.some((shot) => stale.has(shot.id))) blockers.push("有鏡頭因上游變更而過期");
  if (input.shots.some((shot) => shot.reviewStatus && shot.reviewStatus !== "approved" && shot.reviewStatus !== "ready")) {
    blockers.push("有鏡頭尚未核准");
  }
  return blockers;
}
