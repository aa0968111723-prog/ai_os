import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db, schema } from "../db";
import { AgentRunLedger } from "./agentRunLedger";

const RUN_PG = Boolean(process.env.DATABASE_URL);
const describePg = RUN_PG ? describe : describe.skip;
const createdKeys: string[] = [];
const createdRunIds: string[] = [];

function claim(runId: string, key: string, attemptId: string, leaseExpiresAt = new Date(Date.now() + 60_000).toISOString()) {
  return {
    runId,
    stepId: "step",
    toolId: "test.write",
    idempotencyKey: key,
    effectFingerprint: "f".repeat(64),
    attemptId,
    reservedPoints: 5,
    leaseExpiresAt,
    owner: { userId: randomUUID(), groupId: randomUUID(), projectId: randomUUID() },
    receipt: {
      goalId: runId,
      runId,
      stepId: "step",
      toolCallId: randomUUID(),
      attemptId,
      capabilityId: "test.write",
      handlerIdentity: "test.write",
      effectFingerprint: "f".repeat(64),
      idempotencyKey: key,
      requestedAt: new Date().toISOString(),
      verificationMethod: "authoritative_read_back",
      trustOrigin: "USER_EXPLICIT" as const,
    },
  };
}

describePg("AgentRunLedger PostgreSQL leases", () => {
  const ledger = new AgentRunLedger();

  afterAll(async () => {
    for (const key of createdKeys) await db.delete(schema.agentToolReceipts).where(eq(schema.agentToolReceipts.idempotencyKey, key));
    for (const runId of createdRunIds) await db.delete(schema.agentRuns).where(eq(schema.agentRuns.id, runId));
  });

  it("allows exactly one concurrent owner and one settlement", async () => {
    const runId = randomUUID(); const key = `v5:${runId}:step:test.write:${"f".repeat(64)}`; createdKeys.push(key);
    const a = randomUUID(); const b = randomUUID();
    const claims = await Promise.all([ledger.claimEffect(claim(runId, key, a)), ledger.claimEffect(claim(runId, key, b))]);
    expect(claims.filter((item) => item.state === "acquired")).toHaveLength(1);
    expect(claims.filter((item) => item.state === "in_progress")).toHaveLength(1);
    const winner = claims[0]!.state === "acquired" ? a : b;
    const loser = winner === a ? b : a;
    const result = { value: { id: "effect" }, evidence: [{ type: "effect" as const, ref: "effect", verifiedAt: new Date().toISOString() }], actualPoints: 4, verified: true };
    expect(await ledger.saveEffect(runId, key, loser, result)).toBe(false);
    expect(await ledger.saveEffect(runId, key, winner, result)).toBe(true);
    expect((await ledger.getEffect(runId, key))?.verified).toBe(true);
    expect(await ledger.settleOnce(randomUUID(), key, 4)).toBe(false);
    expect(await ledger.settleOnce(runId, key, 4)).toBe(true);
    expect(await ledger.settleOnce(runId, key, 4)).toBe(false);
  });

  it("refuses a second concurrent settlement and a foreign-tenant owner", async () => {
    const owner = { userId: randomUUID(), groupId: randomUUID(), projectId: randomUUID() };
    const runId = randomUUID();
    createdRunIds.push(runId);
    await db.insert(schema.agentRuns).values({
      id: runId,
      projectId: owner.projectId,
      groupId: owner.groupId,
      userId: owner.userId,
      goal: "settleOnce",
      steps: [{ id: "step", toolId: "test.write", input: {}, dependsOn: [], status: "pending", attemptCount: 0, reservedPoints: 0, actualPoints: 0 }],
      estPoints: 10,
      status: "running",
    });
    const key = `v5:${runId}:step:test.write:${"a".repeat(64)}`;
    createdKeys.push(key);
    const attemptId = randomUUID();
    expect((await ledger.claimEffect({ ...claim(runId, key, attemptId), owner })).state).toBe("acquired");
    const result = { value: { id: "effect" }, evidence: [{ type: "effect" as const, ref: "effect", verifiedAt: new Date().toISOString() }], actualPoints: 4, verified: true };
    expect(await ledger.saveEffect(runId, key, attemptId, result)).toBe(true);
    expect(await ledger.settleOnce(runId, key, 4, { userId: randomUUID(), groupId: owner.groupId })).toBe(false);
    expect(await ledger.settleOnce(runId, key, 4, { userId: owner.userId, groupId: randomUUID() })).toBe(false);
    expect(await ledger.settleOnce(runId, key, -4, { userId: owner.userId, groupId: owner.groupId })).toBe(false);
    const raced = await Promise.all([
      ledger.settleOnce(runId, key, 4, owner),
      ledger.settleOnce(runId, key, 4, owner),
    ]);
    expect(raced.filter(Boolean)).toHaveLength(1);
    expect(await ledger.settleOnce(runId, key, 4, owner)).toBe(false);
  });

  it("rejects a forged same key with different run/tool/effect identity", async () => {
    const runId = randomUUID(); const key = `v6:group:${runId}:step:test.write:${"c".repeat(64)}`; createdKeys.push(key);
    expect((await ledger.claimEffect(claim(runId, key, randomUUID()))).state).toBe("acquired");
    await expect(ledger.claimEffect({
      ...claim(randomUUID(), key, randomUUID()),
      toolId: "other.write",
      effectFingerprint: "d".repeat(64),
    })).rejects.toThrow("IDEMPOTENCY_IDENTITY_CONFLICT");
  });

  it("reclaims an expired lease after a worker restart", async () => {
    const runId = randomUUID(); const key = `v5:${runId}:step:test.write:${"e".repeat(64)}`; createdKeys.push(key);
    const crashed = randomUUID(); const recovered = randomUUID();
    expect((await ledger.claimEffect(claim(runId, key, crashed, new Date(Date.now() - 1000).toISOString()))).state).toBe("acquired");
    expect((await ledger.claimEffect(claim(runId, key, recovered))).state).toBe("acquired");
  });

  it("rejects a stale whole-JSON run save instead of losing a concurrent transition", async () => {
    const runId = randomUUID(); createdRunIds.push(runId);
    await db.insert(schema.agentRuns).values({
      id: runId,
      projectId: randomUUID(),
      groupId: randomUUID(),
      userId: randomUUID(),
      goal: "concurrency",
      steps: [{ id: "step", toolId: "test.write", input: {}, dependsOn: [], status: "pending", attemptCount: 0, reservedPoints: 0, actualPoints: 0 }],
      estPoints: 10,
      status: "running",
    });
    const first = (await ledger.load(runId))!;
    const stale = (await ledger.load(runId))!;
    first.status = "paused";
    stale.status = "stopped";
    const outcomes = await Promise.allSettled([ledger.save(first), ledger.save(stale)]);
    expect(outcomes.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((item) => item.status === "rejected")).toHaveLength(1);
    expect((outcomes.find((item) => item.status === "rejected") as PromiseRejectedResult).reason).toMatchObject({ message: "RUN_STATE_CONFLICT" });
  });

  it("preserves user-controlled ownership while a synchronous certifier saves step state", async () => {
    const runId = randomUUID(); createdRunIds.push(runId);
    await db.insert(schema.agentRuns).values({
      id: runId,
      projectId: randomUUID(),
      groupId: randomUUID(),
      userId: randomUUID(),
      goal: "synchronous certification",
      steps: [{ id: "certify", toolId: "test.write", input: {}, dependsOn: [], status: "pending", attemptCount: 0, reservedPoints: 0, actualPoints: 0 }],
      estPoints: 10,
      status: "user_controlled",
    });
    const owned = (await ledger.load(runId))!;
    expect(owned.status).toBe("user_controlled");
    owned.steps[0]!.status = "running";
    await ledger.save(owned);
    const [stored] = await db.select({ status: schema.agentRuns.status }).from(schema.agentRuns).where(eq(schema.agentRuns.id, runId));
    expect(stored?.status).toBe("user_controlled");
  });
});
