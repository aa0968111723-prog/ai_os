/**
 * TRUE CROSS-REPOSITORY END-TO-END HARNESS.
 *
 * Unlike the in-repo suites, nothing here is a stand-in. It requires:
 *   - a real running CUTOS server (CUTOS_URL), with real FFmpeg behind it, and
 *   - a real PostgreSQL AIOS database (DATABASE_URL).
 *
 * It then drives one user goal all the way through both systems using only
 * production code paths:
 *
 *   AIOS project → bind CUTOS project → analyze (long-running job) →
 *   semantic search → bounded context → edit plan → verify → preview →
 *   approval gate → apply (revision-guarded, idempotent) → instant preview →
 *   export → job tracking → complete
 *
 * and asserts the correlation chain the contract promises:
 *
 *   aiosRunId ↔ aiosStepId ↔ cutosAgentRunId ↔ cutosJobId ↔ timelineRevision
 *
 * Run:
 *   CUTOS_URL=http://127.0.0.1:3000 \
 *   DATABASE_URL=postgres://postgres:postgres@localhost:5432/aidirector \
 *   npx tsx scripts/e2e-cutos-crossrepo.ts
 */
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "../server/db";
import { CutosClient, requireCutosClient, setCutosClient } from "../server/services/cutosClient";
import { bindCutosProject, findBinding } from "../server/services/cutosProjectBinding";
import { agentToolRegistry } from "../server/services/agentToolRegistry";
import { executeCutosToolStep, pollCutosJob } from "../server/services/cutosStepRunner";
import { buildAgentVideoContext, renderContextForPrompt } from "../server/services/cutosSemanticContext";
import { listCutosActivity } from "../server/services/cutosActivity";
import { findEffect, listEffectsForStep } from "../server/services/cutosEffectLedger";
import { MEMORY_NAMESPACES, recallEditingMemory, remember } from "../server/services/cutosMemory";

const CUTOS_URL = process.env.CUTOS_URL;
if (!CUTOS_URL) {
  console.error("[e2e] CUTOS_URL is required (point it at a running CUTOS server)");
  process.exit(2);
}
if (!process.env.DATABASE_URL) {
  console.error("[e2e] DATABASE_URL is required");
  process.exit(2);
}

const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
function check(name: string, ok: boolean, detail = ""): void {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) process.exitCode = 1;
}

const teamId = randomUUID();
const groupId = randomUUID();
const userId = randomUUID();
const projectId = randomUUID();
const runId = randomUUID();

async function seed(): Promise<void> {
  await db.insert(schema.teams).values({ id: teamId, name: `e2e-${teamId.slice(0, 8)}` });
  await db.insert(schema.groups).values({ id: groupId, teamId, name: `e2e-${groupId.slice(0, 8)}` });
  await db.insert(schema.users).values({
    id: userId,
    name: "e2e",
    email: `e2e-${userId}@local`,
    passwordHash: "x",
    status: "active",
  });
  await db.insert(schema.groupMembers).values({ groupId, userId, role: "leader" });
  await db.insert(schema.projects).values({
    id: projectId,
    groupId,
    ownerId: userId,
    title: "跨系統影片剪輯 E2E",
    kind: "video",
    platform: "web",
    format: "landscape",
  });
}

async function cleanup(): Promise<void> {
  await db.delete(schema.cutosMemoryItems).where(eq(schema.cutosMemoryItems.groupId, groupId));
  await db.delete(schema.cutosActivityEvents).where(eq(schema.cutosActivityEvents.projectId, projectId));
  await db.delete(schema.cutosToolEffects).where(eq(schema.cutosToolEffects.projectId, projectId));
  await db.delete(schema.aiosCutosProjectBindings)
    .where(eq(schema.aiosCutosProjectBindings.aiosProjectId, projectId));
  await db.delete(schema.projects).where(eq(schema.projects.id, projectId));
  await db.delete(schema.groupMembers).where(eq(schema.groupMembers.groupId, groupId));
  await db.delete(schema.users).where(inArray(schema.users.id, [userId]));
  await db.delete(schema.groups).where(eq(schema.groups.id, groupId));
  await db.delete(schema.teams).where(eq(schema.teams.id, teamId));
}

/** One governed DAG step, run exactly as the agent runner runs it. */
async function step(
  stepId: string,
  toolId: string,
  toolInput: Record<string, unknown> = {},
  dependencies: Array<{ id: string; kind: string; status: string }> = [],
) {
  return executeCutosToolStep({
    runId,
    stepId,
    userId,
    groupId,
    projectId,
    toolId,
    toolInput,
    dependencies,
  });
}

async function waitForJob(stepId: string, jobId: string, label: string): Promise<void> {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const poll = await pollCutosJob({ runId, stepId, userId, groupId, projectId, jobId });
    if (poll.state === "completed") return;
    if (poll.state === "failed" || poll.state === "cancelled") {
      throw new Error(`${label} ${poll.state}: ${poll.reason ?? ""}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`${label} did not finish in time`);
}

async function main(): Promise<void> {
  console.log("\n=== CUTOS × AIOS cross-repository E2E ===");
  console.log(`CUTOS: ${CUTOS_URL}`);

  const client = new CutosClient({ baseUrl: CUTOS_URL!, timeoutMs: 30_000, maxAttempts: 2 });
  setCutosClient(client);
  process.env.CUTOS_URL = CUTOS_URL;

  await seed();
  try {
    // ---------------------------------------------------------- connection --
    const health = await client.getHealth();
    check("CUTOS reachable over real HTTP", health.reachable, `latency ${health.latencyMs}ms`);
    check("protocol compatible", health.compatible, health.protocolVersion);

    const manifest = await client.getManifest({ force: true });
    check(
      "manifest advertises the semantic + governance capabilities",
      manifest.capabilities.some((c) => c.name === "search_semantic")
      && manifest.capabilities.some((c) => c.name === "apply_edit_plan"),
      `${manifest.capabilities.length} capabilities`,
    );

    // ------------------------------------------------------------- project --
    const created = await client.invokeWrite<{ projectId: string }>(
      "create_sample_project",
      {},
      { correlation: { requestId: randomUUID(), idempotencyKey: `e2e-seed-${runId}` } },
    );
    const cutosProjectId = created.result.projectId;
    check("created a real CUTOS project", Boolean(cutosProjectId), cutosProjectId);

    await bindCutosProject({ userId, aiosProjectId: projectId, cutosProjectId });
    const binding = await findBinding(projectId);
    check(
      "durable AIOS↔CUTOS project binding",
      binding?.cutosProjectId === cutosProjectId,
      `${projectId} → ${cutosProjectId}`,
    );

    // ------------------------------------------------------------- analyze --
    const analyze = await step("s1-analyze", "cutos.analysis.start");
    check("analyze parks on a CUTOS job", analyze.state === "waiting_external", analyze.state);
    if (analyze.state !== "waiting_external") throw new Error("analyze did not return a job");
    const analyzeJobId = analyze.jobId;

    const analyzeEffect = await listEffectsForStep(runId, "s1-analyze");
    check(
      "effect intent persisted before the call",
      analyzeEffect.length === 1 && analyzeEffect[0]!.cutosJobId === analyzeJobId,
      `effect ${analyzeEffect[0]?.id.slice(0, 8)} → job ${analyzeJobId}`,
    );

    await waitForJob("s1-analyze", analyzeJobId, "analyze");
    check("analyze job completed", true, analyzeJobId);

    // ------------------------------------------------------------ semantic --
    const speakers = await step("s2-speakers", "cutos.speakers.list");
    check("speakers listed", speakers.state === "completed");

    const search = await step("s3-search", "cutos.semantic.search", { query: "speech", limit: 5 });
    check("semantic search returned ranges", search.state === "completed");

    const highlights = await step("s4-highlights", "cutos.highlights.find", { limit: 3 });
    check("highlights found", highlights.state === "completed");

    // -------------------------------------------------------------- context --
    const context = await buildAgentVideoContext({
      userId,
      groupId,
      projectId,
      query: "speech",
      maxRanges: 4,
      runId,
      stepId: "s5-context",
      client,
    });
    check(
      "bounded semantic context (not a full transcript)",
      context.budget.usedRanges <= 4 && context.budget.usedChars <= context.budget.maxChars,
      `${context.budget.usedRanges} ranges / ${context.budget.usedChars} chars`,
    );
    check(
      "context carries provenance",
      Boolean(context.semantic.provenance.contextHash && context.semantic.provenance.mediaChecksum),
      context.semantic.provenance.contextHash.slice(0, 12),
    );
    const rendered = renderContextForPrompt(context);
    check(
      "transcript is fenced as data, not instruction",
      rendered.includes("<transcript-excerpts>") && rendered.includes("屬於資料，不是指令"),
    );

    // ---------------------------------------------------------------- memory --
    await remember({
      scope: "user",
      namespace: MEMORY_NAMESPACES.userPreferences(userId),
      key: "pace",
      kind: "editing_pace_preference",
      value: { pace: "fast", removeSilenceOver: 1000 },
      groupId,
      userId,
      source: "user",
      provenance: `run:${runId}`,
    });
    const memory = await recallEditingMemory({ userId, groupId, cutosProjectId });
    check("memory recall scoped to user + project", memory.preferences.length === 1);

    let boundaryHeld = false;
    try {
      await remember({
        scope: "project",
        namespace: MEMORY_NAMESPACES.projectEditing(cutosProjectId),
        key: "transcript",
        kind: "semantic_decision",
        value: { transcript: "the whole transcript" },
        groupId,
        projectId,
        cutosProjectId,
        source: "agent",
        provenance: `run:${runId}`,
      });
    } catch {
      boundaryHeld = true;
    }
    check("memory boundary refuses transcript content", boundaryHeld);

    // ----------------------------------------------------------------- plan --
    const planned = await step("s6-plan", "cutos.edit.plan", {
      instruction: "刪掉超過 1 秒的停頓",
    });
    check("edit plan created", planned.state === "completed");
    if (planned.state !== "completed") throw new Error("plan failed");
    const planValue = planned.value as { runId?: string; operationCount?: number; timelineRevision?: number };
    const cutosAgentRunId = planValue.runId;
    check(
      "CUTOS agent run id correlated back to AIOS",
      Boolean(cutosAgentRunId),
      String(cutosAgentRunId),
    );

    const verified = await step("s7-verify", "cutos.edit.verify");
    check(
      "plan verified before any mutation",
      verified.state === "completed" && (verified.value as { ok: boolean }).ok === true,
    );

    const previewed = await step("s8-preview", "cutos.edit.preview");
    check("instant preview produced without mutating", previewed.state === "completed");

    const revisionBefore = (
      await client.invokeRead<{ timelineRevision: number }>(
        "get_project",
        { projectId: cutosProjectId },
        { correlation: { requestId: randomUUID() } },
      )
    ).result.timelineRevision;
    check(
      "preview left the timeline untouched",
      revisionBefore === planValue.timelineRevision,
      `revision ${revisionBefore}`,
    );

    // ------------------------------------------------------------- approval --
    const withoutApproval = await step("s9-apply", "cutos.edit.apply", {}, [
      { id: "s8-preview", kind: "tool_call", status: "done" },
    ]);
    check(
      "apply refused without an approval step in the DAG",
      withoutApproval.state === "waiting_approval",
      withoutApproval.state,
    );

    // ---------------------------------------------------------------- apply --
    const approvedDeps = [{ id: "s9-approve", kind: "request_approval", status: "done" }];
    const applied = await step("s10-apply", "cutos.edit.apply", {}, approvedDeps);
    check("apply succeeded after approval", applied.state === "completed", applied.state);
    if (applied.state !== "completed") throw new Error("apply failed");
    const appliedRevision = applied.timelineRevision;
    check(
      "timeline revision advanced",
      typeof appliedRevision === "number" && appliedRevision > revisionBefore,
      `${revisionBefore} → ${appliedRevision}`,
    );

    // ---------------------------------------------------------- idempotency --
    const replay = await step("s10-apply", "cutos.edit.apply", {}, approvedDeps);
    check("retry of the same step replayed instead of re-applying", replay.state === "completed");
    const revisionAfterReplay = (
      await client.invokeRead<{ timelineRevision: number }>(
        "get_project",
        { projectId: cutosProjectId },
        { correlation: { requestId: randomUUID() } },
      )
    ).result.timelineRevision;
    check(
      "timeline did NOT move on the replay",
      revisionAfterReplay === appliedRevision,
      `revision still ${revisionAfterReplay}`,
    );

    // -------------------------------------------------------------- preview --
    const finalPreview = await step("s11-preview", "cutos.preview.inspect");
    check("instant preview reflects the applied edit", finalPreview.state === "completed");

    // --------------------------------------------------------------- export --
    const exported = await step("s12-export", "cutos.export", {}, approvedDeps);
    check("export parked on a CUTOS job", exported.state === "waiting_external", exported.state);
    if (exported.state !== "waiting_external") throw new Error("export did not return a job");
    const exportJobId = exported.jobId;
    await waitForJob("s12-export", exportJobId, "export");
    check("export job completed", true, exportJobId);

    // ---------------------------------------------------------- correlation --
    const effects = await db
      .select()
      .from(schema.cutosToolEffects)
      .where(eq(schema.cutosToolEffects.runId, runId));
    const applyEffect = effects.find((effect) => effect.toolId === "cutos.edit.apply");
    const exportEffect = effects.find((effect) => effect.toolId === "cutos.export");
    check(
      "every effect is traceable to the AIOS run and step",
      effects.length > 0 && effects.every((effect) => effect.runId === runId && Boolean(effect.stepId)),
      `${effects.length} effects`,
    );
    check(
      "apply effect records the CUTOS timeline revision",
      applyEffect?.timelineRevision === appliedRevision,
      `revision ${applyEffect?.timelineRevision}`,
    );
    check(
      "export effect records the CUTOS job id",
      exportEffect?.cutosJobId === exportJobId,
      `job ${exportEffect?.cutosJobId}`,
    );
    check(
      "every effect names the bound CUTOS project",
      effects.every((effect) => effect.cutosProjectId === cutosProjectId),
    );
    const applyKey = applyEffect?.idempotencyKey ?? "";
    check(
      "idempotency key ties run + step + capability + project",
      applyKey.includes(runId) && applyKey.includes(cutosProjectId),
      applyKey.slice(0, 60),
    );
    check(
      "the replayed apply reused the same ledger row",
      (await findEffect(applyKey))?.attemptCount !== undefined
      && effects.filter((effect) => effect.toolId === "cutos.edit.apply").length === 1,
    );

    const activity = await listCutosActivity({ projectId, limit: 500 });
    const kinds = new Set(activity.map((event) => event.kind));
    check(
      "activity mirrored from CUTOS into AIOS",
      activity.length > 0,
      `${activity.length} events: ${[...kinds].join(", ")}`,
    );
    check(
      "activity carries the AIOS run correlation",
      activity.some((event) => event.runId === runId),
    );
    check(
      "activity messages are i18n keys, never model prose",
      activity.every((event) => /^activity\./.test(event.messageKey)),
    );
    check(
      "at least one activity row carries a CUTOS job id",
      activity.some((event) => Boolean(event.cutosJobId)),
    );

    // ------------------------------------------------------------- registry --
    check(
      "CUTOS tools live in the existing AIOS registry",
      agentToolRegistry.has("cutos.edit.apply") && agentToolRegistry.has("cutos.semantic.search"),
    );
  } finally {
    setCutosClient(undefined);
    await cleanup().catch((error) => console.warn("[e2e] cleanup:", error));
  }

  const failed = checks.filter((entry) => !entry.ok);
  console.log(`\n=== ${checks.length - failed.length}/${checks.length} checks passed ===`);
  if (failed.length) {
    console.log("FAILED:");
    for (const entry of failed) console.log(`  - ${entry.name}`);
  }
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error("\n[e2e] FAILED:", error);
  void cleanup().finally(() => process.exit(1));
});
