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
