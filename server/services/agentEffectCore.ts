import { and, eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db, schema } from "../db";
import type { DatabaseTransaction } from "./databaseCore";

const AGENT_EFFECT_LOCK_SEED = 0x4147454e;

export interface AgentEffectIdentity {
  effectId: string;
  runId: string;
  stepId: string;
  kind: string;
  outputType: "note" | "schedule";
}

/**
 * 在副作用的同一個 PostgreSQL 交易內保存永久效果憑證。
 * 同一 run/step 重播會直接回放既有 outputId；若 payload 指向不同種類或目標則停止，
 * 不以「最後一次寫入獲勝」掩蓋已損壞的計畫狀態。
 */
export async function executeAgentEffectOnceInTransaction(
  tx: DatabaseTransaction,
  identity: AgentEffectIdentity,
  apply: (tx: DatabaseTransaction) => Promise<string>,
): Promise<{ outputId: string; replayed: boolean }> {
  const lockKey = `${identity.runId}:${identity.stepId}`;
  await tx.execute(sql`
    select pg_advisory_xact_lock(hashtextextended(${lockKey}, ${AGENT_EFFECT_LOCK_SEED}))
  `);
  const [existing] = await tx
    .select()
    .from(schema.agentStepEffects)
    .where(and(
      eq(schema.agentStepEffects.runId, identity.runId),
      eq(schema.agentStepEffects.stepId, identity.stepId),
    ))
    .limit(1);
  if (existing) {
    if (
      existing.id !== identity.effectId
      || existing.kind !== identity.kind
      || existing.outputType !== identity.outputType
    ) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "代理步驟的冪等憑證與既有執行結果不一致，已停止以避免覆寫資料",
      });
    }
    return { outputId: existing.outputId, replayed: true };
  }

  const outputId = await apply(tx);
  await tx.insert(schema.agentStepEffects).values({
    id: identity.effectId,
    runId: identity.runId,
    stepId: identity.stepId,
    kind: identity.kind,
    outputType: identity.outputType,
    outputId,
  });
  return { outputId, replayed: false };
}

export function executeAgentEffectOnce(
  identity: AgentEffectIdentity,
  apply: (tx: DatabaseTransaction) => Promise<string>,
): Promise<{ outputId: string; replayed: boolean }> {
  return db.transaction((tx) => executeAgentEffectOnceInTransaction(tx, identity, apply));
}
