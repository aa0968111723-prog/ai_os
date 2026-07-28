import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db, schema } from "../db";
import {
  executeAgentEffectOnce,
  executeAgentEffectOnceInTransaction,
  type AgentEffectIdentity,
} from "./agentEffectCore";

const RUN_PG = process.env.RUN_PG_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);

describe.skipIf(!RUN_PG).sequential("agent step effects (real PostgreSQL)", () => {
  const groupId = randomUUID();
  const userId = randomUUID();
  const runIds: string[] = [];
  const noteIds: string[] = [];

  afterAll(async () => {
    if (runIds.length) {
      await db.delete(schema.agentStepEffects).where(inArray(schema.agentStepEffects.runId, runIds));
    }
    if (noteIds.length) {
      await db.delete(schema.notes).where(inArray(schema.notes.id, noteIds));
    }
  });

  function identity(): AgentEffectIdentity {
    const runId = randomUUID();
    runIds.push(runId);
    return {
      effectId: randomUUID(),
      runId,
      stepId: "append-research",
      kind: "append_note",
      outputType: "note",
    };
  }

  it("serializes concurrent replicas and applies the protected write once", async () => {
    const effect = identity();
    const noteId = randomUUID();
    noteIds.push(noteId);
    let calls = 0;
    const apply = async (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => {
      calls += 1;
      await tx.insert(schema.notes).values({
        id: noteId,
        groupId,
        title: "Agent effect",
        content: "created once",
        createdBy: userId,
      });
      return noteId;
    };
    const replies = await Promise.all([
      executeAgentEffectOnce(effect, apply),
      executeAgentEffectOnce(effect, apply),
    ]);
    expect(calls).toBe(1);
    expect(replies.map((reply) => reply.replayed).sort()).toEqual([false, true]);
    expect(replies.every((reply) => reply.outputId === noteId)).toBe(true);
  });

  it("rolls the protected write and effect record back together", async () => {
    const effect = identity();
    const noteId = randomUUID();
    noteIds.push(noteId);
    const marker = new Error("simulated crash before commit");
    await expect(db.transaction(async (tx) => {
      await executeAgentEffectOnceInTransaction(tx, effect, async (innerTx) => {
        await innerTx.insert(schema.notes).values({
          id: noteId,
          groupId,
          title: "Rolled back",
          content: "must disappear",
          createdBy: userId,
        });
        return noteId;
      });
      throw marker;
    })).rejects.toBe(marker);

    const notes = await db.select().from(schema.notes).where(eq(schema.notes.id, noteId));
    const effects = await db
      .select()
      .from(schema.agentStepEffects)
      .where(eq(schema.agentStepEffects.runId, effect.runId));
    expect(notes).toHaveLength(0);
    expect(effects).toHaveLength(0);
  });

  it("fails closed when a replay changes the effect identity", async () => {
    const effect = identity();
    const noteId = randomUUID();
    noteIds.push(noteId);
    await executeAgentEffectOnce(effect, async (tx) => {
      await tx.insert(schema.notes).values({
        id: noteId,
        groupId,
        title: "Original",
        content: "original",
        createdBy: userId,
      });
      return noteId;
    });
    await expect(executeAgentEffectOnce({
      ...effect,
      effectId: randomUUID(),
      kind: "update_schedule",
      outputType: "schedule",
    }, async () => randomUUID())).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
