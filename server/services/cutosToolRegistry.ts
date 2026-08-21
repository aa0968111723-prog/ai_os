import { z } from "zod";
import { randomUUID } from "node:crypto";
import type {
  ToolContext,
  ToolDefinition,
  ToolEvidence,
  ToolResult,
} from "./practicalAutonomy";
import {
  CutosClient,
  CutosClientError,
  createConfiguredCutosClient,
  deriveCutosIdempotencyKey,
  isCutosConfigured,
} from "./cutosClient";
import {
  CutosBindingError,
  rememberTimelineRevision,
  resolveCutosProject,
  type CutosBinding,
} from "./cutosProjectBinding";
import {
  attachJob,
  completeEffect,
  failEffect,
  markInFlight,
  prepareEffect,
  reconcileEffect,
} from "./cutosEffectLedger";
import { ingestCutosActivity } from "./cutosActivity";
import type { AgentActivityEvent, ApprovalRequest } from "../../shared/cutosProtocol";

/**
 * CUTOS capabilities, normalized into the EXISTING AIOS tool registry.
 *
 * There is no second tool system and no `cutos.invoke(name, args)` escape
 * hatch: each capability is registered as its own governed `ToolDefinition`, so
 * it inherits everything the registry already enforces — access class, risk,
 * confirmation policy, idempotency contract, retry policy, verification,
 * evidence, required context, availability and handler identity.
 *
 * Two rules are specific to CUTOS and enforced in every handler:
 *
 *  1. The CUTOS project is resolved from the run's own scope via the durable
 *     binding. No tool takes a `cutosProjectId` input, so no model output can
 *     select which video is edited.
 *  2. Writes persist their intent (`cutosEffectLedger`) before the HTTP call,
 *     and a recovered effect is reconciled against CUTOS rather than replayed
 *     blindly.
 */

const READ_RETRY = { maxAttempts: 3, baseDelayMs: 250, allowProviderFallback: false };
/**
 * Writes retry too, but only ever with the SAME idempotency key: CUTOS replays
 * a completed effect, so a retry cannot double-apply.
 */
const WRITE_RETRY = { maxAttempts: 2, baseDelayMs: 500, allowProviderFallback: false };

const availability = () =>
  isCutosConfigured()
    ? { available: true, provider: "cutos" }
    : { available: false, reason: "CUTOS_NOT_CONFIGURED", provider: "cutos" };

/** A CUTOS error the agent runtime can classify without leaking internals. */
export class CutosToolError extends Error {
  constructor(readonly code: string, message: string, readonly approvalRequest?: ApprovalRequest) {
    super(message);
    this.name = "CutosToolError";
  }
}

function client(): CutosClient {
  const resolved = createConfiguredCutosClient();
  if (!resolved) throw new CutosToolError("UNAVAILABLE", "CUTOS is not configured");
  return resolved;
}

/**
 * Resolve the bound CUTOS project for this run. Any binding/ACL problem becomes
 * a typed tool error rather than an unhandled throw.
 */
async function bindingFor(context: ToolContext): Promise<CutosBinding> {
  try {
    return await resolveCutosProject({
      userId: context.userId,
      groupId: context.groupId,
      projectId: context.projectId,
    });
  } catch (error) {
    if (error instanceof CutosBindingError) {
      throw new CutosToolError(error.code, error.message);
    }
    throw error;
  }
}

function correlationFor(context: ToolContext, binding: CutosBinding, requestId: string) {
  return {
    requestId,
    aiosRunId: context.runId,
    aiosStepId: context.stepId,
    aiosProjectId: context.projectId,
    cutosProjectId: binding.cutosProjectId,
    ...(context.traceId ? { traceId: context.traceId } : {}),
  };
}

function evidenceFor(
  binding: CutosBinding,
  capability: string,
  ref: string,
  extra: Partial<ToolEvidence> = {},
): ToolEvidence[] {
  return [{
    type: extra.type ?? "citation",
    ref,
    verifiedAt: new Date().toISOString(),
    // CUTOS is a governed peer service, not the user and not the model: its
    // output is verified-external, never treated as an instruction.
    trust: "EXTERNAL_UNTRUSTED",
    provenance: `cutos:${capability}:${binding.cutosProjectId}`,
    ...extra,
  }];
}

/** Mirror the activity CUTOS reported so the AIOS UI can render it in zh-TW. */
async function mirrorActivity(
  context: ToolContext,
  binding: CutosBinding,
  events: AgentActivityEvent[],
): Promise<void> {
  if (events.length === 0) return;
  await ingestCutosActivity({
    runId: context.runId,
    stepId: context.stepId,
    groupId: context.groupId,
    projectId: context.projectId,
    cutosProjectId: binding.cutosProjectId,
    events,
  });
}

// ---------------------------------------------------------------------------
// Read tools
// ---------------------------------------------------------------------------

interface ReadToolSpec {
  id: string;
  label: string;
  capability: string;
  input: z.ZodType<Record<string, unknown>>;
  /** Build the CUTOS args from the validated tool input + the resolved binding. */
  args: (input: Record<string, unknown>, binding: CutosBinding) => Record<string, unknown>;
  /** Reference recorded as evidence. */
  ref: (binding: CutosBinding, input: Record<string, unknown>) => string;
  timeoutMs?: number;
}

function readTool(spec: ReadToolSpec): ToolDefinition<Record<string, unknown>, unknown> {
  return {
    id: spec.id,
    label: spec.label,
    category: "creator",
    access: "READ",
    input: spec.input,
    output: z.unknown(),
    requiredContext: ["userId", "groupId", "projectId"],
    risk: "low",
    confirmation: "never",
    idempotency: "keyed",
    cost: { paid: false, estimatePoints: () => 0 },
    retry: READ_RETRY,
    verify: (result: ToolResult) => result.verified,
    verificationStage: "VERIFIED",
    verificationMethod: "cutos_capability_read_back",
    evidenceScope: "project",
    availability,
    handlerIdentity: `cutosClient.invokeRead:${spec.capability}`,
    // CUTOS is an optional external plane. A deployment without CUTOS_URL is a
    // valid deployment, so an unconfigured CUTOS must not make the whole agent
    // capability contract report "not ready".
    required: false,
    handler: async (input, context) => {
      const binding = await bindingFor(context);
      const requestId = randomUUID();
      let outcome;
      try {
        outcome = await client().invokeRead(
          spec.capability,
          spec.args(input, binding),
          {
            correlation: correlationFor(context, binding, requestId),
            signal: context.signal,
            ...(spec.timeoutMs === undefined ? {} : { timeoutMs: spec.timeoutMs }),
          },
        );
      } catch (error) {
        // Wrap, exactly as writeTool does. Without this a CUTOS read error
        // reached callers as a raw CutosClientError while every caller checks
        // for CutosToolError — so `pollCutosJob`'s JOB_NOT_FOUND branch could
        // never match, and a job CUTOS had forgotten (restart, GC) left the
        // AIOS step parked forever instead of failing it.
        if (error instanceof CutosClientError) {
          throw new CutosToolError(error.code, error.message);
        }
        throw error;
      }
      await mirrorActivity(context, binding, outcome.activity);
      if (outcome.correlation.timelineRevision !== undefined) {
        await rememberTimelineRevision(context.projectId, outcome.correlation.timelineRevision);
      }
      return {
        value: outcome.result,
        evidence: evidenceFor(binding, spec.capability, spec.ref(binding, input)),
        actualPoints: 0,
        verified: true,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Write tools
// ---------------------------------------------------------------------------

interface WriteToolSpec {
  id: string;
  label: string;
  capability: string;
  input: z.ZodType<Record<string, unknown>>;
  args: (input: Record<string, unknown>, binding: CutosBinding) => Record<string, unknown>;
  risk: "low" | "medium" | "high";
  confirmation: "never" | "paid" | "high_risk" | "always";
  /** True when CUTOS will reject the call without an expectedRevision. */
  mutatesTimeline: boolean;
  /** True when the capability returns a jobId instead of a finished result. */
  longRunning?: boolean;
  timeoutMs?: number;
}

function writeTool(spec: WriteToolSpec): ToolDefinition<Record<string, unknown>, unknown> {
  return {
    id: spec.id,
    label: spec.label,
    category: "creator",
    access: "EXTERNAL",
    input: spec.input,
    output: z.unknown(),
    requiredContext: ["userId", "groupId", "projectId"],
    risk: spec.risk,
    confirmation: spec.confirmation,
    idempotency: "effect_receipt",
    idempotencyContract: {
      policy: "effect_receipt",
      keyStrategy: "run_step_effect_fingerprint",
      // CUTOS holds the authoritative receipt; a duplicate returns it verbatim.
      duplicateEffectPolicy: "return_verified_receipt",
      retryPolicy: "same_key_only",
      billingPolicy: "reserve_once_settle_once",
    },
    cost: { paid: false, estimatePoints: () => 0 },
    retry: WRITE_RETRY,
    verify: (result: ToolResult) => result.verified && result.evidence.length > 0,
    verificationStage: "VERIFIED",
    verificationMethod: "cutos_effect_receipt",
    evidenceScope: "project",
    availability,
    handlerIdentity: `cutosClient.invokeWrite:${spec.capability}`,
    required: false,
    handler: async (input, context) => {
      const binding = await bindingFor(context);
      const args = spec.args(input, binding);
      const requestId = randomUUID();

      // Derived from run + step + capability + project + args: identical across
      // every retry of this logical effect, different for a different effect.
      const idempotencyKey = deriveCutosIdempotencyKey({
        runId: context.runId,
        stepId: context.stepId,
        capability: spec.capability,
        cutosProjectId: binding.cutosProjectId,
        args,
      });

      const expectedRevision = spec.mutatesTimeline
        ? await currentRevision(binding, context, requestId)
        : undefined;

      // ---- durable intent BEFORE the call -----------------------------------
      const prepared = await prepareEffect({
        runId: context.runId,
        stepId: context.stepId,
        userId: context.userId,
        groupId: context.groupId,
        projectId: context.projectId,
        cutosProjectId: binding.cutosProjectId,
        toolId: spec.id,
        capability: spec.capability,
        requestId,
        idempotencyKey,
        expectedRevision: expectedRevision ?? null,
      });

      if (prepared.state === "replay") {
        // Already done in a previous life of this process.
        return {
          value: prepared.effect.resultRef ?? { replayed: true },
          evidence: evidenceFor(binding, spec.capability, `cutos-effect:${prepared.effect.id}`, {
            type: "effect",
          }),
          actualPoints: 0,
          verified: true,
        };
      }

      if (prepared.state === "recovered") {
        // A crash interrupted this effect. Ask CUTOS what happened; never
        // assume, and never re-apply on a guess.
        const decision = await reconcileEffect(prepared.effect, client(), async () => {
          const probe = await client().invokeWrite<Record<string, unknown>>(
            spec.capability,
            args,
            {
              correlation: {
                ...correlationFor(context, binding, randomUUID()),
                idempotencyKey,
              },
              expectedRevision,
              approval: { granted: true, grantedBy: "aios.reconcile" },
              signal: context.signal,
            },
          );
          // CUTOS replays a completed effect: `replayed` proves the original
          // call landed, so this probe changed nothing.
          return {
            completed: probe.replayed,
            timelineRevision: probe.correlation.timelineRevision ?? null,
            cutosJobId: probe.correlation.cutosJobId ?? null,
            cutosAgentRunId: probe.correlation.cutosAgentRunId ?? null,
            resultRef: boundedResult(probe.result),
          };
        });

        if (decision.action === "replay") {
          return {
            value: decision.effect.resultRef ?? { replayed: true },
            evidence: evidenceFor(binding, spec.capability, `cutos-effect:${decision.effect.id}`, {
              type: "effect",
            }),
            actualPoints: 0,
            verified: true,
          };
        }
        if (decision.action === "wait_job") {
          return {
            value: { jobId: decision.jobId, status: "running", waiting: true },
            evidence: evidenceFor(binding, spec.capability, `cutos-job:${decision.jobId}`, {
              type: "effect",
            }),
            actualPoints: 0,
            verified: true,
          };
        }
        if (decision.action === "failed") {
          throw new CutosToolError(decision.code, `CUTOS effect failed: ${decision.code}`);
        }
        // action === "retry": fall through and issue the call normally.
      }

      await markInFlight(prepared.effect.id);

      try {
        const outcome = await client().invokeWrite<Record<string, unknown>>(
          spec.capability,
          args,
          {
            correlation: { ...correlationFor(context, binding, requestId), idempotencyKey },
            expectedRevision,
            // Approval is granted by the AIOS control plane before the step
            // runs (confirmation policy / wait_for_human). Reaching the handler
            // means that gate already passed.
            approval: { granted: true, grantedBy: `aios:${context.userId}` },
            signal: context.signal,
            ...(spec.timeoutMs === undefined ? {} : { timeoutMs: spec.timeoutMs }),
          },
        );

        await mirrorActivity(context, binding, outcome.activity);
        const jobId = outcome.correlation.cutosJobId ?? null;
        if (jobId) await attachJob(prepared.effect.id, jobId);

        const effect = await completeEffect({
          effectId: prepared.effect.id,
          cutosAgentRunId: outcome.correlation.cutosAgentRunId ?? null,
          cutosJobId: jobId,
          timelineRevision: outcome.correlation.timelineRevision ?? null,
          resultRef: boundedResult(outcome.result),
        });
        if (outcome.correlation.timelineRevision !== undefined) {
          await rememberTimelineRevision(context.projectId, outcome.correlation.timelineRevision);
        }

        return {
          value: {
            ...(outcome.result as Record<string, unknown>),
            ...(jobId ? { jobId } : {}),
            replayed: outcome.replayed,
            timelineRevision: outcome.correlation.timelineRevision ?? null,
          },
          evidence: evidenceFor(binding, spec.capability, `cutos-effect:${effect.id}`, {
            type: "effect",
          }),
          actualPoints: 0,
          verified: true,
        };
      } catch (error) {
        if (error instanceof CutosClientError) {
          // A retryable transport error leaves the effect claimable so the SAME
          // key is reused; a terminal one is recorded so retries stop.
          if (!error.retryable) await failEffect(prepared.effect.id, error.code);
          const approvalRequest = (error as { approvalRequest?: ApprovalRequest }).approvalRequest;
          throw new CutosToolError(error.code, error.message, approvalRequest);
        }
        await failEffect(prepared.effect.id, "INTERNAL");
        throw error;
      }
    },
  };
}

/** Read the authoritative revision immediately before guarding a mutation on it. */
async function currentRevision(
  binding: CutosBinding,
  context: ToolContext,
  requestId: string,
): Promise<number> {
  const project = await client().invokeRead<{ timelineRevision: number }>(
    "get_project",
    { projectId: binding.cutosProjectId },
    { correlation: correlationFor(context, binding, requestId), signal: context.signal },
  );
  return project.result.timelineRevision;
}

/** Keep only a bounded, scalar-ish reference of a CUTOS result on the ledger. */
function boundedResult(result: unknown): Record<string, unknown> | null {
  if (!result || typeof result !== "object") return null;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(result as Record<string, unknown>).slice(0, 24)) {
    if (value === null || ["string", "number", "boolean"].includes(typeof value)) {
      out[key] = typeof value === "string" ? value.slice(0, 200) : value;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------

const empty = z.object({});
const query = z.object({
  query: z.string().min(1).max(500),
  limit: z.number().int().positive().max(50).optional(),
  speaker: z.string().min(1).max(200).optional(),
  startMs: z.number().int().nonnegative().optional(),
  endMs: z.number().int().nonnegative().optional(),
});
const window = z.object({
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
});

const withProject = (
  args: Record<string, unknown>,
  binding: CutosBinding,
): Record<string, unknown> => ({ ...args, projectId: binding.cutosProjectId });

export function cutosToolDefinitions(): ToolDefinition<Record<string, unknown>, unknown>[] {
  return [
    // ------------------------------------------------------------- read ----
    readTool({
      id: "cutos.project.get",
      label: "取得 CUTOS 影片專案狀態",
      capability: "get_project",
      input: empty,
      args: (_input, binding) => ({ projectId: binding.cutosProjectId }),
      ref: (binding) => `cutos-project:${binding.cutosProjectId}`,
    }),
    readTool({
      id: "cutos.transcript.get",
      label: "取得逐字稿",
      capability: "get_transcript",
      input: z.object({
        offset: z.number().int().nonnegative().optional(),
        limit: z.number().int().positive().max(200).optional(),
      }),
      args: withProject,
      ref: (binding) => `cutos-transcript:${binding.cutosProjectId}`,
    }),
    readTool({
      id: "cutos.transcript.search",
      label: "字面搜尋逐字稿",
      capability: "search_transcript",
      input: query,
      args: withProject,
      ref: (binding) => `cutos-transcript-search:${binding.cutosProjectId}`,
    }),
    readTool({
      id: "cutos.semantic.search",
      label: "語意搜尋影片內容",
      capability: "search_semantic",
      input: query,
      args: withProject,
      ref: (binding) => `cutos-semantic-search:${binding.cutosProjectId}`,
    }),
    readTool({
      id: "cutos.speakers.list",
      label: "列出說話者",
      capability: "list_speakers",
      input: empty,
      args: (_input, binding) => ({ projectId: binding.cutosProjectId }),
      ref: (binding) => `cutos-speakers:${binding.cutosProjectId}`,
    }),
    readTool({
      id: "cutos.topics.list",
      label: "列出影片主題",
      capability: "list_topics",
      input: z.object({ limit: z.number().int().positive().max(50).optional() }),
      args: withProject,
      ref: (binding) => `cutos-topics:${binding.cutosProjectId}`,
    }),
    readTool({
      id: "cutos.highlights.find",
      label: "找出精華片段",
      capability: "find_highlights",
      input: z.object({
        targetDurationMs: z.number().int().positive().optional(),
        limit: z.number().int().positive().max(20).optional(),
        query: z.string().min(1).max(500).optional(),
      }),
      args: withProject,
      ref: (binding) => `cutos-highlights:${binding.cutosProjectId}`,
      timeoutMs: 30_000,
    }),
    readTool({
      id: "cutos.scene.inspect",
      label: "檢視片段內容",
      capability: "inspect_scene",
      input: window,
      args: withProject,
      ref: (binding) => `cutos-scene:${binding.cutosProjectId}`,
    }),
    readTool({
      id: "cutos.context.range",
      label: "取得片段逐字稿內容",
      capability: "get_context_range",
      input: window.extend({
        maxSentences: z.number().int().positive().max(200).optional(),
        maxChars: z.number().int().positive().max(20_000).optional(),
      }),
      args: withProject,
      ref: (binding) => `cutos-context:${binding.cutosProjectId}`,
    }),
    readTool({
      id: "cutos.context.build",
      label: "建立受控語意脈絡",
      capability: "build_semantic_context",
      input: z.object({
        query: z.string().max(2_000),
        maxRanges: z.number().int().positive().max(64).optional(),
        maxChars: z.number().int().positive().max(40_000).optional(),
        targetDurationMs: z.number().int().positive().optional(),
      }),
      args: withProject,
      ref: (binding) => `cutos-context-build:${binding.cutosProjectId}`,
      timeoutMs: 30_000,
    }),
    readTool({
      id: "cutos.timeline.inspect",
      label: "檢視時間軸",
      capability: "get_project",
      input: empty,
      args: (_input, binding) => ({ projectId: binding.cutosProjectId }),
      ref: (binding) => `cutos-timeline:${binding.cutosProjectId}`,
    }),
    readTool({
      id: "cutos.preview.inspect",
      label: "檢視即時預覽",
      capability: "get_preview",
      input: empty,
      args: (_input, binding) => ({ projectId: binding.cutosProjectId }),
      ref: (binding) => `cutos-preview:${binding.cutosProjectId}`,
    }),
    readTool({
      id: "cutos.job.get",
      label: "查詢 CUTOS 背景工作",
      capability: "get_job",
      input: z.object({ jobId: z.string().min(1).max(200) }),
      args: (input) => ({ jobId: input.jobId }),
      ref: (_binding, input) => `cutos-job:${String(input.jobId)}`,
    }),
    readTool({
      id: "cutos.run.get",
      label: "查詢 CUTOS 剪輯代理執行",
      capability: "get_agent_run",
      input: z.object({ runId: z.string().min(1).max(200) }),
      args: (input) => ({ runId: input.runId }),
      ref: (_binding, input) => `cutos-run:${String(input.runId)}`,
    }),
    readTool({
      id: "cutos.run.resume",
      label: "確認 CUTOS 執行是否可續行",
      capability: "resume_agent_run",
      input: z.object({ runId: z.string().min(1).max(200) }),
      args: (input) => ({ runId: input.runId }),
      ref: (_binding, input) => `cutos-run-resume:${String(input.runId)}`,
    }),
    readTool({
      id: "cutos.edit.verify",
      label: "驗證剪輯計畫",
      capability: "verify_edit_plan",
      input: empty,
      args: (_input, binding) => ({ projectId: binding.cutosProjectId }),
      ref: (binding) => `cutos-verify:${binding.cutosProjectId}`,
    }),
    readTool({
      id: "cutos.edit.preview",
      label: "預覽剪輯計畫",
      capability: "preview_edit_plan",
      input: empty,
      args: (_input, binding) => ({ projectId: binding.cutosProjectId }),
      ref: (binding) => `cutos-plan-preview:${binding.cutosProjectId}`,
      timeoutMs: 30_000,
    }),

    // ------------------------------------------------------------ write ----
    writeTool({
      id: "cutos.analysis.start",
      label: "開始分析影片",
      capability: "analyze",
      input: empty,
      args: (_input, binding) => ({ projectId: binding.cutosProjectId }),
      risk: "low",
      confirmation: "never",
      mutatesTimeline: false,
      longRunning: true,
    }),
    writeTool({
      id: "cutos.edit.plan",
      label: "建立剪輯計畫",
      capability: "create_edit_plan",
      input: z.object({ instruction: z.string().min(1).max(2_000) }),
      args: withProject,
      risk: "low",
      confirmation: "never",
      mutatesTimeline: false,
      timeoutMs: 90_000,
    }),
    writeTool({
      id: "cutos.edit.reject_operation",
      label: "移除計畫中的一項操作",
      capability: "reject_operation",
      input: z.object({ opIndex: z.number().int().nonnegative().max(10_000) }),
      args: withProject,
      risk: "low",
      confirmation: "never",
      mutatesTimeline: false,
    }),
    writeTool({
      id: "cutos.edit.apply",
      label: "套用剪輯計畫到時間軸",
      capability: "apply_edit_plan",
      input: empty,
      args: (_input, binding) => ({ projectId: binding.cutosProjectId }),
      risk: "high",
      // High-impact and irreversible without undo: never silent.
      confirmation: "always",
      mutatesTimeline: true,
      timeoutMs: 60_000,
    }),
    writeTool({
      id: "cutos.undo",
      label: "復原上一個剪輯",
      capability: "undo",
      input: empty,
      args: (_input, binding) => ({ projectId: binding.cutosProjectId }),
      risk: "medium",
      confirmation: "high_risk",
      mutatesTimeline: true,
    }),
    writeTool({
      id: "cutos.redo",
      label: "重做剪輯",
      capability: "redo",
      input: empty,
      args: (_input, binding) => ({ projectId: binding.cutosProjectId }),
      risk: "medium",
      confirmation: "high_risk",
      mutatesTimeline: true,
    }),
    writeTool({
      id: "cutos.export",
      label: "輸出影片",
      capability: "export",
      input: empty,
      args: (_input, binding) => ({ projectId: binding.cutosProjectId }),
      risk: "high",
      confirmation: "always",
      mutatesTimeline: false,
      longRunning: true,
      timeoutMs: 60_000,
    }),
    writeTool({
      id: "cutos.job.cancel",
      label: "取消 CUTOS 背景工作",
      capability: "cancel_job",
      input: z.object({ jobId: z.string().min(1).max(200) }),
      args: (input) => ({ jobId: input.jobId }),
      risk: "low",
      confirmation: "never",
      mutatesTimeline: false,
    }),
    writeTool({
      id: "cutos.job.retry",
      label: "重試 CUTOS 背景工作",
      capability: "retry_job",
      input: z.object({ jobId: z.string().min(1).max(200) }),
      args: (input) => ({ jobId: input.jobId }),
      risk: "low",
      confirmation: "never",
      mutatesTimeline: false,
      longRunning: true,
    }),
    writeTool({
      id: "cutos.run.cancel",
      label: "取消 CUTOS 剪輯代理執行",
      capability: "cancel_agent_run",
      input: z.object({ runId: z.string().min(1).max(200) }),
      args: (input) => ({ runId: input.runId }),
      risk: "medium",
      confirmation: "never",
      mutatesTimeline: false,
    }),
  ];
}

/** Tool ids that map to a long-running CUTOS job (the runner waits on these). */
export const CUTOS_LONG_RUNNING_TOOLS = new Set([
  "cutos.analysis.start",
  "cutos.export",
  "cutos.job.retry",
]);

export const CUTOS_TOOL_IDS = cutosToolDefinitions().map((tool) => tool.id);
