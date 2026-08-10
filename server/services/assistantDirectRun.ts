import { and, eq, inArray, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db, schema } from "../db";
import { requireGroup } from "../trpc";
import type { AuthState } from "./auth";
import type { AgentStep } from "./agentRunner";
import { AgentQuestionResolver } from "./agentQuestionResolver";
import { suspendAgentRunForQuestion } from "./agentQuestionCore";
import { importUrlIntoProject } from "./universalIntake";
import type { AssistantActionResult, ImportActionResult } from "../../shared/assistantActions";
import { recordAgentEventSafely } from "./agentEventCore";

type AgentRunRow = typeof schema.agentRuns.$inferSelect;
type AgentQuestionRow = typeof schema.agentQuestions.$inferSelect;

export interface AssistantDirectAction {
  type: "import_url";
  url: string;
}

export async function createAssistantDirectRun(input: {
  auth: AuthState;
  runId: string;
  groupId: string;
  goal: string;
  action: AssistantDirectAction;
}): Promise<{ run: AgentRunRow; question: AgentQuestionRow | null }> {
  requireGroup(input.auth, input.groupId);
  const step: AgentStep = {
    id: "direct-action",
    kind: "wait_for_human",
    note: input.action.type === "import_url" ? "匯入連結" : "執行動作",
    status: "pending",
    actorType: "ai",
    requiredSlots: ["projectId"],
    assistantAction: input.action,
  };
  const [run] = await db.insert(schema.agentRuns).values({
    id: input.runId,
    projectId: null,
    groupId: input.groupId,
    userId: input.auth.user.id,
    goal: input.goal,
    summary: "Aios 會在你選擇專案後繼續原本的動作。",
    // Not runner-visible until the durable question has been written. This
    // closes the small insert→suspend race for a run that intentionally has no project yet.
    status: "user_controlled",
    currentStep: 0,
    contextSlots: {},
    steps: [step],
    estPoints: 0,
  }).returning();

  const resolution = await AgentQuestionResolver.resolveProjectQuestion({
    auth: input.auth,
    groupId: input.groupId,
  });
  if (resolution.kind === "resolved") {
    const [bound] = await db.update(schema.agentRuns).set({
      projectId: String(resolution.value),
      contextSlots: { projectId: String(resolution.value) },
      steps: [{ ...step, projectId: String(resolution.value) }],
      updatedAt: new Date(),
    }).where(eq(schema.agentRuns.id, run.id)).returning();
    return { run: bound, question: null };
  }
  const question = await suspendAgentRunForQuestion({
    auth: input.auth,
    runId: run.id,
    stepId: step.id,
    question: resolution.question,
  });
  const [suspended] = await db.select().from(schema.agentRuns).where(eq(schema.agentRuns.id, run.id));
  return { run: suspended, question };
}

async function verifiedUrlImport(auth: AuthState, projectId: string, url: string): Promise<ImportActionResult> {
  const imported = await importUrlIntoProject({
    auth,
    projectId,
    url,
    source: "url",
    context: { currentProjectId: projectId },
  });
  const assetId = imported.asset.id;
  const [found] = await db.select({ id: schema.assets.id, projectId: schema.assets.projectId, deletedAt: schema.assets.deletedAt })
    .from(schema.assets).where(eq(schema.assets.id, assetId));
  const verified = !!found && found.projectId === projectId && !found.deletedAt;
  return {
    type: "import",
    source: "url",
    resourceIds: imported.ok && imported.libraryResourceId ? [imported.libraryResourceId] : [],
    assetIds: [assetId],
    intelligenceIds: imported.ok && imported.intelligenceId ? [imported.intelligenceId] : [],
    projectId,
    count: imported.ok ? 1 : 0,
    duplicateCount: imported.ok ? 0 : 1,
    needsReviewCount: imported.ok ? 1 : 0,
    backgroundProcessing: imported.ok,
    verification: verified
      ? { status: "verified", message: "已重新讀取並確認素材存在" }
      : { status: "unverified", message: "動作已送出，但重新讀取驗證未通過" },
  };
}

/** Resume the already-existing run. This never creates another Assistant run. */
export async function resumeAssistantDirectRun(input: {
  auth: AuthState;
  runId: string;
}): Promise<{ run: AgentRunRow; result: AssistantActionResult | null }> {
  const claimed = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`agent-run:${input.runId}`}, 0))`);
    const [run] = await tx.select().from(schema.agentRuns).where(eq(schema.agentRuns.id, input.runId));
    if (!run) throw new TRPCError({ code: "NOT_FOUND", message: "找不到代理執行" });
    requireGroup(input.auth, run.groupId);
    if (run.userId !== input.auth.user.id) throw new TRPCError({ code: "FORBIDDEN", message: "這不是你的代理執行" });
    const steps = (run.steps as AgentStep[]).map((step) => ({ ...step }));
    const step = steps[run.currentStep] ?? steps.find((candidate) => candidate.assistantAction);
    if (!step?.assistantAction) return { run, step: null, claimed: false };
    if (step.status === "done") return { run, step, claimed: false };
    if (!run.projectId) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "尚未選擇專案" });
    if (step.status !== "pending") return { run, step, claimed: false };
    step.status = "running";
    step.projectId = run.projectId;
    const [updated] = await tx.update(schema.agentRuns).set({ steps, status: "running", updatedAt: new Date() })
      .where(and(eq(schema.agentRuns.id, run.id), inArray(schema.agentRuns.status, ["running", "waiting", "user_controlled"])))
      .returning();
    if (!updated) throw new TRPCError({ code: "CONFLICT", message: "代理狀態已改變" });
    return { run: updated, step, claimed: true };
  });

  const existing = claimed.step?.assistantResult ?? null;
  if (!claimed.claimed || !claimed.step) return { run: claimed.run, result: existing };
  const action = claimed.step.assistantAction;
  if (!action) throw new TRPCError({ code: "BAD_REQUEST", message: "缺少可執行動作" });
  try {
    const result = action.type === "import_url"
      ? await verifiedUrlImport(input.auth, claimed.run.projectId!, action.url)
      : null;
    if (!result) throw new TRPCError({ code: "BAD_REQUEST", message: "不支援的直接動作" });
    const steps = (claimed.run.steps as AgentStep[]).map((step) => ({ ...step }));
    const index = steps.findIndex((step) => step.id === claimed.step!.id);
    steps[index] = {
      ...steps[index]!,
      status: "done",
      assistantResult: result,
      detail: result.verification.message,
      outputRefs: result.type === "import"
        ? result.assetIds.map((id) => ({ type: "asset", id, label: "匯入素材" }))
        : [],
    };
    const [done] = await db.update(schema.agentRuns).set({
      steps,
      status: "done",
      currentStep: steps.length,
      error: null,
      updatedAt: new Date(),
    }).where(eq(schema.agentRuns.id, claimed.run.id)).returning();
    await recordAgentEventSafely({
      runId: done.id,
      groupId: done.groupId,
      projectId: done.projectId!,
      stepId: claimed.step.id,
      eventKey: `step:${claimed.step.id}:completed`,
      eventType: "step_completed",
      actorType: "ai",
      actorId: done.userId,
      summary: "連結已匯入並完成讀回驗證",
      data: { kind: action.type, result },
    });
    return { run: done, result };
  } catch (error) {
    const message = error instanceof Error ? error.message : "直接動作執行失敗";
    const steps = (claimed.run.steps as AgentStep[]).map((step) =>
      step.id === claimed.step!.id ? { ...step, status: "failed" as const, detail: message } : step,
    );
    const [failed] = await db.update(schema.agentRuns).set({ steps, status: "failed", error: message, updatedAt: new Date() })
      .where(eq(schema.agentRuns.id, claimed.run.id)).returning();
    await recordAgentEventSafely({
      runId: failed.id,
      groupId: failed.groupId,
      projectId: failed.projectId,
      stepId: claimed.step.id,
      eventKey: `step:${claimed.step.id}:failed`,
      eventType: "step_failed",
      actorType: "ai",
      actorId: failed.userId,
      summary: message,
      data: { kind: action.type },
    });
    return { run: failed, result: null };
  }
}
