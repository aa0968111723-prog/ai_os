import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../server/db";
import { AgentRunLedger } from "../server/services/agentRunLedger";
import { runAgentDbIntegrityScan } from "../server/services/agentDbIntegrity";
import { PracticalAutonomyRuntime, ToolRegistry, type DurableStep } from "../server/services/practicalAutonomy";

const phase = process.env.RECOVERY_DRILL_PHASE ?? "seed";
const ledger = new AgentRunLedger();

function recoveryRegistry(effectId: string, onCall: () => void) {
  return new ToolRegistry().register({
    id: "recovery.fixture.write", label: "Recovery fixture write", category: "project", access: "WRITE",
    input: z.object({ effectId: z.string().uuid() }), output: z.object({ effectId: z.string().uuid() }),
    requiredContext: ["userId", "groupId", "projectId"], risk: "low", confirmation: "never",
    idempotency: "effect_receipt", cost: { paid: true, estimatePoints: () => 3 },
    retry: { maxAttempts: 1, baseDelayMs: 0, allowProviderFallback: false },
    verificationStage: "VERIFIED", verificationMethod: "independent_agent_step_effect_read_back",
    evidenceScope: "run", availability: () => ({ available: true }), handlerIdentity: "qa.recoveryFixture",
    handler: async (_input, context) => {
      onCall();
      await db.insert(schema.agentStepEffects).values({ id: effectId, runId: context.runId, stepId: context.stepId, kind: "recovery_fixture", outputType: "fixture", outputId: effectId });
      return { value: { effectId }, evidence: [{ type: "effect" as const, ref: `agent-step-effect:${effectId}`, verifiedAt: new Date().toISOString() }], actualPoints: 2, verified: true };
    },
    verify: async (_result, context) => {
      const [effect] = await db.select({ id: schema.agentStepEffects.id }).from(schema.agentStepEffects).where(and(eq(schema.agentStepEffects.runId, context.runId), eq(schema.agentStepEffects.stepId, context.stepId), eq(schema.agentStepEffects.id, effectId)));
      return effect?.id === effectId;
    },
  });
}

if (phase === "seed") {
  const runId = randomUUID(); const userId = randomUUID(); const groupId = randomUUID(); const projectId = randomUUID(); const effectId = randomUUID();
  const step: DurableStep = { id: "recovery-step", toolId: "recovery.fixture.write", input: { effectId }, dependsOn: [], status: "pending", idempotencyKey: "pending", attemptCount: 0, reservedPoints: 0, actualPoints: 0 };
  await db.insert(schema.projects).values({ id: projectId, groupId, ownerId: userId, title: "Isolated Agent recovery fixture", kind: "qa", platform: "internal", format: "fixture" });
  await db.insert(schema.agentRuns).values({ id: runId, userId, groupId, projectId, goal: "isolated backup recovery drill", summary: "recovery fixture", status: "running", steps: [step], estPoints: 10, planSummary: { revision: 1 } as any });
  let handlerCalls = 0;
  const result = await new PracticalAutonomyRuntime(recoveryRegistry(effectId, () => { handlerCalls += 1; }), ledger).executeStep(runId, step.id, { userId, groupId, projectId });
  await db.update(schema.agentRuns).set({ status: "done", updatedAt: new Date() }).where(eq(schema.agentRuns.id, runId));
  console.log(JSON.stringify({ ok: result.verified && handlerCalls === 1, phase, runId, userId, groupId, projectId, effectId, idempotencyKey: result.receipt?.idempotencyKey, actualPoints: result.actualPoints, handlerCalls }));
} else if (phase === "verify") {
  const runId = process.env.RECOVERY_RUN_ID!; const effectId = process.env.RECOVERY_EFFECT_ID!;
  if (!runId || !effectId) throw new Error("RECOVERY_RUN_ID and RECOVERY_EFFECT_ID are required");
  const loaded = await ledger.load(runId); if (!loaded) throw new Error("restored run is missing");
  let handlerCalls = 0;
  const result = await new PracticalAutonomyRuntime(recoveryRegistry(effectId, () => { handlerCalls += 1; }), ledger).executeStep(runId, "recovery-step", { userId: loaded.userId!, groupId: loaded.groupId!, projectId: loaded.projectId! });
  const [receipt] = await db.select().from(schema.agentToolReceipts).where(eq(schema.agentToolReceipts.runId, runId));
  const [effect] = await db.select().from(schema.agentStepEffects).where(eq(schema.agentStepEffects.id, effectId));
  const secondSettlement = receipt ? await ledger.settleOnce(runId, receipt.idempotencyKey, receipt.actualPoints ?? 0) : true;
  const integrity = await runAgentDbIntegrityScan();
  const ok = result.verified && handlerCalls === 0 && !!effect && receipt?.settled === true && secondSettlement === false && integrity.criticalCount === 0;
  console.log(JSON.stringify({ ok, phase, runId, effectId, restoredEffectRecognized: handlerCalls === 0, duplicateSettlementBlocked: secondSettlement === false, integrityCriticalCount: integrity.criticalCount }));
  if (!ok) process.exitCode = 1;
} else {
  throw new Error(`Unknown RECOVERY_DRILL_PHASE: ${phase}`);
}
