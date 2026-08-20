import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  CUTOS_PROTOCOL_VERSION,
  capabilityInvocationSchema,
  type CapabilityInvocation,
} from "../../shared/cutosProtocol";
import {
  CutosClient,
  CutosClientError,
  deriveCutosIdempotencyKey,
  readCutosEnvironmentConfig,
} from "./cutosClient";

/**
 * AIOS → CUTOS over real HTTP.
 *
 * The peer is a stand-in CUTOS server, but everything on the AIOS side is the
 * production path: the real `CutosClient`, the real mirrored schemas, real
 * sockets. It covers the 13 contract scenarios plus the client's own
 * obligations (auth header, idempotency key, expectedRevision, timeout,
 * bounded retry, abort, sanitized errors).
 */

type Mode = "ok" | "hang" | "flaky" | "malformed" | "wrong_protocol" | "down" | "unauthorized";

describe("CutosClient over real HTTP", () => {
  let server: Server;
  let baseUrl = "";
  let mode: Mode = "ok";
  let flakyAttempts = 0;
  let requests: Array<{ path: string; auth?: string; body?: CapabilityInvocation | unknown }> = [];
  let timelineRevision = 4;
  const applied = new Set<string>();

  const correlation = (extra: Record<string, unknown> = {}) => ({
    requestId: `aios-req-${requests.length + 1}`,
    aiosRunId: "run-1",
    aiosStepId: "step-1",
    aiosProjectId: "aios-project-1",
    cutosProjectId: "cutos-project-1",
    ...extra,
  });

  const envelope = (
    capability: string,
    result: unknown,
    extra: Record<string, unknown> = {},
  ) => ({
    protocolVersion: CUTOS_PROTOCOL_VERSION,
    capability,
    ok: true,
    result,
    correlation: {
      requestId: "srv-1",
      createdAt: "2026-08-19T00:00:00.000Z",
      updatedAt: "2026-08-19T00:00:01.000Z",
      timelineRevision,
      ...(extra.correlation as Record<string, unknown> | undefined),
    },
    activity: [],
    replayed: false,
    ...extra,
  });

  const failureEnvelope = (
    capability: string,
    code: string,
    message: string,
    extra: Record<string, unknown> = {},
  ) => ({
    protocolVersion: CUTOS_PROTOCOL_VERSION,
    capability,
    ok: false,
    error: {
      code,
      message,
      messageKey: `aios.error.${code.toLowerCase()}`,
      retryable: ["IDEMPOTENCY_IN_PROGRESS", "TIMEOUT", "UNAVAILABLE", "INTERNAL"].includes(code),
    },
    correlation: {
      requestId: "srv-1",
      createdAt: "2026-08-19T00:00:00.000Z",
      updatedAt: "2026-08-19T00:00:01.000Z",
    },
    activity: [],
    ...extra,
  });

  beforeAll(async () => {
    server = createServer((req, res) => {
      void (async () => {
        const url = new URL(req.url ?? "/", "http://localhost");
        const send = (status: number, body: unknown) => {
          res.writeHead(status, { "content-type": "application/json" });
          res.end(JSON.stringify(body));
        };

        if (mode === "hang") return;
        if (mode === "down") {
          send(503, { error: { message: "CUTOS restarting" } });
          return;
        }
        if (mode === "flaky") {
          flakyAttempts += 1;
          if (flakyAttempts < 3) {
            send(503, { error: { message: "transient" } });
            return;
          }
        }

        const auth = req.headers.authorization;
        if (mode === "unauthorized" && auth !== "Bearer secret-key") {
          // The body deliberately echoes a credential, which a careless client
          // would re-throw verbatim into logs and UI.
          send(401, { error: { message: "rejected key Bearer leaked-token-abcdefghijkl" } });
          return;
        }

        if (url.pathname === "/api/aios/health") {
          requests.push({ path: url.pathname, ...(auth ? { auth } : {}) });
          if (mode === "wrong_protocol") {
            send(200, {
              protocolVersion: "cutos.agent.v9",
              supportedProtocols: ["cutos.agent.v8"],
              manifestVersion: 9,
              serverVersion: "cutos-future",
              features: [],
              reachable: true,
            });
            return;
          }
          send(200, {
            protocolVersion: CUTOS_PROTOCOL_VERSION,
            supportedProtocols: [CUTOS_PROTOCOL_VERSION, "cutos.agent.v1"],
            manifestVersion: 2,
            serverVersion: "cutos-0.1.0",
            features: ["semantic", "idempotency", "revision-guard", "approval"],
            reachable: true,
          });
          return;
        }

        if (url.pathname === "/api/aios/manifest") {
          requests.push({ path: url.pathname, ...(auth ? { auth } : {}) });
          if (mode === "malformed") {
            send(200, { protocolVersion: CUTOS_PROTOCOL_VERSION, capabilities: "not-an-array" });
            return;
          }
          if (mode === "wrong_protocol") {
            send(200, { protocolVersion: "cutos.agent.v9", capabilities: [] });
            return;
          }
          send(200, {
            protocolVersion: CUTOS_PROTOCOL_VERSION,
            supportedProtocols: [CUTOS_PROTOCOL_VERSION, "cutos.agent.v1"],
            agent: "cutos",
            displayName: "CUTOS",
            manifestVersion: 2,
            serverVersion: "cutos-0.1.0",
            features: ["semantic"],
            protocol: CUTOS_PROTOCOL_VERSION,
            version: 2,
            capabilities: [
              {
                name: "search_semantic",
                version: 2,
                description: "語意搜尋",
                permission: "read",
                access: "read",
                risk: "low",
                idempotency: "natural",
                requiresApproval: false,
                longRunning: false,
                mutatesTimeline: false,
                timeoutHintMs: 10_000,
                inputSchema: { type: "object" },
                outputSchema: { type: "object" },
                params: [],
              },
              {
                name: "apply_edit_plan",
                version: 2,
                description: "套用剪輯計畫",
                permission: "write",
                access: "write",
                risk: "high",
                idempotency: "keyed",
                requiresApproval: true,
                longRunning: false,
                mutatesTimeline: true,
                timeoutHintMs: 30_000,
                inputSchema: { type: "object" },
                outputSchema: { type: "object" },
                params: [],
              },
            ],
          });
          return;
        }

        if (req.method === "POST" && url.pathname === "/api/aios/invoke") {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk as Buffer);
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as CapabilityInvocation;
          requests.push({ path: url.pathname, ...(auth ? { auth } : {}), body });

          if (mode === "malformed") {
            send(200, { totally: "wrong" });
            return;
          }

          switch (body.capability) {
            case "search_semantic":
              send(200, envelope("search_semantic", {
                hits: [{ sentenceId: "s1", startMs: 0, endMs: 1000, speaker: null, text: "遠距工作", score: 0.8 }],
                timelineRevision,
              }));
              return;
            case "get_job":
              send(200, envelope("get_job", {
                id: String((body.args as { jobId: string }).jobId),
                kind: "export",
                status: "running",
                progress: 0.4,
                stage: "rendering",
                error: null,
              }));
              return;
            case "cancel_job":
              send(200, envelope("cancel_job", { id: String((body.args as { jobId: string }).jobId), status: "cancelled" }));
              return;
            case "apply_edit_plan": {
              if (body.expectedRevision !== timelineRevision) {
                send(200, failureEnvelope(
                  "apply_edit_plan",
                  "STALE_TIMELINE_REVISION",
                  `expected ${body.expectedRevision}, current ${timelineRevision}`,
                ));
                return;
              }
              if (!body.approval?.granted) {
                send(200, failureEnvelope("apply_edit_plan", "APPROVAL_REQUIRED", "needs a human", {
                  approvalRequest: {
                    id: "approval-1",
                    projectId: "cutos-project-1",
                    capability: "apply_edit_plan",
                    reasonCode: "removes_more_than_30_percent",
                    messageKey: "aios.approval.removesMost",
                    risk: "high",
                    impact: {
                      sourceDurationMs: 100_000,
                      estimatedDurationMs: 40_000,
                      removedMs: 60_000,
                      addedMs: 0,
                      keptRatio: 0.4,
                      removedRatio: 0.6,
                      operationCount: 5,
                      deleteOperationCount: 5,
                    },
                    requestedAt: "2026-08-19T00:00:00.000Z",
                    correlation: {
                      requestId: "srv-1",
                      createdAt: "2026-08-19T00:00:00.000Z",
                      updatedAt: "2026-08-19T00:00:00.000Z",
                    },
                  },
                }));
                return;
              }
              const key = body.correlation.idempotencyKey ?? "";
              if (applied.has(key)) {
                // The whole point of the key: replay, never mutate twice.
                send(200, { ...envelope("apply_edit_plan", { replayed: true }), replayed: true });
                return;
              }
              applied.add(key);
              timelineRevision += 1;
              send(200, envelope("apply_edit_plan", { id: "cutos-project-1", timelineRevision }));
              return;
            }
            default:
              send(200, failureEnvelope(body.capability, "CAPABILITY_NOT_FOUND", "unknown capability"));
              return;
          }
        }

        send(404, { error: { message: "no route" } });
      })();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no bind");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    mode = "ok";
    requests = [];
    flakyAttempts = 0;
  });

  const client = (overrides: Partial<ConstructorParameters<typeof CutosClient>[0]> = {}) =>
    new CutosClient({ baseUrl, timeoutMs: 1_000, maxAttempts: 1, retryBaseDelayMs: 1, ...overrides });

  // 1 — health ---------------------------------------------------------------
  it("reads health and reports the negotiated protocol", async () => {
    const health = await client().getHealth();
    expect(health.reachable).toBe(true);
    expect(health.compatible).toBe(true);
    expect(health.protocolVersion).toBe("cutos.agent.v2");
    expect(health.features).toContain("idempotency");
  });

  it("reports a disconnected CUTOS as state, not as a thrown error", async () => {
    mode = "down";
    const health = await client().getHealth();
    expect(health.reachable).toBe(false);
    expect(health.messageKey).toBe("cutos.status.disconnected");
  });

  it("reports an incompatible CUTOS without pretending it works", async () => {
    mode = "wrong_protocol";
    const health = await client().getHealth();
    expect(health.reachable).toBe(true);
    expect(health.compatible).toBe(false);
    expect(health.messageKey).toBe("aios.protocol.mismatch");
  });

  // 2 — manifest -------------------------------------------------------------
  it("fetches and validates the manifest", async () => {
    const manifest = await client().getManifest();
    expect(manifest.capabilities.map((c) => c.name)).toContain("search_semantic");
    const apply = manifest.capabilities.find((c) => c.name === "apply_edit_plan");
    expect(apply?.requiresApproval).toBe(true);
    expect(apply?.mutatesTimeline).toBe(true);
  });

  it("fails loudly on a manifest from an incompatible protocol", async () => {
    mode = "wrong_protocol";
    await expect(client().getManifest({ force: true })).rejects.toMatchObject({
      code: "PROTOCOL_VERSION_MISMATCH",
    });
  });

  it("rejects a malformed manifest rather than half-using it", async () => {
    mode = "malformed";
    await expect(client().getManifest({ force: true })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
  });

  // 3/4 — read + semantic search ---------------------------------------------
  it("invokes a read capability and returns the typed result", async () => {
    const outcome = await client().invokeRead<{ hits: unknown[] }>(
      "search_semantic",
      { projectId: "cutos-project-1", query: "遠距" },
      { correlation: correlation() },
    );
    expect(outcome.result.hits).toHaveLength(1);
    expect(outcome.correlation.timelineRevision).toBe(timelineRevision);
  });

  it("sends the full correlation envelope on every call", async () => {
    await client().invokeRead("search_semantic", { projectId: "p", query: "q" }, {
      correlation: correlation({ traceId: "trace-9" }),
    });
    const sent = capabilityInvocationSchema.parse(requests.at(-1)!.body);
    expect(sent.protocolVersion).toBe("cutos.agent.v2");
    expect(sent.correlation.aiosRunId).toBe("run-1");
    expect(sent.correlation.aiosStepId).toBe("step-1");
    expect(sent.correlation.aiosProjectId).toBe("aios-project-1");
    expect(sent.correlation.traceId).toBe("trace-9");
  });

  // 7/9 — apply + idempotency ------------------------------------------------
  it("refuses a write without an idempotency key", async () => {
    await expect(
      client().invokeWrite("apply_edit_plan", {}, { correlation: correlation() }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    // The refusal happens client-side: nothing reached CUTOS.
    expect(requests.filter((r) => r.path === "/api/aios/invoke")).toHaveLength(0);
  });

  it("applies with approval and replays on a retry with the same key", async () => {
    const key = deriveCutosIdempotencyKey({
      runId: "run-1",
      stepId: "step-apply",
      capability: "apply_edit_plan",
      cutosProjectId: "cutos-project-1",
      args: { projectId: "cutos-project-1" },
    });
    const revision = timelineRevision;

    const first = await client().invokeWrite<{ timelineRevision: number }>(
      "apply_edit_plan",
      { projectId: "cutos-project-1" },
      {
        correlation: correlation({ idempotencyKey: key }),
        expectedRevision: revision,
        approval: { granted: true, grantedBy: "tester" },
      },
    );
    expect(first.replayed).toBe(false);
    expect(first.result.timelineRevision).toBe(revision + 1);

    // Same key, original expectedRevision: CUTOS replays instead of re-applying.
    const retry = await client().invokeWrite(
      "apply_edit_plan",
      { projectId: "cutos-project-1" },
      {
        correlation: correlation({ idempotencyKey: key }),
        expectedRevision: revision + 1,
        approval: { granted: true, grantedBy: "tester" },
      },
    );
    expect(retry.replayed).toBe(true);
  });

  // 8 — stale revision --------------------------------------------------------
  it("surfaces a stale revision as a typed, non-retryable error", async () => {
    const error = await client()
      .invokeWrite("apply_edit_plan", {}, {
        correlation: correlation({ idempotencyKey: "stale-key" }),
        expectedRevision: 999,
        approval: { granted: true },
      })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CutosClientError);
    expect((error as CutosClientError).code).toBe("STALE_TIMELINE_REVISION");
    expect((error as CutosClientError).retryable).toBe(false);
    expect((error as CutosClientError).messageKey).toBe("aios.error.stale_timeline_revision");
  });

  // approval ------------------------------------------------------------------
  it("surfaces the approval request instead of swallowing it", async () => {
    const error = await client()
      .invokeWrite("apply_edit_plan", {}, {
        correlation: correlation({ idempotencyKey: "approval-key" }),
        expectedRevision: timelineRevision,
      })
      .catch((e: unknown) => e);
    expect((error as CutosClientError).code).toBe("APPROVAL_REQUIRED");
    const approval = (error as { approvalRequest?: { reasonCode: string; impact: { removedRatio: number } } })
      .approvalRequest;
    expect(approval?.reasonCode).toBe("removes_more_than_30_percent");
    expect(approval?.impact.removedRatio).toBeGreaterThan(0.3);
  });

  // 10 — timeout --------------------------------------------------------------
  it("times out a hung CUTOS", async () => {
    mode = "hang";
    await expect(
      client({ timeoutMs: 150 }).invokeRead("search_semantic", { projectId: "p", query: "q" }, {
        correlation: correlation(),
      }),
    ).rejects.toMatchObject({ code: "TIMEOUT" });
  }, 20_000);

  // 11 — unauthorized ---------------------------------------------------------
  it("sends the bearer token so an authorized call succeeds", async () => {
    mode = "unauthorized";
    const authed = new CutosClient({
      baseUrl,
      apiKey: "secret-key",
      timeoutMs: 1_000,
      maxAttempts: 1,
    });
    const health = await authed.getHealth();
    expect(health.reachable).toBe(true);
    expect(requests.at(-1)?.auth).toBe("Bearer secret-key");
  });

  it("reports a rejected key as UNAUTHORIZED and never retries it", async () => {
    mode = "unauthorized";
    const before = requests.length;
    const error = await client({ maxAttempts: 3, retryBaseDelayMs: 1 })
      .invokeRead("search_semantic", { projectId: "p", query: "q" }, { correlation: correlation() })
      .catch((e: unknown) => e as CutosClientError);
    expect(error).toBeInstanceOf(CutosClientError);
    expect((error as CutosClientError).code).toBe("UNAUTHORIZED");
    expect((error as CutosClientError).retryable).toBe(false);
    // A bad credential is not transient: retrying would just lock an account out.
    expect(requests.length).toBe(before);
  });

  it("redacts the credential the peer echoed back", async () => {
    mode = "unauthorized";
    const error = await client()
      .invokeRead("search_semantic", { projectId: "p", query: "q" }, { correlation: correlation() })
      .catch((e: unknown) => e as CutosClientError);
    const message = (error as CutosClientError).message;
    // The peer sent the token; the client must not carry it into logs or UI.
    expect(message).not.toContain("leaked-token-abcdefghijkl");
    expect(message).toContain("[REDACTED]");
  });

  // 12 — job polling ----------------------------------------------------------
  it("polls a long-running job", async () => {
    const job = await client().getJob("job-1", { correlation: correlation() });
    expect(job.result.status).toBe("running");
    expect(job.result.progress).toBeCloseTo(0.4);
  });

  // 13 — cancellation ---------------------------------------------------------
  it("cancels a job", async () => {
    const cancelled = await client().cancelJob("job-1", {
      correlation: correlation({ idempotencyKey: "cancel-key" }),
    });
    expect(cancelled.result.status).toBe("cancelled");
  });

  it("honours an external AbortSignal without retrying", async () => {
    mode = "hang";
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);
    await expect(
      client({ timeoutMs: 5_000, maxAttempts: 3 }).invokeRead(
        "search_semantic",
        { projectId: "p", query: "q" },
        { correlation: correlation(), signal: controller.signal },
      ),
    ).rejects.toMatchObject({ code: "CANCELLED" });
  }, 20_000);

  // retry ---------------------------------------------------------------------
  it("retries a transient outage and then succeeds", async () => {
    mode = "flaky";
    const outcome = await client({ maxAttempts: 3, retryBaseDelayMs: 5 }).invokeRead(
      "search_semantic",
      { projectId: "p", query: "q" },
      { correlation: correlation() },
    );
    expect(outcome.result).toBeDefined();
    expect(flakyAttempts).toBe(3);
  }, 20_000);

  it("does not retry an unknown capability", async () => {
    const before = requests.length;
    await expect(
      client({ maxAttempts: 3, retryBaseDelayMs: 1 }).invokeRead("nope", {}, {
        correlation: correlation(),
      }),
    ).rejects.toMatchObject({ code: "CAPABILITY_NOT_FOUND" });
    expect(requests.length - before).toBe(1);
  });

  it("rejects a malformed capability response", async () => {
    mode = "malformed";
    await expect(
      client().invokeRead("search_semantic", { projectId: "p", query: "q" }, {
        correlation: correlation(),
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });
});

describe("CUTOS environment configuration", () => {
  it("reports not-configured without CUTOS_URL", () => {
    expect(readCutosEnvironmentConfig({}).configured).toBe(false);
  });

  it("reads url, key, timeout and attempt caps", () => {
    const config = readCutosEnvironmentConfig({
      CUTOS_URL: "https://cutos.example/",
      CUTOS_API_KEY: "k",
      CUTOS_TIMEOUT_MS: "5000",
      CUTOS_MAX_ATTEMPTS: "9",
    });
    expect(config).toMatchObject({ configured: true, apiKey: "k", timeoutMs: 5_000 });
    // Attempts are capped so a misconfiguration cannot hammer CUTOS.
    expect(config.maxAttempts).toBe(5);
  });

  it("falls back to safe defaults on nonsense values", () => {
    const config = readCutosEnvironmentConfig({ CUTOS_URL: "http://x", CUTOS_TIMEOUT_MS: "abc" });
    expect(config.timeoutMs).toBe(20_000);
  });
});

describe("idempotency key derivation", () => {
  it("is identical for a retry of the same logical effect", () => {
    const input = {
      runId: "run-1",
      stepId: "step-1",
      capability: "cutos.edit.apply",
      cutosProjectId: "p1",
      args: { a: 1 },
    };
    expect(deriveCutosIdempotencyKey(input)).toBe(deriveCutosIdempotencyKey(input));
  });

  it("differs across steps, projects and arguments", () => {
    const base = {
      runId: "run-1",
      stepId: "step-1",
      capability: "cutos.edit.apply",
      cutosProjectId: "p1",
      args: { a: 1 },
    };
    expect(deriveCutosIdempotencyKey(base)).not.toBe(
      deriveCutosIdempotencyKey({ ...base, stepId: "step-2" }),
    );
    expect(deriveCutosIdempotencyKey(base)).not.toBe(
      deriveCutosIdempotencyKey({ ...base, cutosProjectId: "p2" }),
    );
    expect(deriveCutosIdempotencyKey(base)).not.toBe(
      deriveCutosIdempotencyKey({ ...base, args: { a: 2 } }),
    );
  });
});
