import { randomUUID } from "node:crypto";
import { z } from "zod";
import { EffectInProgressError, InMemoryRunLedger, PracticalAutonomyRuntime, ToolRegistry, type DurableRun } from "../server/services/practicalAutonomy";

const rounds = Math.max(50, Math.min(2_000, Number(process.env.AGENT_SOAK_ROUNDS ?? 300)));
const effects = new Map<string, string>();
let handlerCalls = 0;
let injectedFailures = 0;
let duplicateBlocks = 0;
let reconciliationResumes = 0;
const uncertainRounds = new Set<number>();
const rollbackRounds = new Set<number>();

const registry = new ToolRegistry().register({
  id: "soak.write", label: "Soak write", category: "project", access: "WRITE",
  input: z.object({ round: z.number().int() }), output: z.object({ id: z.string().uuid() }),
  requiredContext: ["userId", "groupId", "projectId"], risk: "medium", confirmation: "never",
  idempotency: "effect_receipt", cost: { paid: true, estimatePoints: () => 2 },
  retry: { maxAttempts: 3, baseDelayMs: 1, allowProviderFallback: false },
  verificationStage: "VERIFIED", verificationMethod: "authoritative_soak_read_back",
  verify: (result, context) => result.verified && effects.get(context.idempotencyKey) === (result.value as { id: string }).id,
  evidenceScope: "project", availability: () => ({ available: true, provider: "soak-provider" }),
  handlerIdentity: "soak.idempotentWrite",
  handler: async (input, context) => {
    handlerCalls += 1;
    if (input.round % 14 === 7 && !rollbackRounds.has(input.round)) {
      rollbackRounds.add(input.round);
      injectedFailures += 1;
      throw Object.assign(new Error("SERIALIZATION_ROLLBACK"), { code: "40001" });
    }
    const id = effects.get(context.idempotencyKey) ?? randomUUID();
    effects.set(context.idempotencyKey, id);
    if (input.round % 14 === 0 && !uncertainRounds.has(input.round)) {
      uncertainRounds.add(input.round);
      injectedFailures += 1;
      // The write happened but its acknowledgement was lost. The runtime must
      // stop rather than replay blindly; a later explicit resume reads back the
      // handler's idempotent effect.
      throw Object.assign(new Error("DB_TIMEOUT_AFTER_IDEMPOTENT_WRITE"), { code: "57014" });
    }
    return { value: { id }, evidence: [{ type: "effect" as const, ref: `soak:${id}`, verifiedAt: new Date().toISOString() }], actualPoints: 1, verified: true };
  },
});

function makeRun(index: number): DurableRun {
  const id = `run-${index}`;
  return { id, goalId: `goal-${index}`, planRevision: 1, status: "running", budgetPoints: 5, reservedPoints: 0, actualPoints: 0, updatedAt: new Date().toISOString(), steps: [{ id: "step", toolId: "soak.write", input: { round: index }, dependsOn: [], status: "pending", idempotencyKey: "pending", attemptCount: 0, reservedPoints: 0, actualPoints: 0 }] };
}

const ledger = new InMemoryRunLedger();
const runtime = new PracticalAutonomyRuntime(registry, ledger);
for (let index = 1; index <= rounds; index += 1) {
  await ledger.save(makeRun(index));
  const actor = { userId: "qa-user", groupId: "qa-group", projectId: "qa-project" };
  const first = runtime.executeStep(`run-${index}`, "step", actor);
  if (index % 3 === 0) {
    await Promise.resolve();
    try { await runtime.executeStep(`run-${index}`, "step", actor); }
    catch (error) { if (error instanceof EffectInProgressError) duplicateBlocks += 1; else throw error; }
  }
  let result;
  try {
    result = await first;
  } catch (error) {
    if (!uncertainRounds.has(index)) throw error;
    const failed = await ledger.load(`run-${index}`);
    if (failed?.steps[0]?.error !== "EFFECT_OUTCOME_REQUIRES_RECONCILIATION") throw error;
    reconciliationResumes += 1;
    result = await runtime.executeStep(`run-${index}`, "step", actor);
  }
  const repeat = await runtime.executeStep(`run-${index}`, "step", actor);
  if (result.value.id !== repeat.value.id || !result.receipt?.verifiedAt) throw new Error(`receipt/replay mismatch at round ${index}`);
  const saved = await ledger.load(`run-${index}`);
  if (saved?.actualPoints !== 1 || saved.reservedPoints !== 0 || saved.steps[0]?.status !== "completed") throw new Error(`settlement mismatch at round ${index}`);
}

if (effects.size !== rounds) throw new Error(`duplicate or missing effects: expected=${rounds} actual=${effects.size}`);
console.log(JSON.stringify({ ok: true, rounds, uniqueEffects: effects.size, handlerCalls, injectedFailures, reconciliationResumes, duplicateBlocks, providerHealth: runtime.circuits.snapshot("soak-provider") }));
