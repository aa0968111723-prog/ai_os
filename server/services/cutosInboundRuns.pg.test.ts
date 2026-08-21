import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import express from "express";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, schema } from "../db";
import { createMcpToken } from "./mcpAuth";
import { bindCutosProject } from "./cutosProjectBinding";
import {
  handleCutosInboundHealth,
  handleCutosSubmitRun,
  handleCutosGetRun,
  handleCutosCancelRun,
  handleCutosResumeRun,
  inboundCapabilityNames,
} from "./cutosInboundRuns";
import { CUTOS_PROTOCOL_VERSION, PROTOCOL_CONTRACT_FINGERPRINT } from "../../shared/cutosProtocol";

const RUN_PG = process.env.RUN_PG_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);

/**
 * CUTOS → AIOS over real HTTP and real PostgreSQL.
 *
 * This is the direction that had a client and no server: CUTOS shipped
 * `HttpAiosOrchestrator` pointed at `/api/cutos/*`, ai_os served none of it, and
 * no suite in either repo could notice. So this test mounts the REAL Express
 * handlers on a real socket, drives them with a real `fetch`, and writes what
 * it observes to `docs/contract/aios.cutos.v2.inbound.fixtures.json` — the
 * mirror of the artifact CUTOS already produces. CUTOS replays that file
 * through its real orchestrator client, so neither side is guessing the
 * other's JSON in either direction.
 *
 * Deterministic on purpose (ids and timestamps normalized): a committed
 * artifact that rewrites itself on every run cannot be compared across repos.
 */

const FIXTURE_PATH = join(process.cwd(), "docs/contract/aios.cutos.v2.inbound.fixtures.json");

interface Exchange {
  scenario: string;
  request: { method: string; path: string; headers?: Record<string, string>; body?: unknown };
  response: { status: number; body: unknown };
}

const FIXED_ISO = "2026-01-01T00:00:00.000Z";
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const ISO_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z/g;

function normalize(value: unknown, ids: Map<string, string>): unknown {
  const idFor = (raw: string): string => {
    const key = raw.toLowerCase();
    const existing = ids.get(key);
    if (existing) return existing;
    const placeholder = `00000000-0000-4000-8000-${String(ids.size + 1).padStart(12, "0")}`;
    ids.set(key, placeholder);
    return placeholder;
  };
  const walk = (node: unknown): unknown => {
    if (typeof node === "string") return node.replace(UUID_RE, idFor).replace(ISO_RE, FIXED_ISO);
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === "object") {
      return Object.fromEntries(Object.entries(node as Record<string, unknown>).map(([k, v]) => [k, walk(v)]));
    }
    return node;
  };
  return walk(value);
}

describe.skipIf(!RUN_PG).sequential("CUTOS → AIOS inbound API (real HTTP, real PostgreSQL)", () => {
  const teamId = randomUUID();
  const groupA = randomUUID();
  const groupB = randomUUID();
  const memberId = randomUUID();
  const outsiderId = randomUUID();
  const projectA = randomUUID();
  const projectB = randomUUID();
  // Ids embed a FULL uuid, not a slice: the fixture normalizer keys on uuids,
  // so anything shorter would churn the committed artifact on every run.
  const cutosProjectA = `cutos-inbound-${randomUUID()}`;
  const cutosProjectB = `cutos-inbound-${randomUUID()}`;
  const cutosUnbound = `cutos-unbound-${randomUUID()}`;

  let server: Server;
  let baseUrl = "";
  let memberToken = "";
  let readOnlyToken = "";
  let outsiderToken = "";
  const exchanges: Exchange[] = [];
  const createdRunIds: string[] = [];

  beforeAll(async () => {
    await db.insert(schema.teams).values({ id: teamId, name: `t-${teamId.slice(0, 8)}` });
    await db.insert(schema.groups).values([
      { id: groupA, teamId, name: `ga-${groupA.slice(0, 8)}` },
      { id: groupB, teamId, name: `gb-${groupB.slice(0, 8)}` },
    ]);
    await db.insert(schema.users).values([
      { id: memberId, name: "member", email: `m-${memberId}@t.local`, passwordHash: "x", status: "active" },
      { id: outsiderId, name: "outsider", email: `o-${outsiderId}@t.local`, passwordHash: "x", status: "active" },
    ]);
    await db.insert(schema.groupMembers).values([
      { groupId: groupA, userId: memberId, role: "member" },
      { groupId: groupB, userId: outsiderId, role: "member" },
    ]);
    const project = (id: string, groupId: string, ownerId: string) => ({
      id, groupId, ownerId, title: `p-${id.slice(0, 8)}`,
      kind: "video", platform: "web", format: "landscape",
    });
    await db.insert(schema.projects).values([
      project(projectA, groupA, memberId),
      project(projectB, groupB, outsiderId),
    ]);
    await bindCutosProject({ userId: memberId, aiosProjectId: projectA, cutosProjectId: cutosProjectA, verify: false });
    await bindCutosProject({ userId: outsiderId, aiosProjectId: projectB, cutosProjectId: cutosProjectB, verify: false });

    memberToken = (await createMcpToken(memberId, "cutos-inbound")).token;
    readOnlyToken = (await createMcpToken(memberId, "cutos-inbound-ro", { readOnly: true })).token;
    outsiderToken = (await createMcpToken(outsiderId, "cutos-inbound-outsider")).token;

    // The real Express app surface, mounted exactly as server/index.ts mounts it.
    const app = express();
    app.use(express.json({ limit: "2mb" }));
    app.get("/api/cutos/health", handleCutosInboundHealth);
    app.post("/api/cutos/runs", handleCutosSubmitRun);
    app.get("/api/cutos/runs/:runId", handleCutosGetRun);
    app.post("/api/cutos/runs/:runId/cancel", handleCutosCancelRun);
    app.post("/api/cutos/runs/:runId/resume", handleCutosResumeRun);

    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("server did not bind");
    baseUrl = `http://127.0.0.1:${address.port}`;
  }, 60_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (exchanges.length > 0) {
      const ids = new Map<string, string>();
      mkdirSync(dirname(FIXTURE_PATH), { recursive: true });
      writeFileSync(
        FIXTURE_PATH,
        `${JSON.stringify(
          {
            $comment:
              "Generated by server/services/cutosInboundRuns.pg.test.ts from real HTTP traffic against "
              + "the production AIOS inbound handlers on real PostgreSQL. Replayed by CUTOS "
              + "(packages/agent/src/aios-orchestrator.contract.test.ts) through its real "
              + "HttpAiosOrchestrator, so the CUTOS → AIOS direction is contract-tested from both ends. "
              + "Ids and timestamps are normalized, so regenerating without a behaviour change is a "
              + "no-op diff. Regenerate with: RUN_PG_INTEGRATION=1 npx vitest run "
              + "server/services/cutosInboundRuns.pg.test.ts",
            protocolVersion: CUTOS_PROTOCOL_VERSION,
            contractFingerprint: PROTOCOL_CONTRACT_FINGERPRINT,
            generator: "aios",
            exchanges: exchanges.map((exchange) => ({
              scenario: exchange.scenario,
              request: normalize(exchange.request, ids),
              response: normalize(exchange.response, ids),
            })),
          },
          null,
          2,
        )}\n`,
      );
    }
    if (createdRunIds.length > 0) {
      await db.delete(schema.cutosInboundRuns).where(inArray(schema.cutosInboundRuns.runId, createdRunIds));
      await db.delete(schema.agentRuns).where(inArray(schema.agentRuns.id, createdRunIds));
    }
    await db.delete(schema.mcpTokens).where(inArray(schema.mcpTokens.userId, [memberId, outsiderId]));
    await db.delete(schema.aiosCutosProjectBindings)
      .where(inArray(schema.aiosCutosProjectBindings.aiosProjectId, [projectA, projectB]));
    await db.delete(schema.projects).where(inArray(schema.projects.id, [projectA, projectB]));
    await db.delete(schema.groupMembers).where(inArray(schema.groupMembers.groupId, [groupA, groupB]));
    await db.delete(schema.users).where(inArray(schema.users.id, [memberId, outsiderId]));
    await db.delete(schema.groups).where(inArray(schema.groups.id, [groupA, groupB]));
    await db.delete(schema.teams).where(eq(schema.teams.id, teamId));
  });

  let counter = 0;
  async function call(
    scenario: string,
    method: string,
    path: string,
    options: { body?: unknown; token?: string | null; protocol?: string | null } = {},
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const headers: Record<string, string> = {};
    if (options.token !== null) headers.authorization = `Bearer ${options.token ?? memberToken}`;
    if (options.protocol !== null) headers["x-cutos-protocol"] = options.protocol ?? CUTOS_PROTOCOL_VERSION;
    if (options.body !== undefined) headers["content-type"] = "application/json";
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
    const body = (await response.json()) as Record<string, unknown>;
    exchanges.push({
      scenario,
      // The credential itself is never recorded: the fixture is a committed file.
      request: { method, path, ...(options.body === undefined ? {} : { body: options.body }) },
      response: { status: response.status, body },
    });
    counter += 1;
    return { status: response.status, body };
  }

  const submitBody = (overrides: Record<string, unknown> = {}) => ({
    protocolVersion: CUTOS_PROTOCOL_VERSION,
    goal: "把 45 分鐘訪談做成 8 分鐘精華",
    capability: "video.highlight.package",
    qualityProfile: "balanced",
    correlation: {
      requestId: `cutos-req-${randomUUID()}`,
      idempotencyKey: `cutos-submit-${randomUUID()}`,
      cutosProjectId: cutosProjectA,
      cutosAgentRunId: `run_${randomUUID()}`,
      traceId: `trace-${randomUUID()}`,
    },
    ...overrides,
  });

  it("health is the version handshake and needs no credential", async () => {
    const { status, body } = await call("health", "GET", "/api/cutos/health", { token: null, protocol: null });
    expect(status).toBe(200);
    expect(body.protocolVersion).toBe(CUTOS_PROTOCOL_VERSION);
    expect(body.supportedProtocols).toContain(CUTOS_PROTOCOL_VERSION);
    expect(body.capabilities).toEqual(inboundCapabilityNames());
    // A handshake must not leak tenant state.
    expect(JSON.stringify(body)).not.toContain(cutosProjectA);
  });

  it("refuses a request with no credential", async () => {
    const { status, body } = await call("unauthorized", "POST", "/api/cutos/runs", {
      body: submitBody(), token: null,
    });
    expect(status).toBe(401);
    expect((body.error as { code: string }).code).toBe("UNAUTHORIZED");
  });

  it("fails loudly on an unknown protocol instead of falling back", async () => {
    const { status, body } = await call("protocol_mismatch", "POST", "/api/cutos/runs", {
      body: submitBody({ protocolVersion: "cutos.agent.v9" }), protocol: "cutos.agent.v9",
    });
    expect(status).toBe(409);
    expect((body.error as { code: string }).code).toBe("PROTOCOL_VERSION_MISMATCH");
    expect((body.error as { messageKey: string }).messageKey).toBe("aios.protocol.mismatch");
  });

  it("rejects a capability AIOS does not orchestrate", async () => {
    const { status, body } = await call("unsupported_capability", "POST", "/api/cutos/runs", {
      body: submitBody({ capability: "video.delete.everything" }),
    });
    expect(status).toBe(400);
    expect((body.error as { code: string }).code).toBe("UNSUPPORTED_OPERATION");
  });

  it("hides a CUTOS project nobody bound, rather than reporting forbidden", async () => {
    const { status, body } = await call("unbound_project", "POST", "/api/cutos/runs", {
      body: submitBody({
        correlation: { ...submitBody().correlation, cutosProjectId: cutosUnbound },
      }),
    });
    expect(status).toBe(404);
    expect((body.error as { code: string }).code).toBe("PROJECT_NOT_FOUND");
  });

  it("hides another group's bound project from a valid credential", async () => {
    // The outsider holds a real key and names a real CUTOS project — but not one
    // bound in a group they belong to. Same answer as "does not exist".
    const { status, body } = await call("cross_group_denied", "POST", "/api/cutos/runs", {
      body: submitBody({ correlation: { ...submitBody().correlation, cutosProjectId: cutosProjectA } }),
      token: outsiderToken,
    });
    expect(status).toBe(404);
    expect((body.error as { code: string }).code).toBe("PROJECT_NOT_FOUND");
  });

  it("refuses to start a run on a read-only credential", async () => {
    const { status, body } = await call("read_only_denied", "POST", "/api/cutos/runs", {
      body: submitBody(), token: readOnlyToken,
    });
    expect(status).toBe(401);
    expect((body.error as { code: string }).code).toBe("UNAUTHORIZED");
  });

  function oversizedContext(rangeCount: number, charsPerRange: number, claimedChars: number) {
    return {
      protocolVersion: CUTOS_PROTOCOL_VERSION,
      projectId: cutosProjectA,
      timelineRevision: 1,
      query: "測試",
      topics: [],
      speakers: [],
      ranges: Array.from({ length: rangeCount }, (_, index) => ({
        startMs: index * 1_000,
        endMs: index * 1_000 + 900,
        text: "字".repeat(charsPerRange),
        speaker: "S1",
        score: 0.5,
        sentenceIds: [`s${index}`],
      })),
      highlights: [],
      provenance: {
        capability: "build_semantic_context",
        requestId: `ctx-${randomUUID()}`,
        generatedAt: new Date().toISOString(),
        analysisVersion: 1,
        mediaChecksum: "sha256:test",
        contextHash: "hash",
      },
      budget: {
        maxRanges: 40,
        maxChars: 20_000,
        usedRanges: rangeCount,
        usedChars: claimedChars,
        truncated: false,
      },
    };
  }

  it("rejects a context with too many ranges", async () => {
    const { status, body } = await call("context_too_many_ranges", "POST", "/api/cutos/runs", {
      body: submitBody({ context: oversizedContext(200, 10, 2_000) }),
    });
    expect(status).toBe(400);
    expect((body.error as { code: string }).code).toBe("VALIDATION_FAILED");
  });

  it("measures the context text rather than trusting the peer's own byte count", async () => {
    // The regression this pins: the guard used to read a `totalChars` field that
    // does not exist on the protocol type, so it was always undefined and the
    // character ceiling never fired. A peer under-reporting its own size is the
    // case that stayed open even after the field name was noticed.
    const context = oversizedContext(30, 5_000, 10); // 150k real chars, claims 10
    const { status, body } = await call("context_underreported_size", "POST", "/api/cutos/runs", {
      body: submitBody({ context }),
    });
    expect(status).toBe(400);
    expect((body.error as { code: string }).code).toBe("VALIDATION_FAILED");
    const detail = (body.error as { detail?: string }).detail ?? "";
    expect(detail).toContain("chars=150000");
  });

  it("accepts a context inside the budget", async () => {
    const { status } = await call("context_within_budget", "POST", "/api/cutos/runs", {
      body: submitBody({ context: oversizedContext(5, 100, 500) }),
    });
    expect(status).toBe(201);
  });

  it("requires an idempotency key on a submit", async () => {
    const body0 = submitBody();
    delete (body0.correlation as Record<string, unknown>).idempotencyKey;
    const { status, body } = await call("missing_idempotency_key", "POST", "/api/cutos/runs", { body: body0 });
    expect(status).toBe(400);
    expect((body.error as { code: string }).code).toBe("VALIDATION_FAILED");
  });

  let submittedRunId = "";
  let submittedKey = "";

  it("creates a governed run that waits for human approval", async () => {
    const payload = submitBody();
    submittedKey = (payload.correlation as { idempotencyKey: string }).idempotencyKey;
    const { status, body } = await call("submit_run", "POST", "/api/cutos/runs", { body: payload });
    expect(status).toBe(201);
    submittedRunId = body.aiosRunId as string;
    createdRunIds.push(submittedRunId);

    // The whole governance point: an inbound submit lands in the approval gate.
    expect(body.status).toBe("waiting_approval");
    expect(body.protocolVersion).toBe(CUTOS_PROTOCOL_VERSION);
    const steps = body.steps as Array<{ id: string; kind: string; messageKey: string; dependsOn: string[] }>;
    expect(steps.length).toBeGreaterThan(5);
    // Every step carries a translatable key, never model prose.
    for (const step of steps) expect(step.messageKey).toMatch(/^bridge\.activity\./);
    // The DAG really is a DAG: something depends on something.
    expect(steps.some((step) => step.dependsOn.length > 0)).toBe(true);

    // Full correlation both ways — this is the traceability requirement.
    const correlation = body.correlation as Record<string, unknown>;
    expect(correlation.aiosRunId).toBe(submittedRunId);
    expect(correlation.cutosProjectId).toBe(cutosProjectA);
    expect(correlation.cutosAgentRunId).toBe((payload.correlation as { cutosAgentRunId: string }).cutosAgentRunId);
    expect(correlation.traceId).toBe((payload.correlation as { traceId: string }).traceId);
    expect(correlation.idempotencyKey).toBe(submittedKey);
    // AIOS derived its own project; CUTOS never named it.
    expect(correlation.aiosProjectId).toBe(projectA);
    expect(JSON.stringify(payload)).not.toContain(projectA);
  });

  it("replays the same run when the same submit is retried", async () => {
    const before = await db.select().from(schema.agentRuns).where(eq(schema.agentRuns.id, submittedRunId));
    const payload = submitBody();
    (payload.correlation as Record<string, unknown>).idempotencyKey = submittedKey;
    const { status, body } = await call("submit_idempotent_replay", "POST", "/api/cutos/runs", { body: payload });
    expect(status).toBe(200);
    expect(body.aiosRunId).toBe(submittedRunId);

    // No second run exists for this project as a result of the retry.
    const rows = await db.select().from(schema.cutosInboundRuns)
      .where(eq(schema.cutosInboundRuns.idempotencyKey, submittedKey));
    expect(rows).toHaveLength(1);
    const after = await db.select().from(schema.agentRuns).where(eq(schema.agentRuns.id, submittedRunId));
    expect(after[0]!.status).toBe(before[0]!.status);
  });

  it("survives two concurrent retries of the same submit", async () => {
    const key = `cutos-submit-${randomUUID()}`;
    const payload = () => {
      const p = submitBody();
      (p.correlation as Record<string, unknown>).idempotencyKey = key;
      return p;
    };
    const [first, second] = await Promise.all([
      fetch(`${baseUrl}/api/cutos/runs`, {
        method: "POST",
        headers: { authorization: `Bearer ${memberToken}`, "content-type": "application/json" },
        body: JSON.stringify(payload()),
      }).then((r) => r.json() as Promise<Record<string, unknown>>),
      fetch(`${baseUrl}/api/cutos/runs`, {
        method: "POST",
        headers: { authorization: `Bearer ${memberToken}`, "content-type": "application/json" },
        body: JSON.stringify(payload()),
      }).then((r) => r.json() as Promise<Record<string, unknown>>),
    ]);
    // The unique index arbitrates: both callers see one run.
    expect(first.aiosRunId).toBe(second.aiosRunId);
    createdRunIds.push(first.aiosRunId as string);
    const rows = await db.select().from(schema.cutosInboundRuns)
      .where(eq(schema.cutosInboundRuns.idempotencyKey, key));
    expect(rows).toHaveLength(1);
  });

  it("polls a run and returns the correlation intact", async () => {
    const { status, body } = await call("get_run", "GET", `/api/cutos/runs/${submittedRunId}`);
    expect(status).toBe(200);
    expect(body.aiosRunId).toBe(submittedRunId);
    expect((body.correlation as { cutosProjectId: string }).cutosProjectId).toBe(cutosProjectA);
  });

  it("hides another group's run from a valid credential", async () => {
    const { status, body } = await call("get_run_cross_group", "GET", `/api/cutos/runs/${submittedRunId}`, {
      token: outsiderToken,
    });
    expect(status).toBe(404);
    expect((body.error as { code: string }).code).toBe("RUN_NOT_FOUND");
  });

  it("refuses to let the submitter resume past its own approval gate", async () => {
    const { status, body } = await call("resume_requires_approval", "POST", `/api/cutos/runs/${submittedRunId}/resume`);
    expect(status).toBe(428);
    expect((body.error as { code: string }).code).toBe("APPROVAL_REQUIRED");
    // And the run is still waiting — the refusal changed nothing.
    const [row] = await db.select().from(schema.agentRuns).where(eq(schema.agentRuns.id, submittedRunId));
    expect(row!.status).toBe("awaiting_approval");
  });

  it("cancels a run, and cancelling twice is not an error", async () => {
    const first = await call("cancel_run", "POST", `/api/cutos/runs/${submittedRunId}/cancel`);
    expect(first.status).toBe(200);
    expect(first.body.status).toBe("cancelled");
    const second = await call("cancel_run_repeat", "POST", `/api/cutos/runs/${submittedRunId}/cancel`);
    expect(second.status).toBe(200);
    expect(second.body.status).toBe("cancelled");
  });

  it("reports a run id that was never submitted through this door as not found", async () => {
    const { status, body } = await call("run_not_found", "GET", `/api/cutos/runs/${randomUUID()}`);
    expect(status).toBe(404);
    expect((body.error as { code: string }).code).toBe("RUN_NOT_FOUND");
  });

  it("never leaks a credential or an exception message in any recorded response", () => {
    const dump = JSON.stringify(exchanges);
    expect(dump).not.toContain(memberToken);
    expect(dump).not.toContain(readOnlyToken);
    expect(dump).not.toContain(outsiderToken);
    expect(dump).not.toMatch(/at \w+ \(|node_modules|\.ts:\d+:\d+/);
  });
});
