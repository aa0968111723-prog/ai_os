import { randomUUID } from "node:crypto";
import { agentToolRegistry } from "./agentToolRegistry";
import { CUTOS_LONG_RUNNING_TOOLS, CutosToolError } from "./cutosToolRegistry";
import { deriveCutosIdempotencyKey } from "./cutosClient";
import { effectFingerprint, type ToolContext, type ToolDefinition, type ToolResult } from "./practicalAutonomy";
import { resolveCutosProject } from "./cutosProjectBinding";
import type { ApprovalRequest } from "../../shared/cutosProtocol";

/**
 * Execution of a governed CUTOS tool step for the existing agent runner.
 *
 * This is NOT a second runner. The DAG, persistence, retry, approval,
 * background ticking and zombie recovery all remain `agentRunner`'s; the tool
 * definition, its input schema, risk class, confirmation policy, idempotency
 * contract, verification and evidence all remain `agentToolRegistry`'s. What
 * lives here is the glue that lets one `tool_call` step use both, plus the two
 * rules that only make sense for an external editing plane:
 *
 *  - the step may only name a `cutos.*` tool (a plan cannot reach an arbitrary
 *    registry entry, let alone an arbitrary function), and
 *  - a tool whose confirmation policy is `always` must be preceded in the DAG
 *    by a completed approval step. Approval is the AIOS control plane's job,
 *    so the check is on AIOS's own graph rather than a second CUTOS gate.
 */

export interface CutosToolStepInput {
  runId: string;
  stepId: string;
  userId: string;
  groupId: string;
  projectId: string;
  toolId: string;
  toolInput: Record<string, unknown>;
  /** Ids of DAG steps this one depends on, with their statuses. */
  dependencies: Array<{ id: string; kind: string; status: string }>;
  signal?: AbortSignal;
  traceId?: string;
  conversationId?: string;
}

export type CutosToolStepOutcome =
  | { state: "completed"; value: unknown; evidence: ToolResult["evidence"]; timelineRevision: number | null }
  | { state: "waiting_external"; jobId: string; value: unknown }
  | { state: "waiting_approval"; approvalRequest?: ApprovalRequest; reason: string }
  | { state: "failed"; code: string; reason: string; retryable: boolean };

export class CutosStepError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "CutosStepError";
  }
}

const RETRYABLE_CODES = new Set([
  "IDEMPOTENCY_IN_PROGRESS",
  "TIMEOUT",
  "UNAVAILABLE",
  "INTERNAL",
]);

/** Only governed CUTOS capabilities are reachable from a plan step. */
export function isCutosToolId(toolId: string): boolean {
  return toolId.startsWith("cutos.") && agentToolRegistry.has(toolId);
}

/**
 * A high-risk CUTOS mutation must be preceded by a completed approval step.
 * This reads the plan's own DAG, so it cannot be satisfied by a step that was
 * skipped, cancelled, or is still waiting on a human.
 */
export function approvalSatisfied(
  tool: ToolDefinition<unknown, unknown>,
  dependencies: CutosToolStepInput["dependencies"],
): { ok: true } | { ok: false; reason: string } {
  if (tool.confirmation !== "always" && tool.confirmation !== "high_risk") return { ok: true };
  const approvals = dependencies.filter(
    (dependency) => dependency.kind === "request_approval" || dependency.kind === "wait_for_human",
  );
  if (approvals.length === 0) {
    return {
      ok: false,
      reason: `${tool.id} 需要人工核准，但計畫沒有前置的核准步驟`,
    };
  }
  if (!approvals.every((approval) => approval.status === "done")) {
    return { ok: false, reason: `${tool.id} 正在等待人工核准` };
  }
  return { ok: true };
}

/**
 * Execute one CUTOS tool step.
 *
 * Long-running capabilities return `waiting_external` with the CUTOS jobId; the
 * runner parks the step and polls, instead of holding an HTTP request open
 * across an FFmpeg render.
 */
export async function executeCutosToolStep(
  input: CutosToolStepInput,
): Promise<CutosToolStepOutcome> {
  if (!isCutosToolId(input.toolId)) {
    return {
      state: "failed",
      code: "UNKNOWN_TOOL",
      reason: `步驟指定的工具「${input.toolId}」不是已註冊的 CUTOS 能力`,
      retryable: false,
    };
  }

  const tool = agentToolRegistry.get(input.toolId);

  const availability = tool.availability();
  if (!availability.available) {
    return {
      state: "failed",
      code: availability.reason ?? "UNAVAILABLE",
      reason: "尚未設定 CUTOS 連線",
      // Configuration is an operator action, so a retry loop would spin.
      retryable: false,
    };
  }

  const approval = approvalSatisfied(tool, input.dependencies);
  if (!approval.ok) {
    return { state: "waiting_approval", reason: approval.reason };
  }

  const parsed = tool.input.safeParse(input.toolInput ?? {});
  if (!parsed.success) {
    return {
      state: "failed",
      code: "VALIDATION_FAILED",
      reason: parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`)
        .join("; "),
      retryable: false,
    };
  }

  // Resolve the bound CUTOS project up front so the idempotency key is stable
  // across retries and across a process restart.
  let cutosProjectId: string;
  try {
    const binding = await resolveCutosProject({
      userId: input.userId,
      groupId: input.groupId,
      projectId: input.projectId,
    });
    cutosProjectId = binding.cutosProjectId;
  } catch (error) {
    return {
      state: "failed",
      code: "BINDING_NOT_FOUND",
      reason: error instanceof Error ? error.message : "找不到對應的 CUTOS 專案",
      retryable: false,
    };
  }

  const fingerprint = effectFingerprint(tool.id, parsed.data);
  const idempotencyKey = deriveCutosIdempotencyKey({
    runId: input.runId,
    stepId: input.stepId,
    capability: tool.id,
    cutosProjectId,
    args: parsed.data,
  });

  const context: ToolContext = {
    runId: input.runId,
    stepId: input.stepId,
    userId: input.userId,
    groupId: input.groupId,
    projectId: input.projectId,
    idempotencyKey,
    effectFingerprint: fingerprint,
    toolCallId: randomUUID(),
    attemptId: randomUUID(),
    ...(input.traceId ? { traceId: input.traceId } : {}),
    ...(input.conversationId ? { conversationId: input.conversationId } : {}),
    // CUTOS output is a governed peer service's data, never a user instruction.
    inputTrust: "EXTERNAL_UNTRUSTED",
    signal: input.signal ?? new AbortController().signal,
  };

  try {
    const result = await tool.handler(parsed.data, context);
    tool.output.parse(result.value);

    const verified = result.verified && (await tool.verify(result, context));
    if (!verified || (tool.access !== "READ" && result.evidence.length === 0)) {
      return {
        state: "failed",
        code: "UNVERIFIED_EFFECT",
        reason: `${tool.id} 的結果未通過驗證`,
        retryable: false,
      };
    }

    const value = result.value as Record<string, unknown> | null;
    const jobId = typeof value?.jobId === "string" ? value.jobId : undefined;
    if (jobId && CUTOS_LONG_RUNNING_TOOLS.has(tool.id)) {
      return { state: "waiting_external", jobId, value: result.value };
    }

    const timelineRevision =
      typeof value?.timelineRevision === "number" ? value.timelineRevision : null;
    return { state: "completed", value: result.value, evidence: result.evidence, timelineRevision };
  } catch (error) {
    if (error instanceof CutosToolError) {
      if (error.code === "APPROVAL_REQUIRED") {
        return {
          state: "waiting_approval",
          ...(error.approvalRequest ? { approvalRequest: error.approvalRequest } : {}),
          reason: "CUTOS 判定這項修改需要人工確認",
        };
      }
      return {
        state: "failed",
        code: error.code,
        reason: humanReason(error.code, error.message),
        retryable: RETRYABLE_CODES.has(error.code),
      };
    }
    return {
      state: "failed",
      code: "INTERNAL",
      reason: error instanceof Error ? error.message : String(error),
      retryable: true,
    };
  }
}

/** zh-TW operator-facing reason. The raw message stays in logs. */
function humanReason(code: string, fallback: string): string {
  switch (code) {
    case "STALE_TIMELINE_REVISION":
      return "時間軸已被更動，這份剪輯計畫需要重新產生";
    case "ANALYSIS_REQUIRED":
      return "這支影片還沒完成分析，請先執行影片分析";
    case "NO_PENDING_PLAN":
      return "沒有待審核的剪輯計畫可以套用";
    case "EMPTY_TIMELINE":
      return "時間軸是空的，沒有東西可以輸出";
    case "UNSUPPORTED_OPERATION":
      return "剪輯計畫包含目前還不支援的操作";
    case "BINDING_NOT_FOUND":
      return "這個專案還沒連結 CUTOS 影片專案";
    case "UNAVAILABLE":
      return "目前無法連線到 CUTOS";
    case "TIMEOUT":
      return "CUTOS 回應逾時";
    default:
      return fallback;
  }
}

export interface CutosJobPoll {
  state: "running" | "completed" | "failed" | "cancelled";
  status: string;
  progress: number;
  stage: string | null;
  reason?: string;
}

/**
 * Poll a parked CUTOS job. Called from the runner's tick, exactly like the
 * generation settle pass — the runner never blocks on FFmpeg.
 */
export async function pollCutosJob(input: {
  runId: string;
  stepId: string;
  userId: string;
  groupId: string;
  projectId: string;
  jobId: string;
  signal?: AbortSignal;
}): Promise<CutosJobPoll> {
  const tool = agentToolRegistry.get("cutos.job.get");
  const context: ToolContext = {
    runId: input.runId,
    stepId: input.stepId,
    userId: input.userId,
    groupId: input.groupId,
    projectId: input.projectId,
    idempotencyKey: `poll:${input.jobId}`,
    effectFingerprint: effectFingerprint("cutos.job.get", { jobId: input.jobId }),
    toolCallId: randomUUID(),
    attemptId: randomUUID(),
    inputTrust: "EXTERNAL_UNTRUSTED",
    signal: input.signal ?? new AbortController().signal,
  };

  try {
    const result = await tool.handler({ jobId: input.jobId }, context);
    const job = result.value as {
      status: string;
      progress?: number;
      stage?: string | null;
      error?: string | null;
    };
    if (job.status === "succeeded") {
      return { state: "completed", status: job.status, progress: 1, stage: job.stage ?? null };
    }
    if (job.status === "failed") {
      return {
        state: "failed",
        status: job.status,
        progress: job.progress ?? 0,
        stage: job.stage ?? null,
        reason: job.error ?? "CUTOS 背景工作失敗",
      };
    }
    if (job.status === "cancelled") {
      return {
        state: "cancelled",
        status: job.status,
        progress: job.progress ?? 0,
        stage: job.stage ?? null,
        reason: "CUTOS 背景工作已取消",
      };
    }
    return {
      state: "running",
      status: job.status,
      progress: job.progress ?? 0,
      stage: job.stage ?? null,
    };
  } catch (error) {
    if (error instanceof CutosToolError && error.code === "JOB_NOT_FOUND") {
      return { state: "failed", status: "missing", progress: 0, stage: null, reason: "CUTOS 找不到這個背景工作" };
    }
    // A transport blip must not fail the run: stay parked and poll again.
    return { state: "running", status: "unknown", progress: 0, stage: null };
  }
}

/** Ask CUTOS to stop a parked job when the AIOS run is stopped. */
export async function cancelCutosJob(input: {
  runId: string;
  stepId: string;
  userId: string;
  groupId: string;
  projectId: string;
  jobId: string;
}): Promise<void> {
  const tool = agentToolRegistry.get("cutos.job.cancel");
  const context: ToolContext = {
    runId: input.runId,
    stepId: input.stepId,
    userId: input.userId,
    groupId: input.groupId,
    projectId: input.projectId,
    idempotencyKey: `cancel:${input.jobId}`,
    effectFingerprint: effectFingerprint("cutos.job.cancel", { jobId: input.jobId }),
    toolCallId: randomUUID(),
    attemptId: randomUUID(),
    inputTrust: "EXTERNAL_UNTRUSTED",
    signal: new AbortController().signal,
  };
  await tool.handler({ jobId: input.jobId }, context).catch(() => undefined);
}
