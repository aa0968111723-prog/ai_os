/**
 * ExecutionReceipt — the only completion truth for side-effecting agent work.
 *
 * LLM text, SSE transport success, and mutation ACK alone never prove completion.
 * A write path is complete only when effect + receipt + verification agree.
 */
import { z } from "zod";

export const EXECUTION_VERIFICATION_METHODS = [
  "read_back",
  "job_registered",
  "external_confirmation",
  "provider_status",
  "none",
] as const;
export type ExecutionVerificationMethod = (typeof EXECUTION_VERIFICATION_METHODS)[number];

export const EXECUTION_VERIFICATION_STATUSES = [
  "pending",
  "verified",
  "unverified",
  "failed",
  "skipped",
] as const;
export type ExecutionVerificationStatus = (typeof EXECUTION_VERIFICATION_STATUSES)[number];

export const executionReceiptSchema = z.object({
  runId: z.string().min(1).max(80),
  stepId: z.string().min(1).max(120).optional(),
  toolCallId: z.string().min(1).max(120).optional(),
  capabilityId: z.string().min(1).max(120).optional(),
  handler: z.string().min(1).max(200).optional(),
  targetType: z.string().min(1).max(80).optional(),
  targetIds: z.array(z.string().min(1).max(200)).max(100).default([]),
  idempotencyKey: z.string().min(1).max(300).optional(),
  requestedAt: z.string().datetime().optional(),
  executedAt: z.string().datetime().optional(),
  verifiedAt: z.string().datetime().optional(),
  providerJobId: z.string().min(1).max(300).optional(),
  databaseRecordIds: z.array(z.string().min(1).max(200)).max(100).default([]),
  verificationMethod: z.enum(EXECUTION_VERIFICATION_METHODS).default("none"),
  verificationStatus: z.enum(EXECUTION_VERIFICATION_STATUSES).default("pending"),
  verificationMessage: z.string().max(500).optional(),
  reservedCost: z.number().int().nonnegative().optional(),
  actualCost: z.number().int().nonnegative().optional(),
});
export type ExecutionReceipt = z.infer<typeof executionReceiptSchema>;

export type ExecutionTerminalStatus = "waiting" | "failed" | "completed";

/**
 * Terminal status for a run that may include pending user confirmation and
 * already-executed write results. Waiting and unverified never become completed.
 */
export function executionTerminalStatus(
  pendingCount: number,
  results: readonly { verification: { status: string } }[],
): ExecutionTerminalStatus {
  if (pendingCount > 0) return "waiting";
  if (results.some((result) => result.verification.status !== "verified")) return "failed";
  return "completed";
}

/** Only verified receipts may justify "Aios 已完成" for write paths. */
export function receiptAllowsCompletion(
  receipts: readonly ExecutionReceipt[],
  opts?: { requireAtLeastOne?: boolean },
): boolean {
  // Empty receipt list is allowed only for pure answers (no write side-effects).
  // Callers that require a write must pass requireAtLeastOne: true.
  if (!receipts.length) return opts?.requireAtLeastOne !== true;
  return receipts.every((receipt) => receipt.verificationStatus === "verified");
}

export function buildExecutionReceipt(
  input: Partial<ExecutionReceipt> & Pick<ExecutionReceipt, "runId">,
): ExecutionReceipt {
  return executionReceiptSchema.parse({
    targetIds: [],
    databaseRecordIds: [],
    verificationMethod: "none",
    verificationStatus: "pending",
    ...input,
  });
}
