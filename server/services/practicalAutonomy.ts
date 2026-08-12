import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { classifyExecutionError, isRetrySafeExecutionError } from "./dbRetryPolicy";

export type ToolAccess = "READ" | "WRITE" | "EXTERNAL";
export type ToolRisk = "low" | "medium" | "high";
export type ConfirmationPolicy = "never" | "paid" | "high_risk" | "always";
export type IdempotencyPolicy = "none" | "keyed" | "effect_receipt";
export type TrustLabel = "SYSTEM" | "USER_EXPLICIT" | "VERIFIED_INTERNAL" | "EXTERNAL_UNTRUSTED" | "GENERATED_UNTRUSTED";
export type VerificationStage = "ACCEPTED" | "QUEUED" | "RUNNING" | "PERSISTED" | "INDEXED" | "VERIFIED" | "COMPLETED";

export interface ToolIdempotencyContract {
  policy: IdempotencyPolicy;
  keyStrategy: "run_step_effect_fingerprint";
  duplicateEffectPolicy: "return_verified_receipt" | "block_while_in_flight";
  retryPolicy: "same_key_only";
  billingPolicy: "reserve_once_settle_once";
}

export interface ChildAuthority {
  parentRunId: string;
  allowedCapabilities: string[];
  groupId: string;
  projectIds: string[];
  maxPoints: number;
  maxSteps: number;
  depth: number;
  maxDepth: number;
  expiresAt: string;
}

export interface ToolEvidence {
  type: "citation" | "effect" | "provider_receipt";
  ref: string;
  label?: string;
  excerpt?: string;
  verifiedAt: string;
  trust?: TrustLabel;
  provenance?: string;
}

export interface ExecutionReceipt {
  goalId: string;
  runId: string;
  stepId: string;
  toolCallId: string;
  attemptId: string;
  capabilityId: string;
  handlerIdentity: string;
  effectFingerprint: string;
  idempotencyKey: string;
  requestedAt: string;
  executedAt: string;
  verifiedAt: string;
  verificationStage: Exclude<VerificationStage, "ACCEPTED" | "QUEUED" | "RUNNING">;
  verificationMethod: string;
  targetRefs: string[];
  traceId?: string;
  conversationId?: string;
  providerRequestId?: string;
  dbTransactionId?: string;
  actualPoints: number;
  trustOrigin: TrustLabel;
}

export interface ToolResult<T = unknown> {
  value: T;
  evidence: ToolEvidence[];
  actualPoints: number;
  verified: boolean;
  receipt?: ExecutionReceipt;
}

export interface ToolContext {
  runId: string;
  stepId: string;
  userId: string;
  groupId: string;
  projectId: string;
  idempotencyKey: string;
  effectFingerprint: string;
  toolCallId: string;
  attemptId: string;
  traceId?: string;
  conversationId?: string;
  agentDepth?: number;
  maxAgentDepth?: number;
  visitedCapabilities?: string[];
  inputTrust: TrustLabel;
  authority?: ChildAuthority;
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
  idempotencyContract?: ToolIdempotencyContract;
  cost: { paid: boolean; estimatePoints(input: I): number };
  retry: { maxAttempts: number; baseDelayMs: number; allowProviderFallback: boolean };
  verify: (result: ToolResult<O>, context: ToolContext) => boolean | Promise<boolean>;
  verificationStage?: VerificationStage;
  verificationMethod?: string;
  evidenceScope: "project" | "run" | "external";
  availability: () => { available: boolean; reason?: string; provider?: string };
  handler: (input: I, context: ToolContext) => Promise<ToolResult<O>>;
  handlerIdentity: string;
  required?: boolean;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

const SECRET_FIELD_RE = /^(?:authorization|proxyAuthorization|api[_-]?key|access[_-]?token|refresh[_-]?token|session[_-]?token|cookie|set-cookie|password|passwd|secret|credential)$/i;
const SECRET_VALUE_RE = /(?:bearer\s+[a-z0-9._~+\/-]{12,}|\bsk-(?:proj-)?[a-z0-9_-]{12,}|(?:token|secret|password|api[_-]?key|x-amz-signature)=([^\s&]{6,}))/ig;

function safePersistedString(value: string): string {
  const redacted = value.replace(SECRET_VALUE_RE, (match) => `${match.slice(0, Math.max(0, match.indexOf("=") + 1))}[REDACTED]`);
  return redacted.length > 4_096 ? `${redacted.slice(0, 4_096)}…[TRUNCATED]` : redacted;
}

function safePersistedValue(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[TRUNCATED_DEPTH]";
  if (typeof value === "string") return safePersistedString(value);
  if (typeof value === "number" || typeof value === "boolean" || value == null) return value;
  if (Array.isArray(value)) return value.slice(0, 128).map((item) => safePersistedValue(item, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 256).map(([key, item]) => [
      key,
      SECRET_FIELD_RE.test(key) ? "[REDACTED]" : safePersistedValue(item, depth + 1),
    ]));
  }
  return String(value);
}

/** Bound and redact the durable copy; raw provider credentials never enter receipts/run JSON. */
export function sanitizeToolResultForPersistence<T>(result: ToolResult<T>): ToolResult<T> {
  return safePersistedValue(result) as ToolResult<T>;
}

export function effectFingerprint(toolId: string, input: unknown): string {
  return createHash("sha256").update(`${toolId}:${stableJson(input)}`).digest("hex");
}

export function canonicalIdempotencyKey(groupId: string, runId: string, stepId: string, toolId: string, fingerprint: string): string {
  // Server-owned and versioned. Tenant + run + step + tool + canonical effect
  // fingerprint prevent a forged/colliding key from suppressing an unrelated
  // tenant's operation during retry or recovery.
  return `v6:${groupId}:${runId}:${stepId}:${toolId}:${fingerprint}`;
}

const defaultIdempotencyContract = (policy: IdempotencyPolicy): ToolIdempotencyContract => ({
  policy,
  keyStrategy: "run_step_effect_fingerprint",
  duplicateEffectPolicy: "return_verified_receipt",
  retryPolicy: "same_key_only",
  billingPolicy: "reserve_once_settle_once",
});

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition<any, any>>();
  register<I, O>(definition: ToolDefinition<I, O>): this {
    if (this.tools.has(definition.id)) throw new Error(`Duplicate tool id: ${definition.id}`);
    if (definition.access !== "READ" && definition.idempotency === "none") {
      throw new Error(`Write/external tool ${definition.id} must declare idempotency`);
    }
    const completion = definition.verificationStage ?? "VERIFIED";
    if (definition.access !== "READ" && ["ACCEPTED", "QUEUED", "RUNNING"].includes(completion)) {
      throw new Error(`Write/external tool ${definition.id} cannot complete at ${completion}`);
    }
    if (!definition.handlerIdentity.trim() || typeof definition.handler !== "function" || typeof definition.verify !== "function") {
      throw new Error(`Dangling handler contract: ${definition.id}`);
    }
    this.tools.set(definition.id, {
      ...definition,
      idempotencyContract: definition.idempotencyContract ?? defaultIdempotencyContract(definition.idempotency),
      verificationStage: completion,
      verificationMethod: definition.verificationMethod ?? "handler_read_back",
      required: definition.required ?? true,
    });
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
      required: tool.required ?? true,
      verificationStage: tool.verificationStage ?? "VERIFIED",
      verificationMethod: tool.verificationMethod ?? "handler_read_back",
      idempotencyContract: tool.idempotencyContract ?? defaultIdempotencyContract(tool.idempotency),
    }));
  }
  has(id: string): boolean { return this.tools.has(id); }
  definitions(): ToolDefinition<any, any>[] { return [...this.tools.values()]; }
  registryHash(): string {
    return createHash("sha256").update(stableJson(this.capabilities().map((item) => ({ ...item, availability: undefined })).sort((a, b) => a.id.localeCompare(b.id)))).digest("hex");
  }
  contractReport(requiredCapabilityIds: string[] = []) {
    const danglingHandlers = this.definitions().filter((tool) => !tool.handlerIdentity.trim() || typeof tool.handler !== "function" || typeof tool.verify !== "function").map((tool) => tool.id);
    const missingCapabilities = [...new Set(requiredCapabilityIds)].filter((id) => !this.tools.has(id));
    const unavailableRequired = this.definitions().filter((tool) => tool.required !== false && !tool.availability().available).map((tool) => tool.id);
    return {
      registryHash: this.registryHash(),
      declaredCount: this.tools.size,
      danglingHandlers,
      missingCapabilities,
      unavailableRequired,
      ready: danglingHandlers.length === 0 && missingCapabilities.length === 0 && unavailableRequired.length === 0,
    };
  }
}

export type DurableStepStatus = "pending" | "running" | "retrying" | "verifying" | "completed" | "failed" | "paused" | "stopped" | "blocked";
export type RuntimeUserState = "UNDERSTANDING" | "RESOLVING" | "WAITING_USER" | "WAITING_PERMISSION" | "QUEUED" | "EXECUTING" | "RETRYING" | "REPLANNING" | "VERIFYING" | "PARTIAL_SUCCESS" | "COMPLETED" | "FAILED" | "STOPPED" | "BLOCKED_EXTERNAL";
export interface DurableStep {
  id: string; toolId: string; input: unknown; dependsOn: string[]; status: DurableStepStatus;
  idempotencyKey: string; attemptCount: number; expectedEffect?: string;
  verifiedResult?: ToolResult; reservedPoints: number; actualPoints: number;
  leaseOwner?: string; leaseExpiresAt?: string; provider?: string; error?: string;
}
export interface DurableRun {
  id: string; parentRunId?: string; goalId: string; planRevision: number;
  userId?: string; groupId?: string; projectId?: string;
  status: "running" | "paused" | "stopped" | "completed" | "failed" | "blocked" | "user_controlled";
  budgetPoints: number; reservedPoints: number; actualPoints: number;
  steps: DurableStep[]; updatedAt: string; lockVersion?: number;
}
export interface RunLedger {
  load(runId: string): Promise<DurableRun | undefined>;
  save(run: DurableRun): Promise<void>;
  getEffect(runId: string, idempotencyKey: string): Promise<ToolResult | undefined>;
  saveEffect(runId: string, idempotencyKey: string, attemptId: string, result: ToolResult): Promise<boolean>;
  claimEffect(input: { runId: string; stepId: string; toolId: string; idempotencyKey: string; effectFingerprint: string; attemptId: string; reservedPoints: number; leaseExpiresAt: string; owner: { userId: string; groupId: string; projectId: string }; receipt: Omit<ExecutionReceipt, "executedAt" | "verifiedAt" | "verificationStage" | "targetRefs" | "actualPoints"> }): Promise<{ state: "acquired" | "in_progress" | "verified"; reservationCreated: boolean; result?: ToolResult }>;
  releaseEffect(runId: string, idempotencyKey: string, attemptId: string): Promise<void>;
  settleOnce(runId: string, idempotencyKey: string, points: number, owner?: { userId?: string; groupId?: string }): Promise<boolean>;
}

export function runtimeUserState(run: DurableRun): RuntimeUserState {
  if (run.status === "completed") return "COMPLETED";
  if (run.status === "failed") return "FAILED";
  if (run.status === "stopped") return "STOPPED";
  if (run.status === "blocked") return "BLOCKED_EXTERNAL";
  if (run.status === "paused") return "WAITING_USER";
  if (run.steps.some((step) => step.status === "verifying")) return "VERIFYING";
  if (run.steps.some((step) => step.status === "retrying")) return "RETRYING";
  if (run.steps.some((step) => step.status === "running")) return "EXECUTING";
  if (run.steps.some((step) => step.status === "completed") && run.steps.some((step) => step.status === "failed" || step.status === "blocked")) return "PARTIAL_SUCCESS";
  return "QUEUED";
}

export class InMemoryRunLedger implements RunLedger {
  runs = new Map<string, DurableRun>(); effects = new Map<string, ToolResult>();
  reservations = new Set<string>(); settlements = new Set<string>(); leases = new Map<string, { attemptId: string; expiresAt: number }>();
  async load(id: string) { return this.runs.get(id); }
  async save(run: DurableRun) { this.runs.set(run.id, structuredClone(run)); }
  async getEffect(runId: string, key: string) { return this.effects.get(`${runId}:${key}`); }
  async saveEffect(runId: string, key: string, attemptId: string, result: ToolResult) { if (this.leases.get(`${runId}:${key}`)?.attemptId !== attemptId || this.effects.has(`${runId}:${key}`)) return false; this.effects.set(`${runId}:${key}`, structuredClone(result)); return true; }
  async claimEffect(input: Parameters<RunLedger["claimEffect"]>[0]) {
    const scopedKey = `${input.runId}:${input.idempotencyKey}`; const found = this.effects.get(scopedKey); if (found?.verified) return { state: "verified" as const, reservationCreated: false, result: found };
    const lease = this.leases.get(scopedKey); const now = Date.now();
    if (lease && lease.expiresAt > now) return { state: "in_progress" as const, reservationCreated: false };
    const reservationKey = `${input.runId}:${input.idempotencyKey}`; const reservationCreated = !this.reservations.has(reservationKey); this.reservations.add(reservationKey);
    this.leases.set(scopedKey, { attemptId: input.attemptId, expiresAt: new Date(input.leaseExpiresAt).getTime() });
    return { state: "acquired" as const, reservationCreated };
  }
  async releaseEffect(runId: string, key: string, attemptId: string) { const scopedKey = `${runId}:${key}`; if (this.leases.get(scopedKey)?.attemptId === attemptId) this.leases.delete(scopedKey); }
  async settleOnce(runId: string, key: string, points = 0) {
    if (!Number.isFinite(points) || points < 0) return false;
    const k = `${runId}:${key}`;
    if (this.settlements.has(k)) return false;
    this.settlements.add(k);
    return true;
  }
}

export class ProviderCircuitBreaker {
  private states = new Map<string, { consecutiveFailures: number; failedSamples: number; successes: number; openUntil: number; latencies: number[]; lastFailureAt?: number; concurrency: number }>();
  constructor(private threshold = 3, private cooldownMs = 30_000, private now = () => Date.now()) {}
  available(provider: string) { return (this.states.get(provider)?.openUntil ?? 0) <= this.now(); }
  private empty() { return { consecutiveFailures: 0, failedSamples: 0, successes: 0, openUntil: 0, latencies: [] as number[], concurrency: 0 }; }
  begin(provider: string) { const old = this.states.get(provider) ?? this.empty(); this.states.set(provider, { ...old, concurrency: old.concurrency + 1 }); }
  success(provider: string, latencyMs = 0) { const old = this.states.get(provider) ?? this.empty(); this.states.set(provider, { ...old, consecutiveFailures: 0, successes: old.successes + 1, concurrency: Math.max(0, old.concurrency - 1), openUntil: 0, latencies: [...old.latencies.slice(-99), latencyMs] }); }
  failure(provider: string, latencyMs = 0) { const old = this.states.get(provider) ?? this.empty(); const consecutiveFailures = old.consecutiveFailures + 1; this.states.set(provider, { ...old, consecutiveFailures, failedSamples: old.failedSamples + 1, concurrency: Math.max(0, old.concurrency - 1), openUntil: consecutiveFailures >= this.threshold ? this.now() + this.cooldownMs : 0, lastFailureAt: this.now(), latencies: [...old.latencies.slice(-99), latencyMs] }); }
  snapshot(provider: string) { const state = this.states.get(provider); if (!state) return { sampleCount: 0, successRate: 1, timeoutRate: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0, concurrency: 0, circuit: "closed" as const, lastFailureAt: null }; const total = state.successes + state.failedSamples; const sorted = [...state.latencies].sort((a, b) => a - b); const percentile = (ratio: number) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))]! : 0; return { sampleCount: total, successRate: total ? state.successes / total : 1, timeoutRate: total ? state.failedSamples / total : 0, p50Ms: percentile(0.5), p95Ms: percentile(0.95), p99Ms: percentile(0.99), concurrency: state.concurrency, circuit: state.openUntil > this.now() ? "open" as const : "closed" as const, lastFailureAt: state.lastFailureAt ? new Date(state.lastFailureAt).toISOString() : null }; }
}

export interface RouteCandidate { id: string; quality: number; estimatedPoints: number; provider: string; paid: boolean; capabilities?: string[]; }
/** Highest-quality healthy route that fits the hard cap; never introduces a forbidden paid fallback. */
export function chooseCostAwareRoute(candidates: RouteCandidate[], remainingPoints: number, circuits: ProviderCircuitBreaker, allowPaid = true, requiredCapability?: string): RouteCandidate | undefined {
  const score = (item: RouteCandidate) => {
    const health = circuits.snapshot(item.provider);
    const reliability = Math.max(0.1, health.successRate * (1 - health.timeoutRate));
    const latencyPenalty = Math.min(0.35, health.p95Ms / 60_000);
    const loadPenalty = Math.min(0.25, health.concurrency * 0.025);
    const costPenalty = remainingPoints > 0 ? Math.min(0.2, item.estimatedPoints / remainingPoints * 0.2) : 1;
    return item.quality * reliability - latencyPenalty - loadPenalty - costPenalty;
  };
  return candidates
    .filter((item) => item.estimatedPoints <= remainingPoints && (allowPaid || !item.paid) && circuits.available(item.provider) && (!requiredCapability || item.capabilities?.includes(requiredCapability)))
    .sort((a, b) => score(b) - score(a) || a.estimatedPoints - b.estimatedPoints)[0];
}

export class BudgetExceededError extends Error { code = "BUDGET_EXCEEDED" as const; }
export class ConfirmationRequiredError extends Error { code = "CONFIRMATION_REQUIRED" as const; }
export class EffectInProgressError extends Error { code = "EFFECT_IN_PROGRESS" as const; }
export class ChildAuthorityError extends Error { code = "CHILD_AUTHORITY_DENIED" as const; }
export class AgentRecursionError extends Error { code = "AGENT_RECURSION_BLOCKED" as const; }

export class RunControllerRegistry {
  private controllers = new Map<string, { attemptId: string; controller: AbortController }>();
  register(runId: string, attemptId: string, controller: AbortController) { this.controllers.get(runId)?.controller.abort(); this.controllers.set(runId, { attemptId, controller }); }
  isCurrent(runId: string, attemptId: string) { return this.controllers.get(runId)?.attemptId === attemptId; }
  finish(runId: string, attemptId: string) { if (this.isCurrent(runId, attemptId)) this.controllers.delete(runId); }
  abortRun(runId: string) { const current = this.controllers.get(runId); current?.controller.abort(); if (current) this.controllers.delete(runId); }
}

function assertChildAuthority(tool: ToolDefinition, actor: { groupId: string; projectId: string; authority?: ChildAuthority }, run: DurableRun, estimate: number) {
  const authority = actor.authority; if (!authority) return;
  if (Date.parse(authority.expiresAt) <= Date.now() || authority.depth > authority.maxDepth) throw new ChildAuthorityError("Child authority expired or depth exceeded");
  if (authority.parentRunId !== run.parentRunId || authority.groupId !== actor.groupId || !authority.projectIds.includes(actor.projectId)) throw new ChildAuthorityError("Child scope mismatch");
  if (!authority.allowedCapabilities.includes(tool.id) || run.steps.length > authority.maxSteps || run.actualPoints + run.reservedPoints + estimate > authority.maxPoints) throw new ChildAuthorityError("Child capability, step, or cost scope exceeded");
}

export class PracticalAutonomyRuntime {
  constructor(readonly registry: ToolRegistry, readonly ledger: RunLedger, readonly circuits = new ProviderCircuitBreaker(), readonly controllers = new RunControllerRegistry()) {}
  async executeStep(runId: string, stepId: string, actor: Omit<ToolContext, "runId" | "stepId" | "idempotencyKey" | "effectFingerprint" | "toolCallId" | "attemptId" | "signal" | "inputTrust"> & { confirmed?: boolean; signal?: AbortSignal; inputTrust?: TrustLabel }): Promise<ToolResult> {
    const run = await this.ledger.load(runId); if (!run) throw new Error("Run not found");
    if ((run.userId && run.userId !== actor.userId) || (run.groupId && run.groupId !== actor.groupId) || (run.projectId && run.projectId !== actor.projectId)) throw new ChildAuthorityError("RUN_OWNER_SCOPE_MISMATCH");
    if (run.status === "paused") throw new Error("RUN_PAUSED");
    if (run.status === "stopped") throw new Error("RUN_STOPPED");
    const step = run.steps.find((item) => item.id === stepId); if (!step) throw new Error("Step not found");
    if (step.status === "completed" && step.verifiedResult?.verified) return step.verifiedResult;
    const tool = this.registry.get(step.toolId); const input = tool.input.parse(step.input);
    const agentDepth = actor.agentDepth ?? 0; const maxAgentDepth = actor.maxAgentDepth ?? 4; const visitedCapabilities = actor.visitedCapabilities ?? [];
    if (agentDepth > maxAgentDepth || visitedCapabilities.includes(tool.id)) throw new AgentRecursionError(`Recursive capability invocation blocked: ${tool.id}`);
    const fingerprint = effectFingerprint(tool.id, input); const key = canonicalIdempotencyKey(actor.groupId, run.id, step.id, tool.id, fingerprint); step.idempotencyKey = key;
    const prior = await this.ledger.getEffect(run.id, key);
    if (prior?.verified) { if (await this.ledger.settleOnce(run.id, step.idempotencyKey, prior.actualPoints, { userId: actor.userId, groupId: actor.groupId })) { run.reservedPoints = Math.max(0, run.reservedPoints - step.reservedPoints); run.actualPoints += prior.actualPoints; } step.actualPoints = prior.actualPoints; step.status = "completed"; step.verifiedResult = prior; await this.ledger.save(run); return prior; }
    const availability = tool.availability(); if (!availability.available) { step.status = "blocked"; step.error = availability.reason ?? "BLOCKED_BY_EXTERNAL_DEPENDENCY"; await this.ledger.save(run); throw new Error(step.error); }
    if ((tool.confirmation === "always" || tool.confirmation === "high_risk" || (tool.confirmation === "paid" && tool.cost.paid)) && !actor.confirmed) throw new ConfirmationRequiredError(`Confirmation required for ${tool.id}`);
    const estimate = Math.max(0, tool.cost.estimatePoints(input));
    assertChildAuthority(tool, actor, run, estimate);
    if (run.actualPoints + run.reservedPoints + (step.reservedPoints > 0 ? 0 : estimate) > run.budgetPoints) throw new BudgetExceededError(`Tool ${tool.id} would exceed ${run.budgetPoints} points`);
    const attemptId = randomUUID(); const toolCallId = randomUUID(); const requestedAt = new Date().toISOString();
    const claim = await this.ledger.claimEffect({ runId, stepId, toolId: tool.id, idempotencyKey: key, effectFingerprint: fingerprint, attemptId, reservedPoints: estimate, leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(), owner: { userId: actor.userId, groupId: actor.groupId, projectId: actor.projectId }, receipt: { goalId: run.goalId, runId, stepId, toolCallId, attemptId, capabilityId: tool.id, handlerIdentity: tool.handlerIdentity, effectFingerprint: fingerprint, idempotencyKey: key, requestedAt, verificationMethod: tool.verificationMethod ?? "handler_read_back", ...(actor.traceId ? { traceId: actor.traceId } : {}), ...(actor.conversationId ? { conversationId: actor.conversationId } : {}), trustOrigin: actor.inputTrust ?? "USER_EXPLICIT" } });
    if (claim.state === "verified" && claim.result) return claim.result;
    if (claim.state === "in_progress") { step.status = "retrying"; step.error = "EFFECT_IN_PROGRESS"; await this.ledger.save(run); throw new EffectInProgressError("The same effect is already executing"); }
    if (claim.reservationCreated) { run.reservedPoints += estimate; step.reservedPoints = estimate; }
    const controller = new AbortController(); actor.signal?.addEventListener("abort", () => controller.abort(), { once: true }); this.controllers.register(runId, attemptId, controller);
    const context: ToolContext = { ...actor, runId, stepId, idempotencyKey: key, effectFingerprint: fingerprint, toolCallId, attemptId, agentDepth, maxAgentDepth, visitedCapabilities: [...visitedCapabilities, tool.id], inputTrust: actor.inputTrust ?? "USER_EXPLICIT", signal: controller.signal };
    let lastError: unknown;
    for (let attempt = step.attemptCount + 1; attempt <= tool.retry.maxAttempts; attempt++) {
      if ((await this.ledger.load(runId))?.status === "stopped") throw new Error("RUN_STOPPED");
      step.attemptCount = attempt; step.status = attempt === 1 ? "running" : "retrying"; await this.ledger.save(run);
      try {
        const startedAt = Date.now(); if (availability.provider) this.circuits.begin(availability.provider); const result = await tool.handler(input, context); tool.output.parse(result.value); step.status = "verifying"; await this.ledger.save(run);
        const verified = result.verified && await tool.verify(result, context);
        if (!verified || ((tool.access === "WRITE" || tool.access === "EXTERNAL") && result.evidence.length === 0)) throw new Error("UNVERIFIED_EFFECT");
        const current = await this.ledger.load(runId); if (!this.controllers.isCurrent(runId, attemptId) || controller.signal.aborted || current?.status === "stopped") throw new Error("STALE_OR_STOPPED_ATTEMPT");
        const verifiedAt = new Date().toISOString();
        const final = sanitizeToolResultForPersistence({ ...result, verified: true, receipt: { goalId: run.goalId, runId, stepId, toolCallId, attemptId, capabilityId: tool.id, handlerIdentity: tool.handlerIdentity, effectFingerprint: fingerprint, idempotencyKey: key, requestedAt, executedAt: new Date(startedAt).toISOString(), verifiedAt, verificationStage: (tool.verificationStage ?? "VERIFIED") as ExecutionReceipt["verificationStage"], verificationMethod: tool.verificationMethod ?? "handler_read_back", targetRefs: result.evidence.map((item) => item.ref), ...(actor.traceId ? { traceId: actor.traceId } : {}), ...(actor.conversationId ? { conversationId: actor.conversationId } : {}), actualPoints: result.actualPoints, trustOrigin: actor.inputTrust ?? "USER_EXPLICIT" } satisfies ExecutionReceipt });
        if (!await this.ledger.saveEffect(run.id, key, attemptId, final)) throw new Error("STALE_EFFECT_LEASE");
        if (await this.ledger.settleOnce(run.id, step.idempotencyKey, final.actualPoints, { userId: actor.userId, groupId: actor.groupId })) { run.reservedPoints -= step.reservedPoints; run.actualPoints += final.actualPoints; }
        step.actualPoints = final.actualPoints; step.verifiedResult = final; step.status = "completed"; if (availability.provider) this.circuits.success(availability.provider, Date.now() - startedAt); await this.ledger.save(run); this.controllers.finish(runId, attemptId); return final;
      } catch (error) { lastError = error; const disposition = classifyExecutionError(error); step.error = disposition === "reconcile" ? "EFFECT_OUTCOME_REQUIRES_RECONCILIATION" : error instanceof Error ? error.message : String(error); if (availability.provider) this.circuits.failure(availability.provider); if (tool.idempotency === "none" || controller.signal.aborted || !isRetrySafeExecutionError(error)) break; if (attempt < tool.retry.maxAttempts && tool.retry.baseDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, tool.retry.baseDelayMs * 2 ** (attempt - 1))); }
    }
    const latest = await this.ledger.load(runId);
    if (latest?.status === "stopped" || latest?.status === "paused") run.status = latest.status;
    step.status = run.status === "paused" ? "paused" : controller.signal.aborted || run.status === "stopped" ? "stopped" : "failed";
    await this.ledger.releaseEffect(run.id, key, attemptId); this.controllers.finish(runId, attemptId); await this.ledger.save(run); throw lastError;
  }
  async transition(runId: string, action: "pause" | "resume" | "stop") {
    const run = await this.ledger.load(runId); if (!run) throw new Error("Run not found");
    if (action === "stop") { if (["completed", "failed", "stopped"].includes(run.status)) throw new Error("TERMINAL_RUN"); this.controllers.abortRun(runId); run.status = "stopped"; for (const step of run.steps) if (["pending", "running", "retrying", "verifying", "paused", "blocked"].includes(step.status)) step.status = "stopped"; }
    if (action === "pause") { if (run.status !== "running") throw new Error("INVALID_TRANSITION"); this.controllers.abortRun(runId); run.status = "paused"; for (const step of run.steps) if (["pending", "running", "retrying", "verifying"].includes(step.status)) step.status = "paused"; }
    if (action === "resume") { if (run.status !== "paused") throw new Error("INVALID_TRANSITION"); run.status = "running"; for (const step of run.steps) if (step.status === "paused") step.status = "pending"; }
    run.updatedAt = new Date().toISOString(); await this.ledger.save(run); return run;
  }
}

export interface AgentSkill { id: string; name: string; version: number; inputs: z.ZodTypeAny; requiredCapabilities: string[]; steps: Array<{ id: string; toolId: string; dependsOn: string[] }>; maxConcurrency: number; resumable: true; }
export const AGENT_SKILLS: AgentSkill[] = [
  { id: "project_health_scan", name: "Project health scan", version: 1, inputs: z.object({ projectId: z.string().uuid() }), requiredCapabilities: ["project.health", "project.files.list"], steps: [{ id: "health", toolId: "project.health", dependsOn: [] }, { id: "files", toolId: "project.files.list", dependsOn: [] }], maxConcurrency: 2, resumable: true },
  { id: "storyboard_asset_prep", name: "Storyboard asset prep", version: 1, inputs: z.object({ projectId: z.string().uuid() }), requiredCapabilities: ["project.health"], steps: [{ id: "health", toolId: "project.health", dependsOn: [] }], maxConcurrency: 1, resumable: true },
  { id: "creator_delivery_check", name: "Creator delivery check", version: 1, inputs: z.object({ projectId: z.string().uuid() }), requiredCapabilities: ["project.health"], steps: [{ id: "verify", toolId: "project.health", dependsOn: [] }], maxConcurrency: 1, resumable: true },
  { id: "organize_recent_assets", name: "Organize recent assets", version: 1, inputs: z.object({ projectId: z.string().uuid() }), requiredCapabilities: ["project.files.list"], steps: [{ id: "list", toolId: "project.files.list", dependsOn: [] }], maxConcurrency: 1, resumable: true },
  { id: "research_to_project_notes", name: "Research to project notes", version: 1, inputs: z.object({ projectId: z.string().uuid(), query: z.string() }), requiredCapabilities: ["project.files.search"], steps: [{ id: "search", toolId: "project.files.search", dependsOn: [] }], maxConcurrency: 1, resumable: true },
];

/** A skill is publishable only when every referenced runtime handler exists. */
export function validateSkillContracts(registry: ToolRegistry, skills: AgentSkill[] = AGENT_SKILLS) {
  return skills.flatMap((skill) => skill.requiredCapabilities.filter((capabilityId) => !registry.has(capabilityId)).map((capabilityId) => ({ skillId: skill.id, capabilityId })));
}

export function createChildAuthority(input: Omit<ChildAuthority, "depth"> & { parent?: ChildAuthority }): ChildAuthority {
  const depth = (input.parent?.depth ?? 0) + 1;
  const parent = input.parent;
  if (parent) {
    if (depth > parent.maxDepth || input.maxDepth > parent.maxDepth || input.maxPoints > parent.maxPoints || input.maxSteps > parent.maxSteps) throw new ChildAuthorityError("Child envelope exceeds parent authority");
    if (input.groupId !== parent.groupId || input.projectIds.some((id) => !parent.projectIds.includes(id)) || input.allowedCapabilities.some((id) => !parent.allowedCapabilities.includes(id))) throw new ChildAuthorityError("Child scope exceeds parent authority");
  }
  const { parent: _parent, ...rest } = input;
  return { ...rest, depth };
}

export async function boundedDelegate<T, R>(items: T[], worker: (item: T, signal: AbortSignal) => Promise<R>, options: { concurrency: number; maxConcurrency?: number; signal?: AbortSignal }): Promise<R[]> {
  const limit = Math.max(1, Math.min(options.concurrency, options.maxConcurrency ?? 4)); const out = new Array<R>(items.length); let cursor = 0;
  const controller = new AbortController(); options.signal?.addEventListener("abort", () => controller.abort(), { once: true });
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { while (true) { if (controller.signal.aborted) throw new Error("DELEGATION_CANCELLED"); const index = cursor++; if (index >= items.length) return; out[index] = await worker(items[index]!, controller.signal); } }));
  return out;
}
