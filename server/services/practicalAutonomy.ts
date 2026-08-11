import { z } from "zod";

export type ToolAccess = "READ" | "WRITE" | "EXTERNAL";
export type ToolRisk = "low" | "medium" | "high";
export type ConfirmationPolicy = "never" | "paid" | "high_risk" | "always";
export type IdempotencyPolicy = "none" | "keyed" | "effect_receipt";

export interface ToolEvidence {
  type: "citation" | "effect" | "provider_receipt";
  ref: string;
  label?: string;
  excerpt?: string;
  verifiedAt: string;
}

export interface ToolResult<T = unknown> {
  value: T;
  evidence: ToolEvidence[];
  actualPoints: number;
  verified: boolean;
}

export interface ToolContext {
  runId: string;
  stepId: string;
  userId: string;
  groupId: string;
  projectId: string;
  idempotencyKey: string;
  signal: AbortSignal;
}

export interface ToolDefinition<I = unknown, O = unknown> {
  id: string;
  label: string;
  category: "project" | "creator" | "generation" | "computer" | "coordination";
  access: ToolAccess;
  input: z.ZodType<I>;
  output: z.ZodType<O>;
  requiredContext: Array<keyof Pick<ToolContext, "userId" | "groupId" | "projectId">>;
  risk: ToolRisk;
  confirmation: ConfirmationPolicy;
  idempotency: IdempotencyPolicy;
  cost: { paid: boolean; estimatePoints(input: I): number };
  retry: { maxAttempts: number; baseDelayMs: number; allowProviderFallback: boolean };
  verify: (result: ToolResult<O>, context: ToolContext) => boolean | Promise<boolean>;
  evidenceScope: "project" | "run" | "external";
  availability: () => { available: boolean; reason?: string; provider?: string };
  handler: (input: I, context: ToolContext) => Promise<ToolResult<O>>;
  handlerIdentity: string;
}

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition<any, any>>();
  register<I, O>(definition: ToolDefinition<I, O>): this {
    if (this.tools.has(definition.id)) throw new Error(`Duplicate tool id: ${definition.id}`);
    if (definition.access !== "READ" && definition.idempotency === "none") {
      throw new Error(`Write/external tool ${definition.id} must declare idempotency`);
    }
    this.tools.set(definition.id, definition);
    return this;
  }
  get(id: string): ToolDefinition<any, any> {
    const tool = this.tools.get(id);
    if (!tool) throw new Error(`Unknown tool: ${id}`);
    return tool;
  }
  capabilities() {
    return [...this.tools.values()].map((tool) => ({
      id: tool.id, label: tool.label, category: tool.category, access: tool.access,
      risk: tool.risk, confirmation: tool.confirmation, paid: tool.cost.paid,
      availability: tool.availability(), handlerIdentity: tool.handlerIdentity,
    }));
  }
}

export type DurableStepStatus = "pending" | "running" | "retrying" | "verifying" | "completed" | "failed" | "paused" | "stopped" | "blocked";
export interface DurableStep {
  id: string; toolId: string; input: unknown; dependsOn: string[]; status: DurableStepStatus;
  idempotencyKey: string; attemptCount: number; expectedEffect?: string;
  verifiedResult?: ToolResult; reservedPoints: number; actualPoints: number;
  leaseOwner?: string; leaseExpiresAt?: string; provider?: string; error?: string;
}
export interface DurableRun {
  id: string; parentRunId?: string; goalId: string; planRevision: number;
  status: "running" | "paused" | "stopped" | "completed" | "failed" | "blocked";
  budgetPoints: number; reservedPoints: number; actualPoints: number;
  steps: DurableStep[]; updatedAt: string;
}
export interface RunLedger {
  load(runId: string): Promise<DurableRun | undefined>;
  save(run: DurableRun): Promise<void>;
  getEffect(idempotencyKey: string): Promise<ToolResult | undefined>;
  saveEffect(idempotencyKey: string, result: ToolResult): Promise<void>;
  reserveOnce(runId: string, idempotencyKey: string, points: number): Promise<boolean>;
  settleOnce(runId: string, idempotencyKey: string, points: number): Promise<boolean>;
}

export class InMemoryRunLedger implements RunLedger {
  runs = new Map<string, DurableRun>(); effects = new Map<string, ToolResult>();
  reservations = new Set<string>(); settlements = new Set<string>();
  async load(id: string) { return this.runs.get(id); }
  async save(run: DurableRun) { this.runs.set(run.id, structuredClone(run)); }
  async getEffect(key: string) { return this.effects.get(key); }
  async saveEffect(key: string, result: ToolResult) { if (!this.effects.has(key)) this.effects.set(key, structuredClone(result)); }
  async reserveOnce(runId: string, key: string) { const k = `${runId}:${key}`; if (this.reservations.has(k)) return false; this.reservations.add(k); return true; }
  async settleOnce(runId: string, key: string) { const k = `${runId}:${key}`; if (this.settlements.has(k)) return false; this.settlements.add(k); return true; }
}

export class ProviderCircuitBreaker {
  private states = new Map<string, { failures: number; openUntil: number }>();
  constructor(private threshold = 3, private cooldownMs = 30_000, private now = () => Date.now()) {}
  available(provider: string) { return (this.states.get(provider)?.openUntil ?? 0) <= this.now(); }
  success(provider: string) { this.states.delete(provider); }
  failure(provider: string) { const old = this.states.get(provider) ?? { failures: 0, openUntil: 0 }; const failures = old.failures + 1; this.states.set(provider, { failures, openUntil: failures >= this.threshold ? this.now() + this.cooldownMs : 0 }); }
}

export interface RouteCandidate { id: string; quality: number; estimatedPoints: number; provider: string; paid: boolean; }
/** Highest-quality healthy route that fits the hard cap; never introduces a forbidden paid fallback. */
export function chooseCostAwareRoute(candidates: RouteCandidate[], remainingPoints: number, circuits: ProviderCircuitBreaker, allowPaid = true): RouteCandidate | undefined {
  return candidates.filter((item) => item.estimatedPoints <= remainingPoints && (allowPaid || !item.paid) && circuits.available(item.provider)).sort((a, b) => b.quality - a.quality || a.estimatedPoints - b.estimatedPoints)[0];
}

export class BudgetExceededError extends Error { code = "BUDGET_EXCEEDED" as const; }
export class ConfirmationRequiredError extends Error { code = "CONFIRMATION_REQUIRED" as const; }

export class PracticalAutonomyRuntime {
  constructor(readonly registry: ToolRegistry, readonly ledger: RunLedger, readonly circuits = new ProviderCircuitBreaker()) {}
  async executeStep(runId: string, stepId: string, actor: Omit<ToolContext, "runId" | "stepId" | "idempotencyKey" | "signal"> & { confirmed?: boolean; signal?: AbortSignal }): Promise<ToolResult> {
    const run = await this.ledger.load(runId); if (!run) throw new Error("Run not found");
    if (run.status === "paused") throw new Error("RUN_PAUSED");
    if (run.status === "stopped") throw new Error("RUN_STOPPED");
    const step = run.steps.find((item) => item.id === stepId); if (!step) throw new Error("Step not found");
    if (step.status === "completed" && step.verifiedResult?.verified) return step.verifiedResult;
    const prior = await this.ledger.getEffect(step.idempotencyKey);
    if (prior?.verified) { if (await this.ledger.settleOnce(run.id, step.idempotencyKey, prior.actualPoints)) { run.reservedPoints = Math.max(0, run.reservedPoints - step.reservedPoints); run.actualPoints += prior.actualPoints; } step.actualPoints = prior.actualPoints; step.status = "completed"; step.verifiedResult = prior; await this.ledger.save(run); return prior; }
    const tool = this.registry.get(step.toolId); const input = tool.input.parse(step.input);
    const availability = tool.availability(); if (!availability.available) { step.status = "blocked"; step.error = availability.reason ?? "BLOCKED_BY_EXTERNAL_DEPENDENCY"; await this.ledger.save(run); throw new Error(step.error); }
    if ((tool.confirmation === "always" || tool.confirmation === "high_risk" || (tool.confirmation === "paid" && tool.cost.paid)) && !actor.confirmed) throw new ConfirmationRequiredError(`Confirmation required for ${tool.id}`);
    const estimate = Math.max(0, tool.cost.estimatePoints(input));
    if (run.actualPoints + run.reservedPoints + (step.reservedPoints > 0 ? 0 : estimate) > run.budgetPoints) throw new BudgetExceededError(`Tool ${tool.id} would exceed ${run.budgetPoints} points`);
    if (await this.ledger.reserveOnce(run.id, step.idempotencyKey, estimate)) { run.reservedPoints += estimate; step.reservedPoints = estimate; }
    const controller = new AbortController(); actor.signal?.addEventListener("abort", () => controller.abort(), { once: true });
    const context: ToolContext = { ...actor, runId, stepId, idempotencyKey: step.idempotencyKey, signal: controller.signal };
    let lastError: unknown;
    for (let attempt = step.attemptCount + 1; attempt <= tool.retry.maxAttempts; attempt++) {
      if ((await this.ledger.load(runId))?.status === "stopped") throw new Error("RUN_STOPPED");
      step.attemptCount = attempt; step.status = attempt === 1 ? "running" : "retrying"; await this.ledger.save(run);
      try {
        const result = await tool.handler(input, context); tool.output.parse(result.value); step.status = "verifying"; await this.ledger.save(run);
        const verified = result.verified && await tool.verify(result, context);
        if (!verified || ((tool.access === "WRITE" || tool.access === "EXTERNAL") && result.evidence.length === 0)) throw new Error("UNVERIFIED_EFFECT");
        const final = { ...result, verified: true }; await this.ledger.saveEffect(step.idempotencyKey, final);
        if (await this.ledger.settleOnce(run.id, step.idempotencyKey, final.actualPoints)) { run.reservedPoints -= step.reservedPoints; run.actualPoints += final.actualPoints; }
        step.actualPoints = final.actualPoints; step.verifiedResult = final; step.status = "completed"; await this.ledger.save(run); return final;
      } catch (error) { lastError = error; step.error = error instanceof Error ? error.message : String(error); if (availability.provider) this.circuits.failure(availability.provider); if (tool.idempotency === "none") break; if (attempt < tool.retry.maxAttempts && tool.retry.baseDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, tool.retry.baseDelayMs * 2 ** (attempt - 1))); }
    }
    step.status = "failed"; await this.ledger.save(run); throw lastError;
  }
  async transition(runId: string, action: "pause" | "resume" | "stop") {
    const run = await this.ledger.load(runId); if (!run) throw new Error("Run not found");
    if (action === "stop") { if (["completed", "failed", "stopped"].includes(run.status)) throw new Error("TERMINAL_RUN"); run.status = "stopped"; for (const step of run.steps) if (["pending", "retrying", "paused", "blocked"].includes(step.status)) step.status = "stopped"; }
    if (action === "pause") { if (run.status !== "running") throw new Error("INVALID_TRANSITION"); run.status = "paused"; for (const step of run.steps) if (step.status === "pending") step.status = "paused"; }
    if (action === "resume") { if (run.status !== "paused") throw new Error("INVALID_TRANSITION"); run.status = "running"; for (const step of run.steps) if (step.status === "paused") step.status = "pending"; }
    run.updatedAt = new Date().toISOString(); await this.ledger.save(run); return run;
  }
}

export interface AgentSkill { id: string; name: string; version: number; inputs: z.ZodTypeAny; requiredCapabilities: string[]; steps: Array<{ id: string; toolId: string; dependsOn: string[] }>; maxConcurrency: number; resumable: true; }
export const AGENT_SKILLS: AgentSkill[] = [
  { id: "project_health_scan", name: "Project health scan", version: 1, inputs: z.object({ projectId: z.string().uuid() }), requiredCapabilities: ["project.health", "project.files.list"], steps: [{ id: "health", toolId: "project.health", dependsOn: [] }, { id: "files", toolId: "project.files.list", dependsOn: [] }], maxConcurrency: 2, resumable: true },
  { id: "story_to_storyboard", name: "Story to storyboard", version: 1, inputs: z.object({ projectId: z.string().uuid(), sourceFileIds: z.array(z.string().uuid()) }), requiredCapabilities: ["project.files.read", "creator.storyboard.write"], steps: [{ id: "read", toolId: "project.files.read", dependsOn: [] }, { id: "write", toolId: "creator.storyboard.write", dependsOn: ["read"] }], maxConcurrency: 2, resumable: true },
  { id: "storyboard_asset_prep", name: "Storyboard asset prep", version: 1, inputs: z.object({ projectId: z.string().uuid() }), requiredCapabilities: ["project.health"], steps: [{ id: "health", toolId: "project.health", dependsOn: [] }], maxConcurrency: 1, resumable: true },
  { id: "creator_delivery_check", name: "Creator delivery check", version: 1, inputs: z.object({ projectId: z.string().uuid() }), requiredCapabilities: ["project.health"], steps: [{ id: "verify", toolId: "project.health", dependsOn: [] }], maxConcurrency: 1, resumable: true },
  { id: "organize_recent_assets", name: "Organize recent assets", version: 1, inputs: z.object({ projectId: z.string().uuid() }), requiredCapabilities: ["project.files.list"], steps: [{ id: "list", toolId: "project.files.list", dependsOn: [] }], maxConcurrency: 1, resumable: true },
  { id: "research_to_project_notes", name: "Research to project notes", version: 1, inputs: z.object({ projectId: z.string().uuid(), query: z.string() }), requiredCapabilities: ["project.files.search"], steps: [{ id: "search", toolId: "project.files.search", dependsOn: [] }], maxConcurrency: 1, resumable: true },
];

export async function boundedDelegate<T, R>(items: T[], worker: (item: T, signal: AbortSignal) => Promise<R>, options: { concurrency: number; maxConcurrency?: number; signal?: AbortSignal }): Promise<R[]> {
  const limit = Math.max(1, Math.min(options.concurrency, options.maxConcurrency ?? 4)); const out = new Array<R>(items.length); let cursor = 0;
  const controller = new AbortController(); options.signal?.addEventListener("abort", () => controller.abort(), { once: true });
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { while (true) { if (controller.signal.aborted) throw new Error("DELEGATION_CANCELLED"); const index = cursor++; if (index >= items.length) return; out[index] = await worker(items[index]!, controller.signal); } }));
  return out;
}
