import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, schema } from "../db";
import { CUTOS_PROTOCOL_VERSION, type CapabilityInvocation } from "../../shared/cutosProtocol";
import { CutosClient, setCutosClient } from "./cutosClient";
import { bindCutosProject } from "./cutosProjectBinding";
import { executeCutosToolStep, pollCutosJob } from "./cutosStepRunner";
import { listCutosActivity } from "./cutosActivity";
import { findEffect, listStaleEffects } from "./cutosEffectLedger";
import { buildVideoEditingWorkflow } from "./cutosWorkflow";
import { listRunnableDagSteps, type AgentDagStep } from "../../shared/agentDag";

const RUN_PG = process.env.RUN_PG_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);

/**
 * The whole workflow, executed.
 *
 * Real PostgreSQL, real HTTP, the real DAG solver, the real tool registry and
 * the real effect ledger. The CUTOS peer is a stand-in so this can run in CI
 * without FFmpeg — the equivalent run against a live CUTOS server lives in
 * `scripts/e2e-cutos-crossrepo.ts`.
 *
 * What it proves: the DAG reaches export, the approval gate actually blocks,
 * a retried apply replays instead of re-applying, a long job parks and
 * converges, a stopped run cancels the CUTOS job, and a crash mid-apply is
 * recovered by asking CUTOS rather than repeating the edit.
 */
describe.skipIf(!RUN_PG).sequential("CUTOS workflow E2E (real PostgreSQL + HTTP)", () => {
  const teamId = randomUUID();
  const groupId = randomUUID();
  const userId = randomUUID();
  const projectId = randomUUID();
  const runId = randomUUID();
  const cutosProjectId = "cutos-e2e-1";

  let server: Server;
  let baseUrl = "";
  let timelineRevision = 0;
  let applyCount = 0;
  let cancelledJobs: string[] = [];
  const appliedKeys = new Map<string, number>();
  const jobs = new Map<string, { status: string; ticks: number }>();
  const invocations: CapabilityInvocation[] = [];

  const ok = (
    capability: string,
    result: unknown,
    extra: { correlation?: Record<string, unknown>; replayed?: boolean } = {},
  ) => ({
    protocolVersion: CUTOS_PROTOCOL_VERSION,
    capability,
    ok: true,
    result,
    correlation: {
      requestId: randomUUID(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      timelineRevision,
      // Merged, not replaced: a caller adding cutosJobId must not drop the
      // required envelope fields.
      ...(extra.correlation ?? {}),
    },
    activity: [
      {
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        projectId: cutosProjectId,
        kind: activityKindFor(capability),
        status: "completed",
        messageKey: `activity.${activityKindFor(capability)}.completed`,
        metadata: { capability },
      },
    ],
    replayed: extra.replayed ?? false,
  });

  const fail = (capability: string, code: string, message: string) => ({
    protocolVersion: CUTOS_PROTOCOL_VERSION,
    capability,
    ok: false,
    error: { code, message, messageKey: `aios.error.${code.toLowerCase()}`, retryable: false },
    correlation: {
      requestId: randomUUID(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    activity: [],
  });

  function activityKindFor(capability: string): string {
    if (capability.includes("analyze")) return "analyze";
    if (capability.includes("semantic") || capability.includes("search")) return "semantic_search";
    if (capability.includes("highlight")) return "highlights";
    if (capability.includes("speaker")) return "speakers";
    if (capability.includes("topic")) return "topics";
    if (capability.includes("apply")) return "apply";
    if (capability.includes("verify")) return "verify";
    if (capability.includes("preview")) return "preview";
    if (capability.includes("export")) return "export";
    if (capability.includes("context")) return "context";
    return "run";
  }

  beforeAll(async () => {
    await db.insert(schema.teams).values({ id: teamId, name: `t-${teamId.slice(0, 8)}` });
    await db.insert(schema.groups).values({ id: groupId, teamId, name: `g-${groupId.slice(0, 8)}` });
    await db.insert(schema.users).values({
      id: userId, name: "e2e", email: `e-${userId}@t.local`, passwordHash: "x", status: "active",
    });
    await db.insert(schema.groupMembers).values({ groupId, userId, role: "leader" });
    await db.insert(schema.projects).values({
      id: projectId, groupId, ownerId: userId,
      title: "e2e", kind: "video", platform: "web", format: "landscape",
    });
    await bindCutosProject({ userId, aiosProjectId: projectId, cutosProjectId, verify: false });

    server = createServer((req, res) => {
      void (async () => {
        const url = new URL(req.url ?? "/", "http://localhost");
        const send = (body: unknown) => {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify(body));
        };
        if (url.pathname !== "/api/aios/invoke") {
          res.writeHead(404); res.end("{}"); return;
        }
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as CapabilityInvocation;
        invocations.push(body);
        const args = body.args as Record<string, unknown>;

        switch (body.capability) {
          case "get_project":
            return send(ok("get_project", { id: cutosProjectId, name: "訪談", timelineRevision }));
          case "analyze": {
            const jobId = `job-analyze-${jobs.size + 1}`;
            jobs.set(jobId, { status: "running", ticks: 0 });
            return send(ok("analyze", { jobId }, { correlation: { cutosJobId: jobId } }));
          }
          case "export": {
            const jobId = `job-export-${jobs.size + 1}`;
            jobs.set(jobId, { status: "running", ticks: 0 });
            return send(ok("export", { jobId }, { correlation: { cutosJobId: jobId } }));
          }
          case "get_job": {
            const jobId = String(args.jobId);
            const job = jobs.get(jobId);
            if (!job) return send(fail("get_job", "JOB_NOT_FOUND", "no such job"));
            job.ticks += 1;
            if (job.status === "running" && job.ticks >= 2) job.status = "succeeded";
            return send(ok("get_job", {
              id: jobId, kind: "analyze", status: job.status,
              progress: job.status === "succeeded" ? 1 : 0.5, stage: "working", error: null,
            }));
          }
          case "cancel_job": {
            const jobId = String(args.jobId);
            cancelledJobs.push(jobId);
            const job = jobs.get(jobId);
            if (job) job.status = "cancelled";
            return send(ok("cancel_job", { id: jobId, status: "cancelled" }));
          }
          case "list_speakers":
            return send(ok("list_speakers", { speakers: [
              { id: "主持人", label: "主持人", speakingMs: 40_000, sentenceCount: 5 },
            ] }));
          case "list_topics":
            return send(ok("list_topics", { topics: [
              { id: "t1", label: "遠距", weight: 2, startMs: 0, endMs: 9_000, sentenceCount: 3 },
            ] }));
          case "search_semantic":
            return send(ok("search_semantic", {
              hits: [{ sentenceId: "s1", startMs: 0, endMs: 8_000, speaker: "主持人", text: "遠距工作", score: 0.9 }],
              timelineRevision,
            }));
          case "find_highlights":
            return send(ok("find_highlights", {
              highlights: [{
                id: "h1", startMs: 0, endMs: 45_000, score: 0.9, reasonCode: "topic_dense",
                topicIds: ["t1"], speaker: null, excerpt: "遠距工作",
              }],
              timelineRevision,
            }));
          case "build_semantic_context":
            return send(ok("build_semantic_context", {
              protocolVersion: CUTOS_PROTOCOL_VERSION,
              projectId: cutosProjectId, timelineRevision, query: "遠距",
              topics: [], speakers: [], ranges: [], highlights: [],
              provenance: {
                capability: "build_semantic_context", requestId: "r", generatedAt: new Date().toISOString(),
                analysisVersion: 1, mediaChecksum: "c", contextHash: "h",
              },
              budget: { maxRanges: 12, maxChars: 6_000, usedRanges: 0, usedChars: 0, truncated: false },
            }));
          case "create_edit_plan":
            return send(ok("create_edit_plan", {
              runId: "cutos-run-1", status: "awaiting_approval", planId: "plan-1",
              summary: "刪除停頓", operationCount: 4, timelineRevision, impact: null,
            }));
          case "verify_edit_plan":
            return send(ok("verify_edit_plan", {
              ok: true, stale: false, timelineRevision, targetRevision: timelineRevision,
              impact: null, issues: [],
            }));
          case "preview_edit_plan":
          case "get_preview":
            return send(ok(body.capability, { timelineRevision, durationMs: 60_000, segments: [] }));
          case "apply_edit_plan": {
            if (!body.approval?.granted) {
              return send(fail("apply_edit_plan", "APPROVAL_REQUIRED", "needs approval"));
            }
            if (body.expectedRevision !== timelineRevision) {
              return send(fail("apply_edit_plan", "STALE_TIMELINE_REVISION", "moved"));
            }
            const key = body.correlation.idempotencyKey ?? "";
            const already = appliedKeys.get(key);
            if (already !== undefined) {
              // A duplicate key replays the receipt; the timeline does not move.
              return send(ok(
                "apply_edit_plan",
                { id: cutosProjectId, timelineRevision: already },
                { correlation: { timelineRevision: already }, replayed: true },
              ));
            }
            applyCount += 1;
            timelineRevision += 1;
            appliedKeys.set(key, timelineRevision);
            return send(ok("apply_edit_plan", { id: cutosProjectId, timelineRevision }));
          }
          default:
            return send(fail(body.capability, "CAPABILITY_NOT_FOUND", "unknown"));
        }
      })();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no bind");
    baseUrl = `http://127.0.0.1:${address.port}`;
    setCutosClient(new CutosClient({ baseUrl, timeoutMs: 3_000, maxAttempts: 1 }));
  });

  afterAll(async () => {
    setCutosClient(undefined);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.delete(schema.cutosActivityEvents).where(eq(schema.cutosActivityEvents.projectId, projectId));
    await db.delete(schema.cutosToolEffects).where(eq(schema.cutosToolEffects.projectId, projectId));
    await db.delete(schema.aiosCutosProjectBindings)
      .where(eq(schema.aiosCutosProjectBindings.aiosProjectId, projectId));
    await db.delete(schema.projects).where(eq(schema.projects.id, projectId));
    await db.delete(schema.groupMembers).where(eq(schema.groupMembers.groupId, groupId));
    await db.delete(schema.users).where(inArray(schema.users.id, [userId]));
    await db.delete(schema.groups).where(eq(schema.groups.id, groupId));
    await db.delete(schema.teams).where(eq(schema.teams.id, teamId));
  });

  const run = (
    stepId: string,
    toolId: string,
    toolInput: Record<string, unknown> = {},
    dependencies: Array<{ id: string; kind: string; status: string }> = [],
  ) => executeCutosToolStep({
    runId, stepId, userId, groupId, projectId, toolId, toolInput, dependencies,
  });

  const approved = [{ id: "approval_gate", kind: "request_approval", status: "done" }];

  it("executes the whole planned DAG to completion", async () => {
    const plan = buildVideoEditingWorkflow({
      goal: "把這支 45 分鐘的訪談剪成一支 8 分鐘精華，再找三段最適合短影音的地方。",
      targetDurationMs: 8 * 60_000,
      shortCandidateCount: 3,
    }) as AgentDagStep[];

    const executed: string[] = [];
    let guard = 0;
    while (plan.some((step) => step.status === "pending") && guard < 40) {
      guard += 1;
      const runnable = listRunnableDagSteps(plan);
      expect(runnable.length).toBeGreaterThan(0);
      for (const index of runnable) {
        const step = plan[index]! as AgentDagStep & {
          kind: string;
          toolId?: string;
          toolInput?: Record<string, unknown>;
        };
        if (step.kind === "request_approval") {
          // A human approves here; the agent cannot satisfy its own gate.
          step.status = "done";
          executed.push(`${step.id}:human`);
          continue;
        }
        const dependencies = (step.dependsOn ?? []).map((id) => {
          const dependency = plan.find((candidate) => candidate.id === id) as
            (AgentDagStep & { kind: string }) | undefined;
          return { id, kind: dependency?.kind ?? "unknown", status: dependency?.status ?? "failed" };
        });
        const outcome = await run(step.id!, step.toolId!, step.toolInput ?? {}, dependencies);
        if (outcome.state === "waiting_external") {
          // Long job: converge it the way the runner's poll pass does.
          for (let attempt = 0; attempt < 10; attempt += 1) {
            const poll = await pollCutosJob({
              runId, stepId: step.id!, userId, groupId, projectId, jobId: outcome.jobId,
            });
            if (poll.state === "completed") break;
            expect(poll.state).toBe("running");
          }
          step.status = "done";
          executed.push(`${step.id}:job`);
          continue;
        }
        expect(outcome.state, `${step.id} → ${JSON.stringify(outcome)}`).toBe("completed");
        step.status = "done";
        executed.push(step.id!);
      }
    }

    expect(plan.every((step) => step.status === "done")).toBe(true);
    expect(executed).toContain("apply_long_cut");
    expect(executed).toContain("export_long_cut:job");
    expect(applyCount).toBe(1);
  }, 60_000);

  it("mirrored the CUTOS activity into AIOS with the run correlation", async () => {
    const activity = await listCutosActivity({ projectId, limit: 200 });
    expect(activity.length).toBeGreaterThan(5);
    expect(activity.every((event) => event.runId === runId)).toBe(true);
    expect(activity.every((event) => /^activity\./.test(event.messageKey))).toBe(true);
    const kinds = new Set(activity.map((event) => event.kind));
    expect(kinds).toContain("analyze");
    expect(kinds).toContain("apply");
    expect(kinds).toContain("export");
  });

  it("refuses a destructive step with no approval in its dependencies", async () => {
    const outcome = await run("unapproved-apply", "cutos.edit.apply", {}, [
      { id: "verify_long_cut", kind: "tool_call", status: "done" },
    ]);
    expect(outcome.state).toBe("waiting_approval");
    // Nothing reached CUTOS: the gate is on the AIOS side.
    expect(applyCount).toBe(1);
  });

  it("replays a retried apply instead of applying twice", async () => {
    const before = timelineRevision;
    const first = await run("retry-apply", "cutos.edit.apply", {}, approved);
    expect(first.state).toBe("completed");
    expect(applyCount).toBe(2);

    const retry = await run("retry-apply", "cutos.edit.apply", {}, approved);
    expect(retry.state).toBe("completed");
    // The second call reused the ledger row and CUTOS's receipt.
    expect(applyCount).toBe(2);
    expect(timelineRevision).toBe(before + 1);
  });

  it("recovers a crashed apply by asking CUTOS, not by re-applying", async () => {
    // Simulate: the intent row was written, the process died before the reply.
    const stepId = "crashed-apply";
    const outcome = await run(stepId, "cutos.edit.apply", {}, approved);
    expect(outcome.state).toBe("completed");
    const appliedAt = timelineRevision;
    const countAfterFirst = applyCount;

    const effects = await db
      .select()
      .from(schema.cutosToolEffects)
      .where(eq(schema.cutosToolEffects.stepId, stepId));
    expect(effects).toHaveLength(1);
    await db
      .update(schema.cutosToolEffects)
      .set({ status: "in_flight", updatedAt: new Date(Date.now() - 60 * 60_000) })
      .where(eq(schema.cutosToolEffects.id, effects[0]!.id));

    // Restart: the same step runs again and must reconcile.
    const recovered = await run(stepId, "cutos.edit.apply", {}, approved);
    expect(recovered.state).toBe("completed");
    expect(applyCount).toBe(countAfterFirst);
    expect(timelineRevision).toBe(appliedAt);

    const reconciled = await findEffect(effects[0]!.idempotencyKey);
    expect(reconciled?.status).toBe("completed");
  });

  it("surfaces effects a crashed process left behind", async () => {
    const stepId = "abandoned";
    await run(stepId, "cutos.analysis.start", {}, []);
    const [effect] = await db
      .select()
      .from(schema.cutosToolEffects)
      .where(eq(schema.cutosToolEffects.stepId, stepId));
    await db
      .update(schema.cutosToolEffects)
      .set({ status: "in_flight", updatedAt: new Date(Date.now() - 60 * 60_000) })
      .where(eq(schema.cutosToolEffects.id, effect!.id));
    const stale = await listStaleEffects(5 * 60_000);
    expect(stale.some((entry) => entry.stepId === stepId)).toBe(true);
  });

  it("cancels the CUTOS job when the AIOS side stops", async () => {
    cancelledJobs = [];
    const outcome = await run("cancellable-export", "cutos.export", {}, approved);
    expect(outcome.state).toBe("waiting_external");
    if (outcome.state !== "waiting_external") return;
    const { agentToolRegistry } = await import("./agentToolRegistry");
    const cancel = agentToolRegistry.get("cutos.job.cancel");
    await cancel.handler({ jobId: outcome.jobId }, {
      runId, stepId: "cancellable-export", userId, groupId, projectId,
      idempotencyKey: `cancel:${outcome.jobId}`,
      effectFingerprint: "f", toolCallId: randomUUID(), attemptId: randomUUID(),
      inputTrust: "EXTERNAL_UNTRUSTED", signal: new AbortController().signal,
    });
    expect(cancelledJobs).toContain(outcome.jobId);
  });

  it("never sent a caller-supplied CUTOS project id — the binding decided", () => {
    for (const invocation of invocations) {
      const args = invocation.args as Record<string, unknown>;
      if ("projectId" in args) {
        expect(args.projectId).toBe(cutosProjectId);
      }
      expect(invocation.correlation.cutosProjectId ?? cutosProjectId).toBe(cutosProjectId);
    }
  });

  it("sent an expectedRevision on every timeline mutation", () => {
    const mutations = invocations.filter((invocation) =>
      ["apply_edit_plan", "undo", "redo"].includes(invocation.capability));
    expect(mutations.length).toBeGreaterThan(0);
    for (const mutation of mutations) {
      expect(typeof mutation.expectedRevision).toBe("number");
      expect(mutation.correlation.idempotencyKey).toBeTruthy();
    }
  });

  it("derived an idempotency key that ties run, step, capability and project", () => {
    const apply = invocations.find((invocation) => invocation.capability === "apply_edit_plan")!;
    const key = apply.correlation.idempotencyKey!;
    expect(key.startsWith("cutos.v2:")).toBe(true);
    expect(key).toContain(runId);
    expect(key).toContain(cutosProjectId);
  });
});
