/**
 * PR-6D: Desktop session create, browser→desktop escalation, desktop act / screenshot.
 */
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db, schema } from "../../db";
import { requireGroup } from "../../trpc";
import type { AuthState } from "../auth";
import { assertProjectEditable, assertProjectNotArchived } from "../projectAcl";
import { notifyAgentProgress } from "../realtime";
import { recordAgentEventSafely } from "../agentEventCore";
import {
  canAcceptComputerAction,
  COMPUTER_SESSION_DEFAULTS,
  formatDesktopEscalationReason,
  isComputerDesktopEnabled,
  isComputerRuntimeEnabled,
  isComputerSessionTerminal,
  type ComputerSessionSnapshot,
  type ComputerSessionStatus,
  type DesktopAction,
  type DesktopEscalationReasonCode,
} from "../../../shared/computerRuntime";
import { redactSensitiveActionText } from "../../../shared/computerRuntimePolicy";
import { computerEventToAgentObservationSummary } from "../../../shared/computerEvents";
import type { ComputerEventType } from "../../../shared/computerEvents";
import { mockDesktopProvider } from "./mockDesktopProvider";
import { planDesktopActions } from "./visionPlanner";

type SessionRow = typeof schema.computerSessions.$inferSelect;

function toSnapshot(row: SessionRow): ComputerSessionSnapshot {
  return {
    sessionId: row.id,
    projectId: row.projectId,
    groupId: row.groupId,
    userId: row.userId,
    runId: row.runId,
    stepId: row.stepId,
    runtimeKind: row.runtimeKind,
    provider: row.provider,
    status: row.status,
    controlHolder: row.controlHolder,
    controlHolderUserId: row.controlHolderUserId,
    leaseVersion: row.leaseVersion,
    leaseExpiresAt: row.leaseExpiresAt?.toISOString() ?? null,
    sessionRevision: row.sessionRevision,
    currentUrl: row.currentUrl,
    label: row.label,
    takeoverReason: row.takeoverReason,
    takeoverReasonCode: row.takeoverReasonCode,
    needsReobserve: row.needsReobserve,
    actionCount: row.actionCount,
    screenshotCount: row.screenshotCount,
    escalatedFromSessionId: row.escalatedFromSessionId,
    escalationReason: row.escalationReason,
    currentApp: row.currentApp,
    startedAt: row.startedAt.toISOString(),
    lastActivityAt: row.lastActivityAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null,
    terminationReason: row.terminationReason,
  };
}

function assertDesktopEnabled(): void {
  if (!isComputerRuntimeEnabled() || !isComputerDesktopEnabled()) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "桌面工作電腦尚未啟用（COMPUTER_DESKTOP_ENABLED）",
    });
  }
}

async function loadProject(auth: AuthState, projectId: string) {
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
  if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "找不到專案" });
  requireGroup(auth, project.groupId);
  assertProjectNotArchived({ status: project.status });
  await assertProjectEditable(auth, { id: project.id, groupId: project.groupId });
  return project;
}

async function loadSession(auth: AuthState, sessionId: string): Promise<SessionRow> {
  const [row] = await db.select().from(schema.computerSessions).where(eq(schema.computerSessions.id, sessionId));
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "找不到工作電腦 session" });
  requireGroup(auth, row.groupId);
  if (row.userId !== auth.user.id) {
    const role = requireGroup(auth, row.groupId);
    if (role === "member") throw new TRPCError({ code: "FORBIDDEN", message: "沒有權限" });
  }
  return row;
}

async function emit(input: {
  row: SessionRow;
  eventType: ComputerEventType;
  summary: string;
}): Promise<void> {
  if (input.row.runId) {
    await recordAgentEventSafely({
      runId: input.row.runId,
      groupId: input.row.groupId,
      projectId: input.row.projectId,
      stepId: input.row.stepId,
      eventKey: `computer:${input.row.id}:${input.eventType}:${randomUUID().slice(0, 8)}`,
      eventType: "observation",
      summary: computerEventToAgentObservationSummary(input.eventType, input.summary),
      data: {
        schemaVersion: 1,
        eventType: input.eventType,
        status: input.row.status,
        summary: input.summary,
        computer: {
          sessionId: input.row.id,
          runtimeKind: input.row.runtimeKind,
          controlHolder: input.row.controlHolder,
          safeUrl: input.row.currentUrl,
        },
      },
    });
  } else {
    try {
      notifyAgentProgress(input.row.projectId, {
        runId: input.row.id,
        eventKey: `computer:${input.eventType}:${input.row.id}`,
        groupId: input.row.groupId,
      });
    } catch { /* */ }
  }
}

export async function createDesktopSession(input: {
  auth: AuthState;
  projectId: string;
  runId?: string;
  stepId?: string;
  startApp?: string;
  label?: string;
  escalatedFromSessionId?: string;
  escalationReason?: string;
}): Promise<ComputerSessionSnapshot> {
  assertDesktopEnabled();
  const project = await loadProject(input.auth, input.projectId);

  const active: ComputerSessionStatus[] = [
    "requested", "provisioning", "ready", "agent_control", "paused",
    "waiting_human", "human_control", "importing_artifacts",
  ];
  const userActive = await db.select({ id: schema.computerSessions.id }).from(schema.computerSessions)
    .where(and(eq(schema.computerSessions.userId, input.auth.user.id), inArray(schema.computerSessions.status, active)));
  if (userActive.length >= COMPUTER_SESSION_DEFAULTS.maxConcurrentPerUser) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "同時進行的工作電腦已達上限" });
  }

  let handle;
  try {
    handle = await mockDesktopProvider.createSession({
      projectId: project.id,
      groupId: project.groupId,
      userId: input.auth.user.id,
      runId: input.runId,
      stepId: input.stepId,
      runtimeKind: "desktop",
      startApp: input.startApp,
      label: input.label,
      escalatedFromSessionId: input.escalatedFromSessionId,
      escalationReason: input.escalationReason,
    });
  } catch (err) {
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: err instanceof Error ? err.message : "無法建立桌面工作電腦",
    });
  }

  const now = new Date();
  const [row] = await db.insert(schema.computerSessions).values({
    runId: input.runId ?? null,
    stepId: input.stepId ?? null,
    projectId: project.id,
    groupId: project.groupId,
    userId: input.auth.user.id,
    runtimeKind: "desktop",
    provider: handle.provider,
    providerSessionRef: handle.providerSessionRef,
    status: "agent_control",
    controlHolder: "agent",
    leaseVersion: 1,
    sessionRevision: 1,
    currentUrl: `desktop://${(input.startApp ?? "desktop").slice(0, 40)}`,
    currentApp: (input.startApp ?? "desktop").slice(0, 40),
    label: (input.label ?? "AI 桌面工作電腦").slice(0, 160),
    actionCount: 0,
    screenshotCount: 0,
    escalatedFromSessionId: input.escalatedFromSessionId ?? null,
    escalationReason: input.escalationReason?.slice(0, 500) ?? null,
    startedAt: now,
    lastActivityAt: now,
    expiresAt: new Date(now.getTime() + COMPUTER_SESSION_DEFAULTS.ttlMs),
  }).returning();

  await emit({
    row,
    eventType: "computer:ready",
    summary: input.escalationReason
      ? `桌面工作電腦已就緒（由 Browser 升級：${input.escalationReason}）`
      : "桌面工作電腦已就緒",
  });

  return toSnapshot(row);
}

/**
 * Escalate browser session → new desktop session.
 * Browser session is stopped (not deleted) with termination reason.
 */
export async function escalateBrowserToDesktop(input: {
  auth: AuthState;
  browserSessionId: string;
  reasonCode: DesktopEscalationReasonCode;
  detail?: string;
  startApp?: string;
}): Promise<{ desktop: ComputerSessionSnapshot; browser: ComputerSessionSnapshot }> {
  assertDesktopEnabled();
  const browser = await loadSession(input.auth, input.browserSessionId);
  if (browser.runtimeKind !== "browser") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "只能從 Browser session 升級" });
  }
  if (isComputerSessionTerminal(browser.status)) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Browser session 已結束" });
  }
  if (browser.userId !== input.auth.user.id) {
    throw new TRPCError({ code: "FORBIDDEN", message: "只有發起人可以升級到桌面" });
  }

  const reason = formatDesktopEscalationReason(input.reasonCode, input.detail);

  // Stop browser session (CAS)
  try {
    await (await import("./mockBrowserProvider")).mockBrowserProvider.terminateSession(browser.providerSessionRef);
  } catch { /* */ }

  const now = new Date();
  const [stoppedBrowser] = await db.update(schema.computerSessions).set({
    status: "stopped",
    controlHolder: "none",
    leaseVersion: browser.leaseVersion + 1,
    sessionRevision: browser.sessionRevision + 1,
    endedAt: now,
    terminationReason: `escalated_to_desktop: ${reason}`.slice(0, 500),
    updatedAt: now,
  }).where(and(
    eq(schema.computerSessions.id, browser.id),
    eq(schema.computerSessions.leaseVersion, browser.leaseVersion),
  )).returning();

  if (!stoppedBrowser) {
    throw new TRPCError({ code: "CONFLICT", message: "Browser session 狀態已變更，無法升級" });
  }

  await emit({
    row: stoppedBrowser,
    eventType: "computer:stopped",
    summary: `Browser 已停止並升級 Desktop：${reason}`,
  });

  const desktop = await createDesktopSession({
    auth: input.auth,
    projectId: browser.projectId,
    runId: browser.runId ?? undefined,
    stepId: browser.stepId ?? undefined,
    startApp: input.startApp,
    label: "AI 桌面工作電腦",
    escalatedFromSessionId: browser.id,
    escalationReason: reason,
  });

  return { desktop, browser: toSnapshot(stoppedBrowser) };
}

export async function runDesktopAction(input: {
  auth: AuthState;
  sessionId: string;
  actionId: string;
  action: DesktopAction;
  leaseVersion?: number;
  expectedSessionRevision?: number;
}): Promise<{
  status: string;
  resultSummary: string;
  screenshotSummary?: string;
  errorCode?: string;
  session: ComputerSessionSnapshot;
}> {
  assertDesktopEnabled();
  const row = await loadSession(input.auth, input.sessionId);
  if (row.runtimeKind !== "desktop") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "此 session 不是桌面工作電腦" });
  }
  if (row.userId !== input.auth.user.id) {
    throw new TRPCError({ code: "FORBIDDEN", message: "只有發起人可以操作" });
  }
  await assertProjectEditable(input.auth, { id: row.projectId, groupId: row.groupId });

  const [existing] = await db.select().from(schema.computerActions)
    .where(eq(schema.computerActions.actionId, input.actionId)).limit(1);
  if (existing) {
    const [fresh] = await db.select().from(schema.computerSessions).where(eq(schema.computerSessions.id, row.id));
    return {
      status: existing.status,
      resultSummary: existing.resultSummary ?? "",
      errorCode: existing.errorCode ?? undefined,
      session: toSnapshot(fresh ?? row),
    };
  }

  const [current] = await db.select().from(schema.computerSessions).where(eq(schema.computerSessions.id, row.id));
  if (!current || isComputerSessionTerminal(current.status)) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "工作電腦已結束" });
  }
  if (!canAcceptComputerAction(current.status, current.controlHolder)) {
    throw new TRPCError({ code: "CONFLICT", message: "目前無法由 AI 操作桌面（可能正由使用者控制）" });
  }
  if (current.needsReobserve && input.action.kind !== "screenshot") {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "交回 AI 後必須先 screenshot 重新觀察",
    });
  }
  if (input.leaseVersion != null && input.leaseVersion !== current.leaseVersion) {
    throw new TRPCError({ code: "CONFLICT", message: "lease 版本不符" });
  }
  if (input.expectedSessionRevision != null && input.expectedSessionRevision !== current.sessionRevision) {
    throw new TRPCError({ code: "CONFLICT", message: "session revision 不符" });
  }
  if (current.actionCount >= COMPUTER_SESSION_DEFAULTS.maxDesktopActions) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "桌面動作次數已達上限" });
  }
  if (
    (input.action.kind === "screenshot")
    && current.screenshotCount >= COMPUTER_SESSION_DEFAULTS.maxScreenshots
  ) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "截圖次數已達上限（vision loop guard）" });
  }

  let safeTarget: string = input.action.kind;
  if (input.action.kind === "click") {
    safeTarget = `click(${input.action.x},${input.action.y})`;
  } else if (input.action.kind === "type") {
    const red = redactSensitiveActionText(input.action.text, input.action.sensitive);
    safeTarget = `type:${red.safeTarget}`;
  } else if (input.action.kind === "key") {
    safeTarget = `key:${input.action.key}`;
  }

  const sequence = current.actionCount + 1;
  const [actionRow] = await db.insert(schema.computerActions).values({
    sessionId: current.id,
    runId: current.runId,
    stepId: current.stepId,
    actionId: input.actionId,
    sequence,
    actorType: "agent",
    actionKind: input.action.kind === "screenshot" ? "inspect" : input.action.kind as typeof schema.computerActions.$inferInsert["actionKind"],
    safeTarget,
    status: "running",
    riskLevel: "medium",
    leaseVersion: current.leaseVersion,
    expectedSessionRevision: current.sessionRevision,
  }).returning();

  let result;
  try {
    result = await mockDesktopProvider.act({
      providerSessionRef: current.providerSessionRef,
      action: input.action,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db.update(schema.computerActions).set({
      status: "failed",
      errorCode: "COMPUTER_ACTION_REJECTED",
      resultSummary: msg.slice(0, 500),
      completedAt: new Date(),
    }).where(eq(schema.computerActions.id, actionRow.id));
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: msg });
  }

  const now = new Date();
  const isShot = input.action.kind === "screenshot";
  await db.update(schema.computerActions).set({
    status: result.ok ? "completed" : "failed",
    errorCode: result.errorCode ?? null,
    // Never store image data URL in result_summary
    resultSummary: result.summary.slice(0, 500),
    completedAt: now,
  }).where(eq(schema.computerActions.id, actionRow.id));

  const [updated] = await db.update(schema.computerSessions).set({
    actionCount: sequence,
    screenshotCount: isShot && result.ok ? current.screenshotCount + 1 : current.screenshotCount,
    sessionRevision: current.sessionRevision + 1,
    lastActivityAt: now,
    currentUrl: result.observation?.url ?? current.currentUrl,
    currentApp: result.observation?.title ?? current.currentApp,
    needsReobserve: isShot && result.ok ? false : current.needsReobserve,
    updatedAt: now,
  }).where(and(
    eq(schema.computerSessions.id, current.id),
    eq(schema.computerSessions.sessionRevision, current.sessionRevision),
  )).returning();

  const finalRow = updated ?? current;
  await emit({
    row: finalRow,
    eventType: result.ok ? "computer:action_completed" : "computer:action_failed",
    summary: result.summary,
  });

  return {
    status: result.ok ? "completed" : "failed",
    resultSummary: result.summary,
    screenshotSummary: isShot ? result.summary : undefined,
    errorCode: result.errorCode,
    session: toSnapshot(finalRow),
  };
}

export async function planAndOptionallyPreviewDesktop(input: {
  auth: AuthState;
  sessionId: string;
  goal: string;
}): Promise<ReturnType<typeof planDesktopActions>> {
  assertDesktopEnabled();
  const row = await loadSession(input.auth, input.sessionId);
  if (row.runtimeKind !== "desktop") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "僅桌面 session 可規劃 vision 動作" });
  }
  // Policy stub only — no automatic execution (caller must act with approval)
  return planDesktopActions({ goal: input.goal, maxSteps: 4 });
}
