/**
 * Inbound control-plane API: the runs CUTOS asks AIOS to orchestrate.
 *
 * This is the other half of the bridge. `cutosClient.ts` is AIOS calling CUTOS;
 * this module is CUTOS calling AIOS, over the same `cutos.agent.v2` protocol,
 * with the same guarantees rather than a looser mirror of them:
 *
 *  - **Protocol first.** An unknown or unsupported `protocolVersion` fails with
 *    `PROTOCOL_VERSION_MISMATCH`. There is no silent fallback in this direction
 *    either — a peer that cannot state a version it shares with us is refused.
 *  - **CUTOS names its video, never our project.** `resolveInboundCutosProject`
 *    derives the AIOS project from the durable binding and re-checks live group
 *    membership. There is no request field that selects an AIOS project, so a
 *    CUTOS deployment holding a valid credential still cannot reach a project
 *    nobody bound to the video it is asking about.
 *  - **The capability is an allow-list.** `INBOUND_CAPABILITIES` maps a small
 *    set of abstract capabilities onto the existing video-editing DAG. There is
 *    no `runArbitraryPlan(steps)` — CUTOS cannot post its own step list, and
 *    nothing here accepts a file path, a URL, a shell fragment or a tool id.
 *  - **The approval gate stays with the control plane.** An inbound submit
 *    creates an ordinary agent run in `awaiting_approval`, exactly as a human
 *    request would; CUTOS observes `waiting_approval` and shows 「需要你的確認」.
 *    An inbound caller cannot approve its own run — that would be precisely the
 *    "tool injection bypassing confirmation" hole the integration exists to
 *    close. `resume` un-parks a run waiting on external work; it never approves.
 *  - **Submitting twice is not running twice.** `correlation.idempotencyKey` is
 *    unique in `cutos_inbound_runs`, and the insert (not a prior read) is what
 *    decides, so two concurrent retries of the same submit converge on one run.
 *
 * Everything reuses the existing lifecycle: `agentCore`'s `stopAgentCore` /
 * `resumePausedAgentCore` / `getAgentRunChecked` and the ordinary `agentRuns`
 * table. There is no second runner and no second approval mechanism here.
 */
import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db, schema } from "../db";
import type { AuthState } from "./auth";
import { resolveMcpIdentity } from "./mcpAuth";
import {
  clearRateLimit,
  inspectFailureRateLimit,
  RATE_LIMIT_POLICIES,
  RATE_LIMIT_SCOPES,
  RateLimitConfigurationError,
  RateLimitUnavailableError,
  recordRateLimitFailure,
} from "./rateLimit";
import {
  CutosBindingError,
  resolveInboundCutosProject,
  type CutosBinding,
} from "./cutosProjectBinding";
import { buildVideoEditingWorkflow, describeVideoWorkflow, type VideoWorkflowInput } from "./cutosWorkflow";
import { getAgentRunChecked, resumePausedAgentCore, stopAgentCore, type AgentRunRow } from "./agentCore";
import { MAX_CONTEXT_CHARS, MAX_CONTEXT_RANGES } from "./cutosSemanticContext";
import type { AgentStep } from "./agentRunner";
import {
  aiosRunRequestSchema,
  checkProtocolCompatibility,
  CUTOS_PROTOCOL_VERSION,
  CUTOS_SUPPORTED_PROTOCOLS,
  type AiosRunState,
  type AiosRunStatus,
  type AiosRunStep,
  type CutosErrorCode,
  type RunCorrelation,
} from "../../shared/cutosProtocol";

/** Manifest version of the inbound surface; bumped when its shape changes. */
export const AIOS_INBOUND_MANIFEST_VERSION = 1;

/** Mechanisms this deployment actually honours, advertised on /api/cutos/health. */
export const AIOS_INBOUND_FEATURES = [
  "idempotency",
  "approval",
  "cancellation",
  "resume",
  "activity_log",
  "bounded_context",
] as const;

/**
 * The abstract capabilities CUTOS may ask AIOS to orchestrate.
 *
 * Deliberately small and closed. Each entry decides the DAG shape itself —
 * CUTOS states an intent, not a plan — and `includeExport` is what separates a
 * run that only rewrites the timeline from one that also renders a file.
 */
const INBOUND_CAPABILITIES: Record<
  string,
  { shape: Omit<VideoWorkflowInput, "goal" | "query">; label: string }
> = {
  "video.edit.plan": {
    label: "剪輯計畫",
    shape: { targetDurationMs: 8 * 60_000, shortCandidateCount: 0, includeExport: false },
  },
  "video.highlight.package": {
    label: "精華與短影音",
    shape: { targetDurationMs: 8 * 60_000, shortCandidateCount: 3, shortDurationMs: 45_000, includeExport: true },
  },
  "video.timeline.update": {
    label: "更新時間軸",
    shape: { targetDurationMs: 8 * 60_000, shortCandidateCount: 0, includeExport: false },
  },
  "video.export": {
    label: "輸出影片",
    shape: { targetDurationMs: 8 * 60_000, shortCandidateCount: 0, includeExport: true },
  },
};

/** Capability names CUTOS may submit. Anything else is UNSUPPORTED_OPERATION. */
export function inboundCapabilityNames(): string[] {
  return Object.keys(INBOUND_CAPABILITIES);
}

/** HTTP status per protocol error code — stable, and never leaks internals. */
const STATUS_BY_CODE: Record<CutosErrorCode, number> = {
  PROTOCOL_VERSION_MISMATCH: 409,
  CAPABILITY_NOT_FOUND: 404,
  VALIDATION_FAILED: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN_PROJECT_SCOPE: 403,
  PROJECT_NOT_FOUND: 404,
  JOB_NOT_FOUND: 404,
  RUN_NOT_FOUND: 404,
  STALE_TIMELINE_REVISION: 409,
  IDEMPOTENCY_IN_PROGRESS: 409,
  IDEMPOTENCY_CONFLICT: 409,
  APPROVAL_REQUIRED: 428,
  NO_PENDING_PLAN: 409,
  UNSUPPORTED_OPERATION: 400,
  EMPTY_TIMELINE: 409,
  ANALYSIS_REQUIRED: 409,
  CANCELLED: 409,
  TIMEOUT: 504,
  UNAVAILABLE: 503,
  INTERNAL: 500,
};

export class CutosInboundError extends Error {
  constructor(
    readonly code: CutosErrorCode,
    /** zh-TW key; the raw message is for logs only. */
    readonly messageKey: string,
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "CutosInboundError";
  }
}

function fail(res: Response, error: CutosInboundError): void {
  res.status(STATUS_BY_CODE[error.code] ?? 500).json({
    protocolVersion: CUTOS_PROTOCOL_VERSION,
    error: {
      code: error.code,
      messageKey: error.messageKey,
      // `detail` is composed here from our own constants — never a peer string
      // and never an exception message, so a stack cannot reach the wire.
      ...(error.detail ? { detail: error.detail } : {}),
      retryable: error.code === "TIMEOUT" || error.code === "UNAVAILABLE" || error.code === "INTERNAL",
    },
  });
}

function inboundClientIp(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
}

/**
 * Authenticate a CUTOS deployment.
 *
 * Same door as the REST v1 API and MCP: a personal key, presented as
 * `Authorization: Bearer …` (what the CUTOS orchestrator sends) or `x-api-key`.
 * Never `?key=` — an inbound submit is a write, and a key in a URL ends up in
 * proxy logs where anyone who can read them could replay it.
 */
async function authenticate(req: Request, res: Response): Promise<AuthState | null> {
  const header = req.headers.authorization;
  const bearer = typeof header === "string" && /^bearer\s+/i.test(header)
    ? header.replace(/^bearer\s+/i, "").trim()
    : undefined;
  const apiKey = typeof req.headers["x-api-key"] === "string" ? req.headers["x-api-key"] : undefined;
  const provided = bearer || apiKey;
  if (!provided) {
    fail(res, new CutosInboundError("UNAUTHORIZED", "aios.error.unauthorized", "missing credential"));
    return null;
  }

  const ip = inboundClientIp(req);
  try {
    const blocked = await inspectFailureRateLimit(
      RATE_LIMIT_SCOPES.mcpIp,
      ip,
      RATE_LIMIT_POLICIES.mcpFailures,
    );
    if (blocked.blocked) {
      res.setHeader("Retry-After", String(Math.max(1, Math.ceil(blocked.retryAfterMs / 1_000))));
      fail(res, new CutosInboundError("UNAVAILABLE", "aios.error.unavailable", "rate limited"));
      return null;
    }
  } catch (error) {
    if (error instanceof RateLimitUnavailableError || error instanceof RateLimitConfigurationError) {
      // Fail closed: an unavailable brute-force guard must not become an open door.
      console.error(`[cutos-inbound] rate limit unavailable: ${(error as Error).name}`);
      fail(res, new CutosInboundError("UNAVAILABLE", "aios.error.unavailable", "rate limit unavailable"));
      return null;
    }
    throw error;
  }

  const identity = await resolveMcpIdentity(provided);
  if (!identity) {
    try {
      await recordRateLimitFailure(RATE_LIMIT_SCOPES.mcpIp, ip, RATE_LIMIT_POLICIES.mcpFailures);
    } catch (error) {
      if (!(error instanceof RateLimitUnavailableError || error instanceof RateLimitConfigurationError)) throw error;
    }
    fail(res, new CutosInboundError("UNAUTHORIZED", "aios.error.unauthorized", "bad credential"));
    return null;
  }
  // A read-only key may poll a run but must not start or stop one; the caller
  // checks `readOnly` where it matters.
  if (identity.scope.readOnly) {
    (req as Request & { cutosReadOnly?: boolean }).cutosReadOnly = true;
  }
  try {
    await clearRateLimit(RATE_LIMIT_SCOPES.mcpIp, ip);
  } catch (error) {
    if (!(error instanceof RateLimitUnavailableError || error instanceof RateLimitConfigurationError)) throw error;
  }
  return identity.auth;
}

function isReadOnly(req: Request): boolean {
  return (req as Request & { cutosReadOnly?: boolean }).cutosReadOnly === true;
}

/**
 * Negotiate the protocol, loudly.
 *
 * The header is advisory; the body's `protocolVersion` is authoritative because
 * that is what the schema validates. Both are checked so a peer that sets only
 * a header still gets a typed mismatch rather than a schema error it cannot
 * interpret.
 */
function assertProtocol(req: Request, bodyVersion?: unknown): void {
  const headerVersion = typeof req.headers["x-cutos-protocol"] === "string"
    ? req.headers["x-cutos-protocol"]
    : undefined;
  const declared = typeof bodyVersion === "string" ? bodyVersion : headerVersion;
  const compatibility = checkProtocolCompatibility(declared, undefined, CUTOS_SUPPORTED_PROTOCOLS);
  if (!compatibility.compatible) {
    throw new CutosInboundError(
      "PROTOCOL_VERSION_MISMATCH",
      compatibility.messageKey ?? "aios.protocol.mismatch",
      compatibility.detail ?? "protocol mismatch",
      `supported=${CUTOS_SUPPORTED_PROTOCOLS.join(",")}`,
    );
  }
}

/** AIOS run status → the protocol's vocabulary. */
export function toProtocolRunStatus(status: AgentRunRow["status"]): AiosRunStatus {
  switch (status) {
    case "awaiting_approval":
    case "waiting_user_input":
    case "waiting_confirmation":
    case "waiting_permission":
    case "paused":
    case "user_controlled":
      // All of these mean the same thing to CUTOS: a human has to act before
      // anything else happens. Collapsing them is deliberate — the protocol
      // must not leak AIOS's internal state machine.
      return "waiting_approval";
    case "waiting":
      return "waiting_external";
    case "running":
      return "running";
    case "done":
      return "completed";
    case "failed":
      return "failed";
    case "stopped":
    case "discarded":
      return "cancelled";
    default:
      return "queued";
  }
}

/**
 * Progress text key per step.
 *
 * Keys come from the `bridge.activity.*` namespace both repos already
 * translate, so CUTOS renders 繁中 without inventing a parallel key space and
 * without ever receiving free-form prose from a model.
 */
function stepMessageKey(step: AgentStep): string {
  if (step.kind === "request_approval" || step.kind === "wait_for_human") return "bridge.activity.approval";
  switch (step.toolId) {
    case "cutos.analysis.start": return "bridge.activity.analyze";
    case "cutos.transcript.get": return "bridge.activity.transcript";
    case "cutos.speakers.list":
    case "cutos.topics.list":
    case "cutos.semantic.search":
    case "cutos.context.build":
    case "cutos.highlights.find": return "bridge.activity.semanticSearch";
    case "cutos.edit.plan": return "bridge.activity.plan";
    case "cutos.edit.verify": return "bridge.activity.verify";
    case "cutos.edit.preview":
    case "cutos.preview.inspect": return "bridge.activity.preview";
    case "cutos.edit.apply": return "bridge.activity.apply";
    case "cutos.export": return "bridge.activity.export";
    default: return "bridge.activity.working";
  }
}

function toProtocolSteps(steps: AgentStep[]): AiosRunStep[] {
  return steps.map((step, index) => ({
    id: step.id ?? `step-${index + 1}`,
    kind: step.kind,
    status: step.status,
    messageKey: stepMessageKey(step),
    dependsOn: step.dependsOn ?? [],
    ...(step.externalJobId ? { cutosJobId: step.externalJobId } : {}),
    ...(step.externalRunId ? { cutosAgentRunId: step.externalRunId } : {}),
  }));
}

type InboundRow = typeof schema.cutosInboundRuns.$inferSelect;

function correlationOf(row: InboundRow, run: AgentRunRow): RunCorrelation {
  return {
    requestId: row.requestId,
    idempotencyKey: row.idempotencyKey,
    aiosRunId: run.id,
    aiosProjectId: run.projectId,
    cutosProjectId: row.cutosProjectId,
    ...(row.cutosAgentRunId ? { cutosAgentRunId: row.cutosAgentRunId } : {}),
    ...(typeof row.timelineRevision === "number" ? { timelineRevision: row.timelineRevision } : {}),
    ...(row.traceId ? { traceId: row.traceId } : {}),
    createdAt: row.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
  };
}

function toRunState(row: InboundRow, run: AgentRunRow): AiosRunState {
  const steps = Array.isArray(run.steps) ? (run.steps as AgentStep[]) : [];
  return {
    protocolVersion: CUTOS_PROTOCOL_VERSION,
    aiosRunId: run.id,
    status: toProtocolRunStatus(run.status),
    steps: toProtocolSteps(steps),
    correlation: correlationOf(row, run),
    updatedAt: run.updatedAt.toISOString(),
    ...(run.status === "failed" && run.error
      ? {
        error: {
          code: "INTERNAL" as CutosErrorCode,
          // The stored run error can carry internals (a provider message, a
          // stack fragment). CUTOS gets a fixed sentence and a stable key
          // instead; the real text stays in this deployment's own records.
          message: "AIOS run failed",
          messageKey: "aios.error.internal",
          retryable: false,
        },
      }
      : {}),
  };
}

/** Reject an oversized context before it can cost anything. */
function assertContextWithinBudget(context: { totalChars?: number; ranges?: unknown[] } | undefined): void {
  if (!context) return;
  const ranges = Array.isArray(context.ranges) ? context.ranges.length : 0;
  if (ranges > MAX_CONTEXT_RANGES) {
    throw new CutosInboundError(
      "VALIDATION_FAILED",
      "aios.error.validationFailed",
      "context exceeds range budget",
      `ranges>${MAX_CONTEXT_RANGES}`,
    );
  }
  if (typeof context.totalChars === "number" && context.totalChars > MAX_CONTEXT_CHARS) {
    throw new CutosInboundError(
      "VALIDATION_FAILED",
      "aios.error.validationFailed",
      "context exceeds char budget",
      `chars>${MAX_CONTEXT_CHARS}`,
    );
  }
}

/* ── Handlers ─────────────────────────────────────── */

/**
 * GET /api/cutos/health — the version handshake.
 *
 * Unauthenticated on purpose: this endpoint exists so an operator can tell
 * 「版本不相容」 apart from 「認證失敗」. Requiring a credential would collapse
 * both into one unreachable state, which is the silent-failure mode the
 * protocol forbids. It returns only constants that are already public in both
 * repositories' source — no tenant data, no counts, no configuration.
 */
export async function handleCutosInboundHealth(_req: Request, res: Response): Promise<void> {
  res.status(200).json({
    protocolVersion: CUTOS_PROTOCOL_VERSION,
    supportedProtocols: [...CUTOS_SUPPORTED_PROTOCOLS],
    manifestVersion: AIOS_INBOUND_MANIFEST_VERSION,
    serverVersion: process.env.APP_VERSION || "aios",
    features: [...AIOS_INBOUND_FEATURES],
    capabilities: inboundCapabilityNames(),
    reachable: true,
  });
}

/** POST /api/cutos/runs — CUTOS asks AIOS to orchestrate a video job. */
export async function handleCutosSubmitRun(req: Request, res: Response): Promise<void> {
  try {
    assertProtocol(req, (req.body as { protocolVersion?: unknown } | undefined)?.protocolVersion);
    const auth = await authenticate(req, res);
    if (!auth) return;
    if (isReadOnly(req)) {
      throw new CutosInboundError("UNAUTHORIZED", "aios.error.unauthorized", "read-only credential");
    }

    const parsed = aiosRunRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new CutosInboundError(
        "VALIDATION_FAILED",
        "aios.error.validationFailed",
        "request failed schema validation",
        parsed.error.issues.slice(0, 3).map((i) => i.path.join(".") || "root").join(","),
      );
    }
    const request = parsed.data;

    const capability = INBOUND_CAPABILITIES[request.capability];
    if (!capability) {
      throw new CutosInboundError(
        "UNSUPPORTED_OPERATION",
        "aios.error.unsupportedOperation",
        `capability ${request.capability} is not orchestrated by AIOS`,
        `supported=${inboundCapabilityNames().join(",")}`,
      );
    }

    const { cutosProjectId, idempotencyKey, requestId } = request.correlation;
    if (!cutosProjectId) {
      throw new CutosInboundError(
        "VALIDATION_FAILED",
        "aios.error.validationFailed",
        "correlation.cutosProjectId is required",
        "cutosProjectId",
      );
    }
    // A submit is a write: without a stable key a retry would start a second
    // run, so the key is required rather than defaulted.
    if (!idempotencyKey) {
      throw new CutosInboundError(
        "VALIDATION_FAILED",
        "aios.error.validationFailed",
        "correlation.idempotencyKey is required for a submit",
        "idempotencyKey",
      );
    }
    assertContextWithinBudget(request.context as { totalChars?: number; ranges?: unknown[] } | undefined);

    let binding: CutosBinding;
    try {
      binding = await resolveInboundCutosProject({ auth, cutosProjectId });
    } catch (error) {
      if (error instanceof CutosBindingError) {
        throw new CutosInboundError("PROJECT_NOT_FOUND", error.messageKey, error.message);
      }
      throw error;
    }

    // Replay: an existing row for this key is the same logical submit.
    const existing = await findInboundRun({ idempotencyKey });
    if (existing) {
      if (existing.row.cutosProjectId !== cutosProjectId) {
        throw new CutosInboundError(
          "IDEMPOTENCY_CONFLICT",
          "aios.error.idempotencyConflict",
          "idempotency key reused for a different CUTOS project",
        );
      }
      res.status(200).json(toRunState(existing.row, existing.run));
      return;
    }

    const workflowInput: VideoWorkflowInput = {
      goal: request.goal,
      query: request.goal,
      ...capability.shape,
    };
    const steps = buildVideoEditingWorkflow(workflowInput);

    const runId = randomUUID();
    // Insert the correlation row FIRST and let its unique index arbitrate: two
    // concurrent retries race here, the loser reads the winner's run, and only
    // one agent run is ever created. A read-then-write check would not do that.
    let claimed: InboundRow;
    try {
      const [row] = await db
        .insert(schema.cutosInboundRuns)
        .values({
          runId,
          groupId: binding.groupId,
          userId: binding.userId,
          projectId: binding.aiosProjectId,
          cutosProjectId,
          capability: request.capability,
          qualityProfile: request.qualityProfile,
          requestId,
          idempotencyKey,
          ...(request.correlation.cutosAgentRunId ? { cutosAgentRunId: request.correlation.cutosAgentRunId } : {}),
          ...(request.correlation.traceId ? { traceId: request.correlation.traceId } : {}),
          ...(typeof request.correlation.expectedRevision === "number"
            ? { timelineRevision: request.correlation.expectedRevision }
            : {}),
        })
        .returning();
      claimed = row!;
    } catch (error) {
      // Unique violation = the concurrent retry won. Read its run and reply
      // with the same state, so both retries observe one run.
      const winner = await findInboundRun({ idempotencyKey });
      if (winner) {
        res.status(200).json(toRunState(winner.row, winner.run));
        return;
      }
      throw error;
    }

    const [run] = await db
      .insert(schema.agentRuns)
      .values({
        id: runId,
        projectId: binding.aiosProjectId,
        groupId: binding.groupId,
        // The run belongs to the human who bound the video, not to CUTOS: the
        // approval, the points and the audit trail all land on a real account.
        userId: binding.userId,
        goal: request.goal,
        summary: describeVideoWorkflow(workflowInput, steps),
        steps,
        estPoints: 0,
        // `awaiting_approval` is the whole point — see the module docstring.
        status: "awaiting_approval",
      })
      .returning();

    res.status(201).json(toRunState(claimed, run!));
  } catch (error) {
    respond(res, error);
  }
}

async function findInboundRun(
  where: { idempotencyKey: string } | { runId: string },
): Promise<{ row: InboundRow; run: AgentRunRow } | null> {
  const [row] = await db
    .select()
    .from(schema.cutosInboundRuns)
    .where("idempotencyKey" in where
      ? eq(schema.cutosInboundRuns.idempotencyKey, where.idempotencyKey)
      : eq(schema.cutosInboundRuns.runId, where.runId));
  if (!row) return null;
  const [run] = await db.select().from(schema.agentRuns).where(eq(schema.agentRuns.id, row.runId));
  return run ? { row, run } : null;
}

/**
 * Load a run for an inbound caller.
 *
 * Two independent checks, not one: the run must be reachable from a binding
 * this caller's group owns (so CUTOS cannot poll runs it did not submit), and
 * `getAgentRunChecked` re-applies the ordinary group guard. A run created by
 * the web UI, with no inbound row, is simply not visible here.
 */
async function loadInboundRun(auth: AuthState, runId: string) {
  const found = await findInboundRun({ runId });
  if (!found) {
    throw new CutosInboundError("RUN_NOT_FOUND", "aios.error.runNotFound", "no inbound run with that id");
  }
  if (!auth.groups.some((membership) => membership.groupId === found.row.groupId)) {
    // Same answer as "does not exist": a caller must not learn which run ids
    // belong to another group.
    throw new CutosInboundError("RUN_NOT_FOUND", "aios.error.runNotFound", "run belongs to another group");
  }
  await getAgentRunChecked(auth, runId);
  return found;
}

/** GET /api/cutos/runs/:runId */
export async function handleCutosGetRun(req: Request, res: Response): Promise<void> {
  try {
    assertProtocol(req);
    const auth = await authenticate(req, res);
    if (!auth) return;
    const found = await loadInboundRun(auth, String(req.params.runId ?? ""));
    res.status(200).json(toRunState(found.row, found.run));
  } catch (error) {
    respond(res, error);
  }
}

/**
 * POST /api/cutos/runs/:runId/cancel
 *
 * Idempotent by construction: a run already in a terminal state is reported as
 * it stands rather than treated as an error, so a retried cancel after a
 * network timeout is safe.
 */
export async function handleCutosCancelRun(req: Request, res: Response): Promise<void> {
  try {
    assertProtocol(req);
    const auth = await authenticate(req, res);
    if (!auth) return;
    if (isReadOnly(req)) {
      throw new CutosInboundError("UNAUTHORIZED", "aios.error.unauthorized", "read-only credential");
    }
    const found = await loadInboundRun(auth, String(req.params.runId ?? ""));
    const terminal = new Set(["done", "failed", "stopped", "discarded"]);
    if (terminal.has(found.run.status)) {
      res.status(200).json(toRunState(found.row, found.run));
      return;
    }
    await stopAgentCore({ auth, runId: found.run.id });
    const after = await findInboundRun({ runId: found.run.id });
    res.status(200).json(toRunState(found.row, after?.run ?? found.run));
  } catch (error) {
    respond(res, error);
  }
}

/**
 * POST /api/cutos/runs/:runId/resume
 *
 * Un-parks a paused run. It deliberately does NOT approve: a run in
 * `awaiting_approval` is reported back as `waiting_approval` so CUTOS shows
 * 「需要你的確認」 instead of an inbound call quietly authorising its own edit.
 */
export async function handleCutosResumeRun(req: Request, res: Response): Promise<void> {
  try {
    assertProtocol(req);
    const auth = await authenticate(req, res);
    if (!auth) return;
    if (isReadOnly(req)) {
      throw new CutosInboundError("UNAUTHORIZED", "aios.error.unauthorized", "read-only credential");
    }
    const found = await loadInboundRun(auth, String(req.params.runId ?? ""));
    if (found.run.status === "awaiting_approval") {
      throw new CutosInboundError(
        "APPROVAL_REQUIRED",
        "aios.error.approvalRequired",
        "run is waiting for human approval and cannot be resumed by its submitter",
      );
    }
    if (found.run.status === "paused") {
      await resumePausedAgentCore({ auth, runId: found.run.id });
    }
    const after = await findInboundRun({ runId: found.run.id });
    res.status(200).json(toRunState(found.row, after?.run ?? found.run));
  } catch (error) {
    respond(res, error);
  }
}

/**
 * One exit for every failure. An unexpected exception becomes INTERNAL with a
 * stable key — the message never reaches the peer, only our own logs.
 */
function respond(res: Response, error: unknown): void {
  if (error instanceof CutosInboundError) {
    fail(res, error);
    return;
  }
  if (error instanceof CutosBindingError) {
    fail(res, new CutosInboundError("PROJECT_NOT_FOUND", error.messageKey, error.message));
    return;
  }
  const trpcCode = (error as { code?: string } | null)?.code;
  if (trpcCode === "NOT_FOUND") {
    fail(res, new CutosInboundError("RUN_NOT_FOUND", "aios.error.runNotFound", "not found"));
    return;
  }
  if (trpcCode === "FORBIDDEN") {
    fail(res, new CutosInboundError("FORBIDDEN_PROJECT_SCOPE", "aios.error.forbiddenProject", "forbidden"));
    return;
  }
  console.error(`[cutos-inbound] unexpected failure: ${(error as Error)?.name}: ${(error as Error)?.message}`);
  fail(res, new CutosInboundError("INTERNAL", "aios.error.internal", "unexpected failure"));
}
