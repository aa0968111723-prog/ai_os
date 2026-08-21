import { randomUUID } from "node:crypto";
import {
  CUTOS_PROTOCOL_VERSION,
  CUTOS_SUPPORTED_PROTOCOLS,
  argsFingerprint,
  capabilityManifestSchema,
  capabilityResponseSchema,
  checkProtocolCompatibility,
  cutosHealthSchema,
  cutosIdempotencyKey,
  isCapabilityFailure,
  isRetryableCutosError,
  type CapabilityDefinition,
  type CapabilityManifest,
  type CapabilityResponse,
  type CapabilityResult,
  type CutosError,
  type CutosErrorCode,
  type CutosHealth,
  type RequestCorrelation,
  type RunCorrelation,
} from "../../shared/cutosProtocol";

/**
 * The single typed door between AIOS and CUTOS.
 *
 * Every CUTOS HTTP call in this repository goes through this client — there is
 * deliberately no `fetch(url, JSON.stringify(anything))` scattered across
 * services. Concentrating it here is what makes the cross-cutting requirements
 * enforceable rather than aspirational:
 *
 *   timeout · AbortSignal · bounded retry · auth · protocol validation ·
 *   sanitized errors · requestId · idempotencyKey · expectedRevision ·
 *   trace correlation
 *
 * Responses are parsed with the mirrored `shared/cutosProtocol` schemas before
 * anything reaches the agent runtime. A CUTOS reply is untrusted external input
 * until it has passed that gate.
 */

export interface CutosClientConfig {
  baseUrl: string;
  apiKey?: string | undefined;
  timeoutMs?: number;
  /** Attempts for transient transport failures only. */
  maxAttempts?: number;
  retryBaseDelayMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** Distributed trace id attached to every request. */
  traceId?: string | undefined;
}

/** A CUTOS failure carrying the protocol's stable code and zh-TW message key. */
export class CutosClientError extends Error {
  readonly code: CutosErrorCode;
  readonly messageKey: string;
  readonly retryable: boolean;
  readonly status?: number;
  readonly details?: Record<string, string | number | boolean>;
  readonly correlation?: RunCorrelation;

  constructor(input: {
    code: CutosErrorCode;
    message: string;
    messageKey?: string;
    retryable?: boolean;
    status?: number;
    details?: Record<string, string | number | boolean>;
    correlation?: RunCorrelation;
  }) {
    super(input.message);
    this.name = "CutosClientError";
    this.code = input.code;
    this.messageKey = input.messageKey ?? `aios.error.${input.code.toLowerCase()}`;
    this.retryable = input.retryable ?? isRetryableCutosError(input.code);
    if (input.status !== undefined) this.status = input.status;
    if (input.details) this.details = input.details;
    if (input.correlation) this.correlation = input.correlation;
  }

  static fromProtocol(error: CutosError, correlation?: RunCorrelation): CutosClientError {
    return new CutosClientError({
      code: error.code,
      message: error.message,
      messageKey: error.messageKey,
      retryable: error.retryable,
      ...(error.details ? { details: error.details } : {}),
      ...(correlation ? { correlation } : {}),
    });
  }
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const MAX_ERROR_MESSAGE = 500;

/** Never re-throw a peer's raw body: bound it and strip anything credential-shaped. */
function sanitize(text: string): string {
  return text
    .replace(/bearer\s+[A-Za-z0-9._~+/-]{8,}/gi, "bearer [REDACTED]")
    .replace(/\b(api[_-]?key|token|secret|password)=\S+/gi, "$1=[REDACTED]")
    .slice(0, MAX_ERROR_MESSAGE);
}

function statusToCode(status: number): CutosErrorCode {
  if (status === 401) return "UNAUTHORIZED";
  if (status === 403) return "FORBIDDEN_PROJECT_SCOPE";
  if (status === 404) return "CAPABILITY_NOT_FOUND";
  if (status === 408 || status === 504) return "TIMEOUT";
  if (status === 409) return "IDEMPOTENCY_CONFLICT";
  if (status === 400 || status === 422) return "VALIDATION_FAILED";
  if (status >= 500) return "UNAVAILABLE";
  return "INTERNAL";
}

export interface InvokeOptions {
  /** Correlation the caller already owns (run/step/project ids). */
  correlation: Omit<RequestCorrelation, "requestId"> & { requestId?: string };
  /** Required for timeline mutations; CUTOS refuses the call without it. */
  expectedRevision?: number | undefined;
  approval?: { approvalId?: string; granted: boolean; grantedBy?: string; grantedAt?: string };
  signal?: AbortSignal | undefined;
  timeoutMs?: number | undefined;
}

export interface CutosInvokeOutcome<T = unknown> {
  result: T;
  correlation: RunCorrelation;
  activity: CapabilityResult["activity"];
  replayed: boolean;
  approvalRequest: CapabilityResult["approvalRequest"];
}

export class CutosClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly retryBaseDelayMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private manifestCache: { at: number; manifest: CapabilityManifest } | undefined;

  constructor(private readonly config: CutosClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.timeoutMs = config.timeoutMs ?? 20_000;
    this.maxAttempts = Math.max(1, config.maxAttempts ?? 3);
    this.retryBaseDelayMs = config.retryBaseDelayMs ?? 200;
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.now = config.now ?? (() => Date.now());
  }

  // ------------------------------------------------------------- transport --

  private async request(
    path: string,
    init: { method: string; body?: unknown },
    options: { signal?: AbortSignal | undefined; timeoutMs?: number | undefined } = {},
  ): Promise<unknown> {
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    let lastError: CutosClientError | undefined;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const onAbort = () => controller.abort();
      options.signal?.addEventListener("abort", onAbort, { once: true });
      try {
        const headers: Record<string, string> = {
          accept: "application/json",
          "x-aios-protocol": CUTOS_PROTOCOL_VERSION,
        };
        if (init.body !== undefined) headers["content-type"] = "application/json";
        if (this.config.apiKey) headers.authorization = `Bearer ${this.config.apiKey}`;
        if (this.config.traceId) headers["x-trace-id"] = this.config.traceId;

        const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
          method: init.method,
          headers,
          ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
          signal: controller.signal,
        });

        const text = await response.text();
        const payload = text ? safeJson(text) : {};
        if (response.ok) return payload;

        const error = new CutosClientError({
          code: statusToCode(response.status),
          message: sanitize(extractMessage(payload) ?? `CUTOS returned ${response.status}`),
          status: response.status,
        });
        if (!RETRYABLE_STATUS.has(response.status) || attempt === this.maxAttempts) throw error;
        lastError = error;
      } catch (error) {
        if (error instanceof CutosClientError) {
          if (attempt === this.maxAttempts) throw error;
          lastError = error;
        } else if (options.signal?.aborted) {
          // The caller cancelled: not a CUTOS failure, and never retried.
          throw new CutosClientError({ code: "CANCELLED", message: "CUTOS request cancelled" });
        } else if (isAbortError(error)) {
          const timeout = new CutosClientError({ code: "TIMEOUT", message: "CUTOS request timed out" });
          if (attempt === this.maxAttempts) throw timeout;
          lastError = timeout;
        } else {
          const unavailable = new CutosClientError({
            code: "UNAVAILABLE",
            message: "CUTOS is unreachable",
          });
          if (attempt === this.maxAttempts) throw unavailable;
          lastError = unavailable;
        }
      } finally {
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", onAbort);
      }
      await sleep(this.retryBaseDelayMs * 2 ** (attempt - 1));
    }
    throw lastError ?? new CutosClientError({ code: "INTERNAL", message: "CUTOS request failed" });
  }

  // -------------------------------------------------------------- discovery --

  /** Fetch and validate the capability manifest, checking protocol compatibility. */
  async getManifest(options: { signal?: AbortSignal; force?: boolean } = {}): Promise<CapabilityManifest> {
    const cached = this.manifestCache;
    if (!options.force && cached && this.now() - cached.at < 60_000) return cached.manifest;

    const payload = await this.request("/api/aios/manifest", { method: "GET" }, {
      ...(options.signal ? { signal: options.signal } : {}),
    });
    const parsed = capabilityManifestSchema.safeParse(payload);
    if (!parsed.success) {
      // Distinguish "we cannot speak to this CUTOS" from "this CUTOS is broken".
      const declared = (payload as { protocolVersion?: unknown } | null)?.protocolVersion;
      if (typeof declared === "string") {
        const compatibility = checkProtocolCompatibility(declared, [], CUTOS_SUPPORTED_PROTOCOLS);
        if (!compatibility.compatible) {
          throw new CutosClientError({
            code: "PROTOCOL_VERSION_MISMATCH",
            message: `CUTOS speaks ${declared}; AIOS speaks ${CUTOS_SUPPORTED_PROTOCOLS.join(", ")}`,
            messageKey: "aios.protocol.mismatch",
          });
        }
      }
      throw new CutosClientError({
        code: "VALIDATION_FAILED",
        message: `CUTOS returned a malformed manifest: ${parsed.error.issues
          .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
          .slice(0, 5)
          .join("; ")}`,
      });
    }

    const compatibility = checkProtocolCompatibility(
      parsed.data.protocolVersion,
      parsed.data.supportedProtocols,
      CUTOS_SUPPORTED_PROTOCOLS,
    );
    if (!compatibility.compatible) {
      // No silent fallback: an incompatible peer is a hard, visible failure.
      throw new CutosClientError({
        code: "PROTOCOL_VERSION_MISMATCH",
        message: compatibility.detail ?? "Incompatible CUTOS protocol version",
        messageKey: compatibility.messageKey ?? "aios.protocol.mismatch",
      });
    }

    this.manifestCache = { at: this.now(), manifest: parsed.data };
    return parsed.data;
  }

  async getCapability(name: string): Promise<CapabilityDefinition | undefined> {
    return (await this.getManifest()).capabilities.find((capability) => capability.name === name);
  }

  /** Health for the status surface. Never throws: an outage is a state, not a crash. */
  async getHealth(options: { signal?: AbortSignal } = {}): Promise<
    CutosHealth & { compatible: boolean; messageKey: string; latencyMs: number }
  > {
    const started = this.now();
    try {
      const payload = await this.request("/api/aios/health", { method: "GET" }, {
        ...(options.signal ? { signal: options.signal } : {}),
        timeoutMs: Math.min(this.timeoutMs, 5_000),
      });
      const parsed = cutosHealthSchema.safeParse(payload);
      if (!parsed.success) {
        return {
          protocolVersion: CUTOS_PROTOCOL_VERSION,
          supportedProtocols: [...CUTOS_SUPPORTED_PROTOCOLS],
          manifestVersion: 0,
          serverVersion: "unknown",
          features: [],
          reachable: true,
          compatible: false,
          messageKey: "aios.protocol.mismatch",
          latencyMs: this.now() - started,
        };
      }
      const compatibility = checkProtocolCompatibility(
        parsed.data.protocolVersion,
        parsed.data.supportedProtocols,
        CUTOS_SUPPORTED_PROTOCOLS,
      );
      return {
        ...parsed.data,
        compatible: compatibility.compatible,
        messageKey: compatibility.compatible ? "cutos.status.connected" : "aios.protocol.mismatch",
        latencyMs: this.now() - started,
      };
    } catch {
      return {
        protocolVersion: CUTOS_PROTOCOL_VERSION,
        supportedProtocols: [...CUTOS_SUPPORTED_PROTOCOLS],
        manifestVersion: 0,
        serverVersion: "unknown",
        features: [],
        reachable: false,
        compatible: false,
        messageKey: "cutos.status.disconnected",
        latencyMs: this.now() - started,
      };
    }
  }

  // ------------------------------------------------------------- invocation --

  private async invoke<T>(
    capability: string,
    args: Record<string, unknown>,
    options: InvokeOptions,
  ): Promise<CutosInvokeOutcome<T>> {
    const requestId = options.correlation.requestId ?? randomUUID();
    const correlation: RequestCorrelation = {
      ...options.correlation,
      requestId,
      ...(this.config.traceId ? { traceId: this.config.traceId } : {}),
    };

    const payload = await this.request(
      "/api/aios/invoke",
      {
        method: "POST",
        body: {
          protocolVersion: CUTOS_PROTOCOL_VERSION,
          capability,
          args,
          correlation,
          ...(options.expectedRevision === undefined
            ? {}
            : { expectedRevision: options.expectedRevision }),
          ...(options.approval ? { approval: options.approval } : {}),
        },
      },
      {
        ...(options.signal ? { signal: options.signal } : {}),
        ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      },
    );

    const parsed = capabilityResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new CutosClientError({
        code: "VALIDATION_FAILED",
        message: `CUTOS returned a malformed response for ${capability}: ${parsed.error.issues
          .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
          .slice(0, 5)
          .join("; ")}`,
      });
    }

    const response: CapabilityResponse = parsed.data;
    if (isCapabilityFailure(response)) {
      const error = CutosClientError.fromProtocol(response.error, response.correlation);
      // An approval request is data the caller must surface, not a bare error.
      if (response.approvalRequest) {
        throw Object.assign(error, { approvalRequest: response.approvalRequest });
      }
      throw error;
    }

    return {
      result: response.result as T,
      correlation: response.correlation,
      activity: response.activity,
      replayed: response.replayed,
      approvalRequest: response.approvalRequest,
    };
  }

  /**
   * Read capability. Reads are naturally idempotent, so no key is required and
   * the transport retry is safe.
   */
  async invokeRead<T = unknown>(
    capability: string,
    args: Record<string, unknown>,
    options: InvokeOptions,
  ): Promise<CutosInvokeOutcome<T>> {
    return this.invoke<T>(capability, args, options);
  }

  /**
   * Write capability. An idempotency key is mandatory: without it a transport
   * retry could apply the same edit twice, which is the exact failure this
   * integration exists to prevent.
   */
  async invokeWrite<T = unknown>(
    capability: string,
    args: Record<string, unknown>,
    options: InvokeOptions,
  ): Promise<CutosInvokeOutcome<T>> {
    if (!options.correlation.idempotencyKey) {
      throw new CutosClientError({
        code: "VALIDATION_FAILED",
        message: `invokeWrite(${capability}) requires correlation.idempotencyKey`,
      });
    }
    return this.invoke<T>(capability, args, options);
  }

  // ------------------------------------------------------- run / job control --

  async getRun(runId: string, options: InvokeOptions) {
    return this.invokeRead<{ id: string; status: string; steps: unknown[] }>(
      "get_agent_run",
      { runId },
      options,
    );
  }

  async cancelRun(runId: string, options: InvokeOptions) {
    return this.invokeWrite<{ id: string; status: string }>("cancel_agent_run", { runId }, options);
  }

  async resumeRun(runId: string, options: InvokeOptions) {
    return this.invokeRead<{ id: string; status: string; resumable: boolean; stale: boolean }>(
      "resume_agent_run",
      { runId },
      options,
    );
  }

  async getJob(jobId: string, options: InvokeOptions) {
    return this.invokeRead<{
      id: string;
      kind: string;
      status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
      progress: number;
      stage: string | null;
      error: string | null;
    }>("get_job", { jobId }, options);
  }

  async cancelJob(jobId: string, options: InvokeOptions) {
    return this.invokeWrite<{ id: string; status: string }>("cancel_job", { jobId }, options);
  }

  async retryJob(jobId: string, options: InvokeOptions) {
    return this.invokeWrite<{ id: string; status: string }>("retry_job", { jobId }, options);
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { message: text.slice(0, MAX_ERROR_MESSAGE) };
  }
}

function extractMessage(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const record = payload as { error?: { message?: unknown }; message?: unknown };
  const candidate = record.error?.message ?? record.message;
  return typeof candidate === "string" ? candidate : undefined;
}

/** Derive the canonical idempotency key for one CUTOS write from a run step. */
export function deriveCutosIdempotencyKey(input: {
  runId: string;
  stepId: string;
  capability: string;
  cutosProjectId: string;
  args: unknown;
}): string {
  return cutosIdempotencyKey({
    aiosRunId: input.runId,
    aiosStepId: input.stepId,
    capability: input.capability,
    cutosProjectId: input.cutosProjectId,
    argsFingerprint: argsFingerprint(input.args),
  });
}

// ---------------------------------------------------------------------------
// configuration
// ---------------------------------------------------------------------------

export interface CutosEnvironmentConfig {
  configured: boolean;
  baseUrl?: string;
  apiKey?: string;
  timeoutMs: number;
  maxAttempts: number;
}

export function readCutosEnvironmentConfig(
  env: NodeJS.ProcessEnv = process.env,
): CutosEnvironmentConfig {
  const baseUrl = env.CUTOS_URL?.trim();
  const timeout = Number(env.CUTOS_TIMEOUT_MS ?? "20000");
  const attempts = Number(env.CUTOS_MAX_ATTEMPTS ?? "3");
  return {
    configured: Boolean(baseUrl),
    ...(baseUrl ? { baseUrl } : {}),
    ...(env.CUTOS_API_KEY?.trim() ? { apiKey: env.CUTOS_API_KEY.trim() } : {}),
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : 20_000,
    maxAttempts: Number.isFinite(attempts) && attempts > 0 ? Math.min(5, attempts) : 3,
  };
}

let clientOverride: CutosClient | null | undefined;

/** Test seam: inject a client, or null to simulate "CUTOS not configured". */
export function setCutosClient(client: CutosClient | null | undefined): void {
  clientOverride = client;
}

/** Warn once, not once per call: a hot loop must not become a log flood. */
let warnedAboutMissingKey = false;

export function createConfiguredCutosClient(
  env: NodeJS.ProcessEnv = process.env,
): CutosClient | null {
  if (clientOverride !== undefined) return clientOverride;
  const config = readCutosEnvironmentConfig(env);
  if (!config.configured || !config.baseUrl) return null;
  // CUTOS now fails closed without a bridge key, so a URL with no key is a
  // configuration that will produce UNAUTHORIZED on every call. Say so at
  // startup rather than letting it look like an outage at the first tool call.
  if (!config.apiKey && !warnedAboutMissingKey) {
    warnedAboutMissingKey = true;
    console.warn(
      "[cutos] CUTOS_URL is set but CUTOS_API_KEY is not. CUTOS refuses capability calls "
      + "without a bridge key, so every tool call will return UNAUTHORIZED. Set the same "
      + "value on both sides.",
    );
  }
  return new CutosClient({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    timeoutMs: config.timeoutMs,
    maxAttempts: config.maxAttempts,
  });
}

export function isCutosConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  if (clientOverride !== undefined) return clientOverride !== null;
  return readCutosEnvironmentConfig(env).configured;
}

/** Resolve the client or fail with the protocol's own error type. */
export function requireCutosClient(env: NodeJS.ProcessEnv = process.env): CutosClient {
  const client = createConfiguredCutosClient(env);
  if (!client) {
    throw new CutosClientError({
      code: "UNAVAILABLE",
      message: "CUTOS is not configured (set CUTOS_URL)",
      messageKey: "cutos.status.notConfigured",
    });
  }
  return client;
}
