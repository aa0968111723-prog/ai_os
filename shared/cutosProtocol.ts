/**
 * cutos.agent.v2 — the CUTOS × AIOS cross-repository wire contract.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS FILE IS MIRRORED BYTE-FOR-BYTE IN TWO REPOSITORIES:
 *
 *   aa0968111723-prog/CUTOS    packages/protocol/src/protocol.ts
 *   aa0968111723-prog/ai_os    shared/cutosProtocol.ts
 *
 * Neither side may "guess" the other's JSON. Every runtime payload that crosses
 * the boundary is parsed with the Zod schemas below — a TypeScript interface is
 * not enough, because the peer is a different process in a different repo.
 *
 * Drift protection: `PROTOCOL_CONTRACT` is an explicit, hand-maintained
 * descriptor of every schema's field set. `protocolContractFingerprint()`
 * hashes it, and BOTH repos assert the same constant
 * (`PROTOCOL_CONTRACT_FINGERPRINT`) in their own test suite. Editing the
 * contract in one repo without mirroring it into the other turns both suites
 * red instead of producing a silent runtime mismatch.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { createHash } from "node:crypto";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Protocol version + compatibility
// ---------------------------------------------------------------------------

/** The protocol this build speaks. */
export const CUTOS_PROTOCOL_VERSION = "cutos.agent.v2" as const;

/** Legacy protocol kept alive so existing v1 AIOS agents do not break. */
export const CUTOS_PROTOCOL_VERSION_V1 = "cutos.agent.v1" as const;

/** Every protocol version this build can serve/consume, newest first. */
export const CUTOS_SUPPORTED_PROTOCOLS = [
  CUTOS_PROTOCOL_VERSION,
  CUTOS_PROTOCOL_VERSION_V1,
] as const;

export const protocolVersionSchema = z.enum([
  CUTOS_PROTOCOL_VERSION,
  CUTOS_PROTOCOL_VERSION_V1,
]);
export type CutosProtocolVersion = z.infer<typeof protocolVersionSchema>;

export interface ProtocolCompatibility {
  compatible: boolean;
  /** The version both peers agreed on, when compatible. */
  negotiated?: CutosProtocolVersion;
  /** Stable machine code; never a raw exception string. */
  code?: "PROTOCOL_VERSION_MISMATCH" | "PROTOCOL_VERSION_UNKNOWN";
  /** zh-TW message key for the UI. Never surface a raw stack to a user. */
  messageKey?: string;
  detail?: string;
}

/**
 * Explicit compatibility check. There is deliberately NO silent fallback: an
 * unrecognised or unsupported peer protocol fails loudly with a stable code so
 * the UI can say 「版本不相容」 instead of half-working.
 */
export function checkProtocolCompatibility(
  remoteVersion: string | undefined,
  remoteSupported: readonly string[] | undefined,
  localSupported: readonly string[] = CUTOS_SUPPORTED_PROTOCOLS,
): ProtocolCompatibility {
  if (!remoteVersion) {
    return {
      compatible: false,
      code: "PROTOCOL_VERSION_UNKNOWN",
      messageKey: "aios.protocol.unknown",
      detail: "peer did not report a protocolVersion",
    };
  }
  const remoteAll = [remoteVersion, ...(remoteSupported ?? [])];
  // Prefer the newest version both sides can speak.
  for (const candidate of localSupported) {
    if (remoteAll.includes(candidate)) {
      return {
        compatible: true,
        negotiated: candidate as CutosProtocolVersion,
      };
    }
  }
  return {
    compatible: false,
    code: "PROTOCOL_VERSION_MISMATCH",
    messageKey: "aios.protocol.mismatch",
    detail: `peer=${remoteAll.join(",")} local=${localSupported.join(",")}`,
  };
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export const CUTOS_ERROR_CODES = [
  "PROTOCOL_VERSION_MISMATCH",
  "CAPABILITY_NOT_FOUND",
  "VALIDATION_FAILED",
  "UNAUTHORIZED",
  "FORBIDDEN_PROJECT_SCOPE",
  "PROJECT_NOT_FOUND",
  "JOB_NOT_FOUND",
  "RUN_NOT_FOUND",
  "STALE_TIMELINE_REVISION",
  "IDEMPOTENCY_IN_PROGRESS",
  "IDEMPOTENCY_CONFLICT",
  "APPROVAL_REQUIRED",
  "NO_PENDING_PLAN",
  "UNSUPPORTED_OPERATION",
  "EMPTY_TIMELINE",
  "ANALYSIS_REQUIRED",
  "CANCELLED",
  "TIMEOUT",
  "UNAVAILABLE",
  "INTERNAL",
] as const;

export const cutosErrorCodeSchema = z.enum(CUTOS_ERROR_CODES);
export type CutosErrorCode = z.infer<typeof cutosErrorCodeSchema>;

/** Errors the caller may safely retry with the SAME idempotency key. */
export const CUTOS_RETRYABLE_ERROR_CODES: readonly CutosErrorCode[] = [
  "IDEMPOTENCY_IN_PROGRESS",
  "TIMEOUT",
  "UNAVAILABLE",
  "INTERNAL",
];

export function isRetryableCutosError(code: CutosErrorCode | undefined): boolean {
  return !!code && CUTOS_RETRYABLE_ERROR_CODES.includes(code);
}

export const cutosErrorSchema = z.object({
  code: cutosErrorCodeSchema,
  /** Operator-facing English message. Already sanitized — never a raw stack. */
  message: z.string().min(1).max(2_000),
  /** zh-TW UI key, e.g. "aios.error.staleRevision". */
  messageKey: z.string().min(1).max(200),
  retryable: z.boolean(),
  /** Bounded structured detail. Never transcript text, never secrets. */
  details: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});
export type CutosError = z.infer<typeof cutosErrorSchema>;

// ---------------------------------------------------------------------------
// Cross-repo correlation
// ---------------------------------------------------------------------------

const id = (max = 200) => z.string().min(1).max(max);
const isoDate = z.string().min(1).max(64);

/**
 * The correlation envelope. Every request and every result carries it so a
 * single user goal can be traced across both repos:
 *
 *   aiosRunId ↔ aiosStepId ↔ cutosAgentRunId ↔ cutosJobId ↔ timelineRevision
 */
export const runCorrelationSchema = z.object({
  /** Unique per HTTP attempt. Changes on every retry. */
  requestId: id(),
  /** Stable across retries of the SAME logical effect. Required for writes. */
  idempotencyKey: id().optional(),

  aiosRunId: id().optional(),
  aiosStepId: id().optional(),

  cutosAgentRunId: id().optional(),
  cutosJobId: id().optional(),

  aiosProjectId: id().optional(),
  cutosProjectId: id().optional(),

  /** Revision CUTOS reports after handling the call. */
  timelineRevision: z.number().int().nonnegative().optional(),
  /** Revision the caller believed was current (mutation guard). */
  expectedRevision: z.number().int().nonnegative().optional(),

  /** Distributed trace id shared by both repos' logs. */
  traceId: id().optional(),

  createdAt: isoDate,
  updatedAt: isoDate,
});
export type RunCorrelation = z.infer<typeof runCorrelationSchema>;

/** The subset an AIOS caller supplies; CUTOS fills in the rest. */
export const requestCorrelationSchema = runCorrelationSchema
  .partial({
    createdAt: true,
    updatedAt: true,
  })
  .omit({ timelineRevision: true, cutosAgentRunId: true, cutosJobId: true });
export type RequestCorrelation = z.infer<typeof requestCorrelationSchema>;

// ---------------------------------------------------------------------------
// Capability manifest
// ---------------------------------------------------------------------------

export const capabilityAccessSchema = z.enum(["read", "plan", "write"]);
export type CapabilityAccess = z.infer<typeof capabilityAccessSchema>;

export const capabilityRiskSchema = z.enum(["low", "medium", "high"]);
export type CapabilityRisk = z.infer<typeof capabilityRiskSchema>;

export const capabilityIdempotencySchema = z.enum(["none", "natural", "keyed"]);
export type CapabilityIdempotency = z.infer<typeof capabilityIdempotencySchema>;

/** Legacy v1 parameter descriptor; kept so v1 agents keep working. */
export const capabilityParamSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["string", "number", "boolean", "array", "object"]),
  required: z.boolean(),
  description: z.string().optional(),
});
export type CapabilityParam = z.infer<typeof capabilityParamSchema>;

export const capabilityDefinitionSchema = z.object({
  name: z.string().min(1).max(120),
  version: z.number().int().positive(),
  /** zh-TW first, English second — CUTOS/AIOS UIs are both zh-TW. */
  description: z.string().min(1).max(1_000),
  /** Coarse legacy flag kept for v1 clients. */
  permission: z.enum(["read", "write"]),
  access: capabilityAccessSchema,
  risk: capabilityRiskSchema,
  idempotency: capabilityIdempotencySchema,
  requiresApproval: z.boolean(),
  /** Returns a jobId/runId instead of the final answer. */
  longRunning: z.boolean(),
  /** Mutates the timeline → caller must send expectedRevision. */
  mutatesTimeline: z.boolean(),
  /** Suggested client timeout in ms. */
  timeoutHintMs: z.number().int().positive(),
  /** JSON-Schema-shaped descriptors (structural, not executable). */
  inputSchema: z.record(z.string(), z.unknown()),
  outputSchema: z.record(z.string(), z.unknown()),
  /** Legacy v1 params view. */
  params: z.array(capabilityParamSchema),
});
export type CapabilityDefinition = z.infer<typeof capabilityDefinitionSchema>;

export const capabilityManifestSchema = z.object({
  protocolVersion: protocolVersionSchema,
  supportedProtocols: z.array(z.string().min(1)).min(1),
  agent: z.literal("cutos"),
  displayName: z.string().min(1),
  /** Bumped whenever the capability set changes. */
  manifestVersion: z.number().int().positive(),
  serverVersion: z.string().min(1),
  /** Optional feature switches, e.g. "semantic", "idempotency", "approval". */
  features: z.array(z.string().min(1)),
  capabilities: z.array(capabilityDefinitionSchema).min(1),
  /** Free-form provider/runtime info for status surfaces. */
  provider: z.unknown().optional(),
  /** Legacy v1 alias of protocolVersion. */
  protocol: z.string().min(1),
  /** Legacy v1 numeric version. */
  version: z.number().int().positive(),
});
export type CapabilityManifest = z.infer<typeof capabilityManifestSchema>;

// ---------------------------------------------------------------------------
// Activity events
// ---------------------------------------------------------------------------

export const activityKindSchema = z.enum([
  "analyze",
  "transcript",
  "semantic_index",
  "semantic_search",
  "speakers",
  "topics",
  "highlights",
  "scene",
  "context",
  "plan",
  "verify",
  "preview",
  "approval",
  "apply",
  "undo",
  "redo",
  "export",
  "job",
  "run",
  "cancel",
]);
export type ActivityKind = z.infer<typeof activityKindSchema>;

export const activityStatusSchema = z.enum([
  "started",
  "progress",
  "waiting_approval",
  "waiting_external",
  "completed",
  "failed",
  "cancelled",
]);
export type ActivityStatus = z.infer<typeof activityStatusSchema>;

/**
 * One user-presentable activity record. `messageKey` is a stable i18n key —
 * the payload never carries hidden chain-of-thought, and never raw transcript.
 */
export const activityEventSchema = z.object({
  id: id(),
  timestamp: isoDate,

  aiosRunId: id().optional(),
  aiosStepId: id().optional(),
  cutosAgentRunId: id().optional(),
  cutosJobId: id().optional(),

  projectId: id(),

  kind: activityKindSchema,
  status: activityStatusSchema,

  /** i18n key rendered in zh-TW by both UIs, e.g. "activity.analyze.started". */
  messageKey: z.string().min(1).max(200),
  /** Bounded scalar metadata only (counts, ms, ratios) — never free text bodies. */
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
});
export type AgentActivityEvent = z.infer<typeof activityEventSchema>;

// ---------------------------------------------------------------------------
// Approval
// ---------------------------------------------------------------------------

export const approvalRequestSchema = z.object({
  id: id(),
  projectId: id(),
  capability: z.string().min(1),
  /** Stable policy reason code, e.g. "removes_more_than_30_percent". */
  reasonCode: z.string().min(1).max(120),
  messageKey: z.string().min(1).max(200),
  risk: capabilityRiskSchema,
  impact: z.object({
    sourceDurationMs: z.number().int().nonnegative(),
    estimatedDurationMs: z.number().int().nonnegative(),
    removedMs: z.number().int().nonnegative(),
    addedMs: z.number().int().nonnegative(),
    /** Fraction of the source that survives, 0..1. */
    keptRatio: z.number().min(0).max(1),
    /** Fraction of the source removed, 0..1. */
    removedRatio: z.number().min(0).max(1),
    operationCount: z.number().int().nonnegative(),
    deleteOperationCount: z.number().int().nonnegative(),
  }),
  requestedAt: isoDate,
  correlation: runCorrelationSchema,
});
export type ApprovalRequest = z.infer<typeof approvalRequestSchema>;

// ---------------------------------------------------------------------------
// Capability invocation / result
// ---------------------------------------------------------------------------

export const capabilityInvocationSchema = z.object({
  protocolVersion: protocolVersionSchema,
  capability: z.string().min(1).max(120),
  args: z.record(z.string(), z.unknown()).default({}),
  correlation: requestCorrelationSchema,
  /** Mutation guard. Required by capabilities with mutatesTimeline=true. */
  expectedRevision: z.number().int().nonnegative().optional(),
  /** Caller-declared approval decision for capabilities requiring it. */
  approval: z
    .object({
      approvalId: id().optional(),
      granted: z.boolean(),
      /** Who granted it on the AIOS side (user id / role), for the audit trail. */
      grantedBy: z.string().min(1).max(200).optional(),
      grantedAt: isoDate.optional(),
    })
    .optional(),
});
export type CapabilityInvocation = z.infer<typeof capabilityInvocationSchema>;

export const capabilityResultSchema = z.object({
  protocolVersion: protocolVersionSchema,
  capability: z.string().min(1),
  ok: z.literal(true),
  result: z.unknown(),
  correlation: runCorrelationSchema,
  activity: z.array(activityEventSchema).default([]),
  /** Present when the capability needs human approval before it will act. */
  approvalRequest: approvalRequestSchema.optional(),
  /** True when a stored idempotent result was replayed instead of re-executing. */
  replayed: z.boolean().default(false),
});
export type CapabilityResult = z.infer<typeof capabilityResultSchema>;

export const capabilityFailureSchema = z.object({
  protocolVersion: protocolVersionSchema,
  capability: z.string().min(1),
  ok: z.literal(false),
  error: cutosErrorSchema,
  correlation: runCorrelationSchema,
  activity: z.array(activityEventSchema).default([]),
  approvalRequest: approvalRequestSchema.optional(),
});
export type CapabilityFailure = z.infer<typeof capabilityFailureSchema>;

export const capabilityResponseSchema = z.union([
  capabilityResultSchema,
  capabilityFailureSchema,
]);
export type CapabilityResponse = z.infer<typeof capabilityResponseSchema>;

// ---------------------------------------------------------------------------
// AIOS-side tool envelope (AIOS ToolRegistry ↔ CUTOS adapter)
// ---------------------------------------------------------------------------

export const cutosToolRequestSchema = z.object({
  protocolVersion: protocolVersionSchema,
  /** AIOS tool id, e.g. "cutos.semantic.search". */
  toolId: z.string().min(1).max(120),
  /** CUTOS capability the tool maps to. */
  capability: z.string().min(1).max(120),
  input: z.record(z.string(), z.unknown()),
  correlation: requestCorrelationSchema,
  expectedRevision: z.number().int().nonnegative().optional(),
});
export type CutosToolRequest = z.infer<typeof cutosToolRequestSchema>;

export const cutosToolResultSchema = z.object({
  protocolVersion: protocolVersionSchema,
  toolId: z.string().min(1),
  capability: z.string().min(1),
  ok: z.boolean(),
  output: z.unknown().optional(),
  error: cutosErrorSchema.optional(),
  correlation: runCorrelationSchema,
  activity: z.array(activityEventSchema).default([]),
  /** Evidence reference recorded on the AIOS run ledger. */
  evidenceRef: z.string().min(1).max(400),
});
export type CutosToolResult = z.infer<typeof cutosToolResultSchema>;

// ---------------------------------------------------------------------------
// Project binding (AIOS project ↔ CUTOS project)
// ---------------------------------------------------------------------------

export const projectBindingSchema = z.object({
  id: id(),
  userId: id(),
  groupId: id(),
  aiosProjectId: id(),
  cutosProjectId: id(),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type ProjectBinding = z.infer<typeof projectBindingSchema>;

// ---------------------------------------------------------------------------
// Bounded semantic context (CUTOS retrieval → AIOS)
// ---------------------------------------------------------------------------

export const transcriptRangeSchema = z.object({
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  text: z.string(),
  speaker: z.string().nullable(),
  score: z.number(),
  sentenceIds: z.array(z.string().min(1)),
});
export type TranscriptRange = z.infer<typeof transcriptRangeSchema>;

export const topicRefSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  weight: z.number(),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  sentenceCount: z.number().int().nonnegative(),
});
export type TopicRef = z.infer<typeof topicRefSchema>;

export const speakerRefSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  speakingMs: z.number().int().nonnegative(),
  sentenceCount: z.number().int().nonnegative(),
});
export type SpeakerRef = z.infer<typeof speakerRefSchema>;

export const highlightRefSchema = z.object({
  id: z.string().min(1),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  score: z.number(),
  reasonCode: z.string().min(1),
  topicIds: z.array(z.string().min(1)),
  speaker: z.string().nullable(),
  /** Short excerpt only — the full transcript stays in CUTOS. */
  excerpt: z.string().max(400),
});
export type HighlightRef = z.infer<typeof highlightRefSchema>;

/**
 * The ONLY transcript-derived payload that leaves CUTOS by default. It is
 * bounded, deterministic, deduplicated and carries provenance; a full
 * transcript is never sent unless a caller explicitly asks for get_transcript.
 */
export const cutosSemanticContextSchema = z.object({
  protocolVersion: protocolVersionSchema,
  projectId: id(),
  timelineRevision: z.number().int().nonnegative(),
  query: z.string().max(2_000),
  topics: z.array(topicRefSchema),
  speakers: z.array(speakerRefSchema),
  ranges: z.array(transcriptRangeSchema),
  highlights: z.array(highlightRefSchema),
  provenance: z.object({
    capability: z.string().min(1),
    requestId: id(),
    generatedAt: isoDate,
    analysisVersion: z.number().int().positive(),
    mediaChecksum: z.string().min(1),
    /** Deterministic hash of (query, revision, index) → same input, same context. */
    contextHash: z.string().min(1),
  }),
  budget: z.object({
    maxRanges: z.number().int().positive(),
    maxChars: z.number().int().positive(),
    usedRanges: z.number().int().nonnegative(),
    usedChars: z.number().int().nonnegative(),
    truncated: z.boolean(),
  }),
});
export type CutosSemanticContext = z.infer<typeof cutosSemanticContextSchema>;

// ---------------------------------------------------------------------------
// AIOS run orchestration (CUTOS → AIOS direction)
// ---------------------------------------------------------------------------

export const qualityProfileSchema = z.enum(["fast", "balanced", "quality", "local"]);
export type QualityProfile = z.infer<typeof qualityProfileSchema>;

/**
 * CUTOS asks AIOS to run a goal. CUTOS states WHAT it needs (capability,
 * quality profile, deadline) and never WHICH vendor — model routing is an AIOS
 * decision, so no vendor conditionals leak into CUTOS.
 */
/**
 * Correlation for a CUTOS-initiated run.
 *
 * Not `requestCorrelationSchema`: that one describes AIOS calling CUTOS, so it
 * omits the ids CUTOS fills in. Here CUTOS is the caller and legitimately
 * declares its own `cutosAgentRunId`/`cutosJobId` — without them the
 * `aiosRunId ↔ cutosAgentRunId ↔ cutosJobId ↔ timelineRevision` chain has no
 * link at all in this direction. `timelineRevision` stays omitted because it is
 * an outcome of the work, not an input to it; state the revision you are acting
 * on in `expectedRevision`.
 */
export const aiosRunCorrelationSchema = runCorrelationSchema
  .partial({
    createdAt: true,
    updatedAt: true,
  })
  .omit({ timelineRevision: true });
export type AiosRunCorrelation = z.infer<typeof aiosRunCorrelationSchema>;

export const aiosRunRequestSchema = z.object({
  protocolVersion: protocolVersionSchema,
  goal: z.string().min(1).max(4_000),
  /** Abstract capability being requested of AIOS, e.g. "video.edit.plan". */
  capability: z.string().min(1).max(120),
  qualityProfile: qualityProfileSchema,
  deadlineMs: z.number().int().positive().optional(),
  context: cutosSemanticContextSchema.optional(),
  correlation: aiosRunCorrelationSchema,
});
export type AiosRunRequest = z.infer<typeof aiosRunRequestSchema>;

export const aiosRunStatusSchema = z.enum([
  "queued",
  "running",
  "waiting_approval",
  "waiting_external",
  "completed",
  "failed",
  "cancelled",
]);
export type AiosRunStatus = z.infer<typeof aiosRunStatusSchema>;

export const aiosRunStepSchema = z.object({
  id: id(),
  kind: z.string().min(1),
  status: z.enum(["pending", "running", "waiting", "done", "failed", "stopped"]),
  messageKey: z.string().min(1).max(200),
  dependsOn: z.array(z.string().min(1)).default([]),
  cutosJobId: id().optional(),
  cutosAgentRunId: id().optional(),
});
export type AiosRunStep = z.infer<typeof aiosRunStepSchema>;

export const aiosRunStateSchema = z.object({
  protocolVersion: protocolVersionSchema,
  aiosRunId: id(),
  status: aiosRunStatusSchema,
  steps: z.array(aiosRunStepSchema).default([]),
  /** Provider-neutral result payload; CUTOS validates it before use. */
  result: z.unknown().optional(),
  error: cutosErrorSchema.optional(),
  correlation: runCorrelationSchema,
  updatedAt: isoDate,
});
export type AiosRunState = z.infer<typeof aiosRunStateSchema>;

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export const cutosHealthSchema = z.object({
  protocolVersion: protocolVersionSchema,
  supportedProtocols: z.array(z.string().min(1)).min(1),
  manifestVersion: z.number().int().positive(),
  serverVersion: z.string().min(1),
  features: z.array(z.string().min(1)),
  reachable: z.boolean(),
  latencyMs: z.number().nonnegative().optional(),
  /** Inbound AIOS kernel status, when CUTOS is configured to use one. */
  kernel: z
    .object({
      configured: z.boolean(),
      reachable: z.boolean().optional(),
      endpoint: z.string().optional(),
      latencyMs: z.number().nonnegative().optional(),
    })
    .optional(),
});
export type CutosHealth = z.infer<typeof cutosHealthSchema>;

// ---------------------------------------------------------------------------
// Legacy v1 shapes (kept working; do not extend)
// ---------------------------------------------------------------------------

export const legacyInvokeRequestSchema = z.object({
  name: z.string().min(1),
  args: z.record(z.string(), z.unknown()).default({}),
});
export type LegacyInvokeRequest = z.infer<typeof legacyInvokeRequestSchema>;

export const legacyInvokeResponseSchema = z.object({
  capability: z.string().min(1),
  result: z.unknown(),
});
export type LegacyInvokeResponse = z.infer<typeof legacyInvokeResponseSchema>;

// ---------------------------------------------------------------------------
// Contract fingerprint (cross-repo drift detection)
// ---------------------------------------------------------------------------

/**
 * Hand-maintained structural descriptor of the wire contract. It intentionally
 * does NOT introspect Zod internals: those change between zod patch releases
 * and would make the fingerprint unstable for reasons unrelated to the wire.
 */
export const PROTOCOL_CONTRACT = {
  version: CUTOS_PROTOCOL_VERSION,
  supported: [...CUTOS_SUPPORTED_PROTOCOLS],
  errorCodes: [...CUTOS_ERROR_CODES],
  retryableErrorCodes: [...CUTOS_RETRYABLE_ERROR_CODES],
  schemas: {
    runCorrelation: [
      "requestId", "idempotencyKey", "aiosRunId", "aiosStepId", "cutosAgentRunId",
      "cutosJobId", "aiosProjectId", "cutosProjectId", "timelineRevision",
      "expectedRevision", "traceId", "createdAt", "updatedAt",
    ],
    capabilityDefinition: [
      "name", "version", "description", "permission", "access", "risk",
      "idempotency", "requiresApproval", "longRunning", "mutatesTimeline",
      "timeoutHintMs", "inputSchema", "outputSchema", "params",
    ],
    capabilityManifest: [
      "protocolVersion", "supportedProtocols", "agent", "displayName",
      "manifestVersion", "serverVersion", "features", "capabilities",
      "provider", "protocol", "version",
    ],
    capabilityInvocation: [
      "protocolVersion", "capability", "args", "correlation",
      "expectedRevision", "approval",
    ],
    capabilityResult: [
      "protocolVersion", "capability", "ok", "result", "correlation",
      "activity", "approvalRequest", "replayed",
    ],
    capabilityFailure: [
      "protocolVersion", "capability", "ok", "error", "correlation",
      "activity", "approvalRequest",
    ],
    cutosError: ["code", "message", "messageKey", "retryable", "details"],
    activityEvent: [
      "id", "timestamp", "aiosRunId", "aiosStepId", "cutosAgentRunId",
      "cutosJobId", "projectId", "kind", "status", "messageKey", "metadata",
    ],
    activityKinds: [
      "analyze", "transcript", "semantic_index", "semantic_search", "speakers",
      "topics", "highlights", "scene", "context", "plan", "verify", "preview",
      "approval", "apply", "undo", "redo", "export", "job", "run", "cancel",
    ],
    activityStatuses: [
      "started", "progress", "waiting_approval", "waiting_external",
      "completed", "failed", "cancelled",
    ],
    approvalRequest: [
      "id", "projectId", "capability", "reasonCode", "messageKey", "risk",
      "impact", "requestedAt", "correlation",
    ],
    approvalImpact: [
      "sourceDurationMs", "estimatedDurationMs", "removedMs", "addedMs",
      "keptRatio", "removedRatio", "operationCount", "deleteOperationCount",
    ],
    cutosToolRequest: [
      "protocolVersion", "toolId", "capability", "input", "correlation",
      "expectedRevision",
    ],
    cutosToolResult: [
      "protocolVersion", "toolId", "capability", "ok", "output", "error",
      "correlation", "activity", "evidenceRef",
    ],
    projectBinding: [
      "id", "userId", "groupId", "aiosProjectId", "cutosProjectId",
      "createdAt", "updatedAt",
    ],
    semanticContext: [
      "protocolVersion", "projectId", "timelineRevision", "query", "topics",
      "speakers", "ranges", "highlights", "provenance", "budget",
    ],
    semanticProvenance: [
      "capability", "requestId", "generatedAt", "analysisVersion",
      "mediaChecksum", "contextHash",
    ],
    semanticBudget: [
      "maxRanges", "maxChars", "usedRanges", "usedChars", "truncated",
    ],
    transcriptRange: ["startMs", "endMs", "text", "speaker", "score", "sentenceIds"],
    topicRef: ["id", "label", "weight", "startMs", "endMs", "sentenceCount"],
    speakerRef: ["id", "label", "speakingMs", "sentenceCount"],
    highlightRef: ["id", "startMs", "endMs", "score", "reasonCode", "topicIds", "speaker", "excerpt"],
    aiosRunRequest: [
      "protocolVersion", "goal", "capability", "qualityProfile", "deadlineMs",
      "context", "correlation",
    ],
    aiosRunCorrelation: [
      "requestId", "idempotencyKey", "aiosRunId", "aiosStepId", "cutosAgentRunId",
      "cutosJobId", "aiosProjectId", "cutosProjectId", "expectedRevision",
      "traceId", "createdAt", "updatedAt",
    ],
    aiosRunState: [
      "protocolVersion", "aiosRunId", "status", "steps", "result", "error",
      "correlation", "updatedAt",
    ],
    aiosRunStep: [
      "id", "kind", "status", "messageKey", "dependsOn", "cutosJobId",
      "cutosAgentRunId",
    ],
    aiosRunStatuses: [
      "queued", "running", "waiting_approval", "waiting_external",
      "completed", "failed", "cancelled",
    ],
    qualityProfiles: ["fast", "balanced", "quality", "local"],
    health: [
      "protocolVersion", "supportedProtocols", "manifestVersion",
      "serverVersion", "features", "reachable", "latencyMs", "kernel",
    ],
    legacyInvokeRequest: ["name", "args"],
    legacyInvokeResponse: ["capability", "result"],
  },
  /** Capability names both repos agree must exist in a v2 manifest. */
  requiredCapabilities: [
    "apply_edit_plan",
    "cancel_agent_run",
    "cancel_job",
    "create_edit_plan",
    "export",
    "find_highlights",
    "get_agent_run",
    "get_context_range",
    "get_job",
    "get_project",
    "get_transcript",
    "inspect_scene",
    "list_projects",
    "list_speakers",
    "list_topics",
    "preview_edit_plan",
    "redo",
    "resume_agent_run",
    "retry_job",
    "search_semantic",
    "search_transcript",
    "undo",
    "verify_edit_plan",
  ],
  /** HTTP surface CUTOS must expose. */
  endpoints: {
    manifest: "GET /api/aios/manifest",
    invoke: "POST /api/aios/invoke",
    health: "GET /api/aios/health",
  },
  /**
   * HTTP surface AIOS must expose for the CUTOS → AIOS direction.
   *
   * This was the half of the contract nobody could check: CUTOS shipped an
   * orchestrator client for these paths while AIOS served none of them, and no
   * test could notice because the contract only described CUTOS's side. Listing
   * them here makes the omission a fingerprint change rather than a silent
   * runtime 404.
   */
  aiosEndpoints: {
    submitRun: "POST /api/cutos/runs",
    getRun: "GET /api/cutos/runs/:runId",
    cancelRun: "POST /api/cutos/runs/:runId/cancel",
    resumeRun: "POST /api/cutos/runs/:runId/resume",
    health: "GET /api/cutos/health",
  },
  /**
   * Scenarios the recorded contract fixture must contain to be usable.
   *
   * It lives here, in the mirrored file, because the completeness of that
   * artifact is a property of the CONTRACT, not of either test. Previously the
   * recorder wrote whatever a run happened to capture — an ffmpeg-less machine
   * or a `-t`-filtered run produced a green suite and a fixture holding one
   * scenario instead of 23 — while the required list lived only in the
   * consuming repo, which discovered the loss a copy-paste later.
   */
  contractScenarios: [
    "apply_plan",
    "approval_required",
    "cancel_job",
    "capability_not_found",
    "create_plan",
    "health",
    "idempotent_replay",
    "job_polling",
    "manifest",
    "preview_plan",
    "protocol_mismatch",
    "read_capability",
    "semantic_search",
    "stale_revision",
    "unauthorized",
    "v1_compatibility",
    "validation_failed",
  ],
  /**
   * Abstract capabilities AIOS orchestrates on CUTOS's behalf. An allow-list,
   * exactly like the CUTOS manifest: CUTOS states an intent, never a step list.
   */
  aiosCapabilities: [
    "video.edit.plan",
    "video.export",
    "video.highlight.package",
    "video.timeline.update",
  ],
} as const;

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** SHA-256 of the canonical contract descriptor. Asserted in BOTH repos. */
export function protocolContractFingerprint(): string {
  return createHash("sha256").update(stableStringify(PROTOCOL_CONTRACT)).digest("hex");
}

/**
 * The agreed fingerprint. When you intentionally change the contract you must
 * update this constant IN BOTH REPOSITORIES in the same change set.
 */
export const PROTOCOL_CONTRACT_FINGERPRINT =
  "63168dcf9a648776eda4e34f61a2028c7fc1041b738d3428120366a2259a3775";

// ---------------------------------------------------------------------------
// Helpers shared by both repos
// ---------------------------------------------------------------------------

export function isCapabilityFailure(
  response: CapabilityResponse,
): response is CapabilityFailure {
  return response.ok === false;
}

/**
 * Canonical, server-independent idempotency key for one logical CUTOS effect.
 * Both repos derive it the same way so a retry from AIOS lands on the same
 * CUTOS record even after either process restarted.
 */
export function cutosIdempotencyKey(input: {
  aiosRunId: string;
  aiosStepId: string;
  capability: string;
  cutosProjectId: string;
  /** Stable hash of the semantic arguments (not the requestId). */
  argsFingerprint: string;
}): string {
  return [
    "cutos.v2",
    input.aiosRunId,
    input.aiosStepId,
    input.capability,
    input.cutosProjectId,
    input.argsFingerprint,
  ].join(":");
}

/** Stable hash of capability arguments; used inside {@link cutosIdempotencyKey}. */
export function argsFingerprint(args: unknown): string {
  return createHash("sha256").update(stableStringify(args)).digest("hex").slice(0, 32);
}
