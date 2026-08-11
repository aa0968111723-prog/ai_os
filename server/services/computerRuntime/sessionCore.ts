/**
 * Computer Runtime session orchestration (PR-6A).
 * Durable sessions/actions/leases in Postgres for multi-replica safety.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
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
  isComputerBrowserEnabled,
  isComputerRuntimeEnabled,
  isComputerSessionTerminal,
  type BrowserAction,
  type ComputerSessionSnapshot,
  type ComputerSessionStatus,
} from "../../../shared/computerRuntime";
import {
  mapProviderErrorToCode,
  redactSensitiveActionText,
  validateComputerNavigationUrl,
} from "../../../shared/computerRuntimePolicy";
import type { ComputerEventType } from "../../../shared/computerEvents";
import { computerEventToAgentObservationSummary } from "../../../shared/computerEvents";
import { mockBrowserProvider } from "./mockBrowserProvider";

type SessionRow = typeof schema.computerSessions.$inferSelect;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

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
    startedAt: row.startedAt.toISOString(),
    lastActivityAt: row.lastActivityAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null,
    terminationReason: row.terminationReason,
  };
}

async function emitComputerObservation(input: {
  projectId: string;
  groupId: string;
  runId?: string | null;
  stepId?: string | null;
  sessionId: string;
  eventType: ComputerEventType;
  summary: string;
  status: string;
  safeUrl?: string | null;
  actionKind?: string;
  reason?: { code: string; category: string; userMessage: string; retryable: boolean };
}): Promise<void> {
  if (!input.runId) {
    // Still notify project progress for HUD when no run
    try {
      notifyAgentProgress(input.projectId, {
        runId: input.sessionId,
        stepId: input.stepId ?? undefined,
        eventKey: `computer:${input.sessionId}:${input.eventType}:${Date.now()}`,
        groupId: input.groupId,
      });
    } catch { /* non-fatal */ }
    return;
  }
  await recordAgentEventSafely({
    runId: input.runId,
    groupId: input.groupId,
    projectId: input.projectId,
    stepId: input.stepId,
    eventKey: `computer:${input.sessionId}:${input.eventType}:${randomUUID().slice(0, 8)}`,
    eventType: "observation",
    summary: computerEventToAgentObservationSummary(input.eventType, input.summary),
    data: {
      schemaVersion: 1,
      eventType: input.eventType,
      status: input.status,
      occurredAt: new Date().toISOString(),
      summary: input.summary,
      reason: input.reason,
      computer: {
        sessionId: input.sessionId,
        runtimeKind: "browser",
        controlHolder: "agent",
        safeUrl: input.safeUrl ?? null,
        actionKind: input.actionKind,
      },
    },
  });
}

function assertRuntimeEnabled(): void {
  if (!isComputerRuntimeEnabled() || !isComputerBrowserEnabled()) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "AI 工作電腦尚未啟用（COMPUTER_RUNTIME_ENABLED）",
    });
  }
}

async function loadProjectAuth(auth: AuthState, projectId: string) {
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
  if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "找不到專案" });
  requireGroup(auth, project.groupId);
  assertProjectNotArchived({ status: project.status });
  await assertProjectEditable(auth, { id: project.id, groupId: project.groupId });
  return project;
}

async function countActiveSessions(field: "userId" | "projectId", value: string): Promise<number> {
  const active: ComputerSessionStatus[] = [
    "requested", "provisioning", "ready", "agent_control", "paused",
    "waiting_human", "human_control", "importing_artifacts",
  ];
  const rows = await db
    .select({ id: schema.computerSessions.id })
    .from(schema.computerSessions)
    .where(and(
      eq(schema.computerSessions[field], value),
      inArray(schema.computerSessions.status, active),
    ));
  return rows.length;
}

export async function createComputerSession(input: {
  auth: AuthState;
  projectId: string;
  runId?: string;
  stepId?: string;
  startUrl?: string;
  label?: string;
}): Promise<ComputerSessionSnapshot> {
  assertRuntimeEnabled();
  const project = await loadProjectAuth(input.auth, input.projectId);

  if (await countActiveSessions("userId", input.auth.user.id) >= COMPUTER_SESSION_DEFAULTS.maxConcurrentPerUser) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "同時進行的工作電腦已達上限" });
  }
  if (await countActiveSessions("projectId", project.id) >= COMPUTER_SESSION_DEFAULTS.maxConcurrentPerProject) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "此專案同時進行的工作電腦已達上限" });
  }

  if (input.startUrl) {
    const check = validateComputerNavigationUrl(input.startUrl);
    if (!check.ok) {
      throw new TRPCError({ code: "BAD_REQUEST", message: check.message ?? "起始網址不安全" });
    }
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + COMPUTER_SESSION_DEFAULTS.ttlMs);

  let handle;
  try {
    handle = await mockBrowserProvider.createSession({
      projectId: project.id,
      groupId: project.groupId,
      userId: input.auth.user.id,
      runId: input.runId,
      stepId: input.stepId,
      runtimeKind: "browser",
      startUrl: input.startUrl,
      label: input.label,
    });
  } catch (err) {
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: err instanceof Error ? err.message : "無法建立工作電腦",
    });
  }

  const [row] = await db.insert(schema.computerSessions).values({
    runId: input.runId ?? null,
    stepId: input.stepId ?? null,
    projectId: project.id,
    groupId: project.groupId,
    userId: input.auth.user.id,
    runtimeKind: "browser",
    provider: handle.provider,
    providerSessionRef: handle.providerSessionRef,
    status: "agent_control",
    controlHolder: "agent",
    leaseVersion: 1,
    sessionRevision: 1,
    currentUrl: input.startUrl ? validateComputerNavigationUrl(input.startUrl).sanitizedUrl ?? null : null,
    label: input.label?.slice(0, 160) ?? "AI 工作電腦",
    actionCount: 0,
    startedAt: now,
    lastActivityAt: now,
    expiresAt,
  }).returning();

  await emitComputerObservation({
    projectId: row.projectId,
    groupId: row.groupId,
    runId: row.runId,
    stepId: row.stepId,
    sessionId: row.id,
    eventType: "computer:ready",
    summary: "工作電腦已就緒（Browser）",
    status: row.status,
    safeUrl: row.currentUrl,
  });

  return toSnapshot(row);
}

export async function getComputerSession(
  auth: AuthState,
  sessionId: string,
): Promise<ComputerSessionSnapshot> {
  const row = await loadSessionForAuth(auth, sessionId);
  await maybeExpireSession(row);
  const [fresh] = await db.select().from(schema.computerSessions).where(eq(schema.computerSessions.id, sessionId));
  return toSnapshot(fresh ?? row);
}

async function loadSessionForAuth(auth: AuthState, sessionId: string): Promise<SessionRow> {
  const [row] = await db.select().from(schema.computerSessions).where(eq(schema.computerSessions.id, sessionId));
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "找不到工作電腦 session" });
  requireGroup(auth, row.groupId);
  // Members only see own sessions; leaders/admins can view group sessions
  if (row.userId !== auth.user.id) {
    const role = requireGroup(auth, row.groupId);
    if (role === "member") {
      throw new TRPCError({ code: "FORBIDDEN", message: "沒有權限查看這台工作電腦" });
    }
  }
  return row;
}

async function maybeExpireSession(row: SessionRow): Promise<void> {
  if (isComputerSessionTerminal(row.status)) return;
  const now = Date.now();
  const idleLimit = row.lastActivityAt.getTime() + COMPUTER_SESSION_DEFAULTS.idleMs;
  const expired = now > row.expiresAt.getTime() || now > idleLimit;
  if (!expired) return;
  await stopComputerSessionInternal(row, "expired", "session TTL or idle timeout");
}

export async function listComputerSessionsForProject(
  auth: AuthState,
  projectId: string,
): Promise<ComputerSessionSnapshot[]> {
  if (!isComputerRuntimeEnabled()) return [];
  const [p] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
  if (!p) throw new TRPCError({ code: "NOT_FOUND", message: "找不到專案" });
  requireGroup(auth, p.groupId);
  const fresh = await db
    .select()
    .from(schema.computerSessions)
    .where(eq(schema.computerSessions.projectId, projectId))
    .orderBy(sql`${schema.computerSessions.updatedAt} desc`)
    .limit(20);
  return fresh.map(toSnapshot);
}

export async function listActiveComputerSessionsForGroup(
  auth: AuthState,
  groupId: string,
): Promise<ComputerSessionSnapshot[]> {
  if (!isComputerRuntimeEnabled()) return [];
  requireGroup(auth, groupId);
  const active = [
    "ready", "agent_control", "paused", "waiting_human", "human_control", "provisioning",
  ] as ComputerSessionStatus[];
  const rows = await db
    .select()
    .from(schema.computerSessions)
    .where(and(
      eq(schema.computerSessions.groupId, groupId),
      inArray(schema.computerSessions.status, active),
    ))
    .orderBy(sql`${schema.computerSessions.updatedAt} desc`)
    .limit(30);
  return rows.map(toSnapshot);
}

export async function issueLiveViewToken(input: {
  auth: AuthState;
  sessionId: string;
  mode?: "watch" | "control";
}): Promise<{ token: string; embedUrl: string; expiresAt: string; mode: "watch" | "control" }> {
  assertRuntimeEnabled();
  const row = await loadSessionForAuth(input.auth, input.sessionId);
  await maybeExpireSession(row);
  if (isComputerSessionTerminal(row.status)) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "工作電腦已結束" });
  }
  // PR-6B: control mode only when human holds control (or owner starting takeover flow)
  const mode = input.mode ?? "watch";
  if (mode === "control") {
    const role = requireGroup(input.auth, row.groupId);
    const isOwner = row.userId === input.auth.user.id;
    const isLeader = role !== "member";
    const humanHolds = row.controlHolder === "human" && row.controlHolderUserId === input.auth.user.id;
    const waiting = row.status === "waiting_human";
    if (!isOwner && !isLeader) {
      throw new TRPCError({ code: "FORBIDDEN", message: "沒有權限控制 Live View" });
    }
    if (!humanHolds && !waiting && row.status !== "human_control") {
      // Allow control token only after takeover or while waiting to take over
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "請先「我來操作」取得控制權後再開啟控制模式 Live View",
      });
    }
  }

  const token = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + 60_000);
  await db.insert(schema.computerLiveTokens).values({
    sessionId: row.id,
    userId: input.auth.user.id,
    tokenHash: hashToken(token),
    mode,
    expiresAt,
  });

  const live = await mockBrowserProvider.getLiveView(row.providerSessionRef, mode);
  return {
    token,
    embedUrl: `${live.embedUrl}&token=${encodeURIComponent(token)}`,
    expiresAt: expiresAt.toISOString(),
    mode,
  };
}

export async function resolveLiveViewByToken(token: string): Promise<{
  sessionId: string;
  mode: "watch" | "control";
  currentUrl: string | null;
  status: string;
  label: string | null;
}> {
  const th = hashToken(token);
  const [tok] = await db
    .select()
    .from(schema.computerLiveTokens)
    .where(eq(schema.computerLiveTokens.tokenHash, th))
    .limit(1);
  if (!tok || tok.revoked || tok.expiresAt.getTime() < Date.now()) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Live View 連結已失效" });
  }
  const [session] = await db
    .select()
    .from(schema.computerSessions)
    .where(eq(schema.computerSessions.id, tok.sessionId));
  if (!session || isComputerSessionTerminal(session.status)) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "工作電腦已結束" });
  }
  return {
    sessionId: session.id,
    mode: tok.mode,
    currentUrl: session.currentUrl,
    status: session.status,
    label: session.label,
  };
}

export async function runComputerAction(input: {
  auth: AuthState;
  sessionId: string;
  actionId: string;
  action: BrowserAction;
  leaseVersion?: number;
  expectedSessionRevision?: number;
}): Promise<{
  status: string;
  resultSummary: string;
  observation?: { url: string; title: string; summary: string };
  errorCode?: string;
  session: ComputerSessionSnapshot;
}> {
  assertRuntimeEnabled();
  const row = await loadSessionForAuth(input.auth, input.sessionId);
  if (row.userId !== input.auth.user.id) {
    throw new TRPCError({ code: "FORBIDDEN", message: "只有發起人可以操作工作電腦" });
  }
  await assertProjectEditable(input.auth, { id: row.projectId, groupId: row.groupId });
  await maybeExpireSession(row);

  // Idempotent replay
  const [existing] = await db
    .select()
    .from(schema.computerActions)
    .where(eq(schema.computerActions.actionId, input.actionId))
    .limit(1);
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
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "工作電腦已結束，無法執行動作" });
  }
  if (!canAcceptComputerAction(current.status, current.controlHolder)) {
    throw new TRPCError({
      code: "CONFLICT",
      message: current.status === "human_control" || current.controlHolder === "human"
        ? "使用者正在控制工作電腦，AI 操作已凍結"
        : current.status === "waiting_human"
          ? "正在等待你接管，AI 操作已凍結"
          : "目前無法由 AI 操作（可能已停止或暫停）",
    });
  }
  // After hand-back, first successful inspect clears needsReobserve; other acts require re-observe
  if (current.needsReobserve && input.action.kind !== "inspect") {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "交回 AI 後必須先重新觀察畫面（inspect），不可沿用接管前狀態",
    });
  }
  if (input.leaseVersion != null && input.leaseVersion !== current.leaseVersion) {
    throw new TRPCError({ code: "CONFLICT", message: "控制權版本不符，請重新 observe" });
  }
  if (input.expectedSessionRevision != null && input.expectedSessionRevision !== current.sessionRevision) {
    throw new TRPCError({ code: "CONFLICT", message: "session revision 不符，請重新 observe" });
  }
  if (current.actionCount >= COMPUTER_SESSION_DEFAULTS.maxActions) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "此工作電腦動作次數已達上限" });
  }

  let safeTarget = "";
  if (input.action.kind === "navigate") {
    const check = validateComputerNavigationUrl(input.action.url);
    if (!check.ok || !check.sanitizedUrl) {
      throw new TRPCError({ code: "BAD_REQUEST", message: check.message ?? "不安全的導航目標" });
    }
    safeTarget = check.sanitizedUrl;
    input = { ...input, action: { ...input.action, url: check.sanitizedUrl } };
  } else if (input.action.kind === "click") {
    safeTarget = input.action.selector.slice(0, 200);
  } else if (input.action.kind === "type") {
    const red = redactSensitiveActionText(input.action.text, input.action.sensitive);
    safeTarget = `${input.action.selector.slice(0, 80)} → ${red.safeTarget}`;
  } else {
    safeTarget = input.action.kind;
  }

  const sequence = current.actionCount + 1;
  const [actionRow] = await db.insert(schema.computerActions).values({
    sessionId: current.id,
    runId: current.runId,
    stepId: current.stepId,
    actionId: input.actionId,
    sequence,
    actorType: "agent",
    actionKind: input.action.kind === "inspect" ? "inspect" : input.action.kind,
    safeTarget,
    status: "running",
    riskLevel: "low",
    leaseVersion: current.leaseVersion,
    expectedSessionRevision: current.sessionRevision,
  }).returning();

  let result;
  try {
    result = await mockBrowserProvider.act({
      providerSessionRef: current.providerSessionRef,
      action: input.action,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const code = mapProviderErrorToCode(msg);
    await db.update(schema.computerActions).set({
      status: "failed",
      errorCode: code,
      resultSummary: msg.slice(0, 500),
      completedAt: new Date(),
    }).where(eq(schema.computerActions.id, actionRow.id));
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: msg });
  }

  const now = new Date();
  await db.update(schema.computerActions).set({
    status: result.ok ? "completed" : "failed",
    errorCode: result.errorCode ?? null,
    resultSummary: result.summary.slice(0, 500),
    completedAt: now,
  }).where(eq(schema.computerActions.id, actionRow.id));

  const [updated] = await db.update(schema.computerSessions).set({
    actionCount: sequence,
    sessionRevision: current.sessionRevision + 1,
    lastActivityAt: now,
    currentUrl: result.observation?.url ?? current.currentUrl,
    updatedAt: now,
    status: current.status === "ready" ? "agent_control" : current.status,
    // Successful inspect after hand-back clears the reobserve gate
    needsReobserve: input.action.kind === "inspect" && result.ok ? false : current.needsReobserve,
  }).where(and(
    eq(schema.computerSessions.id, current.id),
    eq(schema.computerSessions.sessionRevision, current.sessionRevision),
  )).returning();

  // If CAS lost, still return best-effort snapshot
  const finalRow = updated ?? (await db.select().from(schema.computerSessions).where(eq(schema.computerSessions.id, current.id)))[0]!;

  await emitComputerObservation({
    projectId: finalRow.projectId,
    groupId: finalRow.groupId,
    runId: finalRow.runId,
    stepId: finalRow.stepId,
    sessionId: finalRow.id,
    eventType: result.ok ? "computer:action_completed" : "computer:action_failed",
    summary: result.summary,
    status: finalRow.status,
    safeUrl: finalRow.currentUrl,
    actionKind: input.action.kind,
    reason: result.ok ? undefined : {
      code: result.errorCode ?? "COMPUTER_ACTION_REJECTED",
      category: "upstream",
      userMessage: result.summary,
      retryable: true,
    },
  });

  return {
    status: result.ok ? "completed" : "failed",
    resultSummary: result.summary,
    observation: result.observation
      ? { url: result.observation.url, title: result.observation.title, summary: result.observation.summary }
      : undefined,
    errorCode: result.errorCode,
    session: toSnapshot(finalRow),
  };
}

async function stopComputerSessionInternal(
  row: SessionRow,
  status: "stopped" | "expired" | "failed",
  reason: string,
): Promise<SessionRow> {
  if (isComputerSessionTerminal(row.status)) return row;
  try {
    await mockBrowserProvider.terminateSession(row.providerSessionRef);
  } catch {
    // still mark stopped; cleanup best-effort
  }
  await db.update(schema.computerLiveTokens).set({ revoked: true })
    .where(eq(schema.computerLiveTokens.sessionId, row.id));
  // cancel queued/running actions
  await db.update(schema.computerActions).set({
    status: "cancelled",
    completedAt: new Date(),
    resultSummary: "session stopped",
  }).where(and(
    eq(schema.computerActions.sessionId, row.id),
    inArray(schema.computerActions.status, ["requested", "running"]),
  ));

  const [updated] = await db.update(schema.computerSessions).set({
    status,
    controlHolder: "none",
    leaseVersion: row.leaseVersion + 1,
    sessionRevision: row.sessionRevision + 1,
    endedAt: new Date(),
    terminationReason: reason.slice(0, 500),
    updatedAt: new Date(),
  }).where(and(
    eq(schema.computerSessions.id, row.id),
    // CAS: only stop if still non-terminal (multi-replica safe)
    inArray(schema.computerSessions.status, [
      "requested", "provisioning", "ready", "agent_control", "paused",
      "waiting_human", "human_control", "importing_artifacts",
    ]),
  )).returning();

  const final = updated ?? row;
  await emitComputerObservation({
    projectId: final.projectId,
    groupId: final.groupId,
    runId: final.runId,
    stepId: final.stepId,
    sessionId: final.id,
    eventType: status === "expired" ? "computer:expired" : status === "failed" ? "computer:failed" : "computer:stopped",
    summary: reason,
    status: final.status,
  });
  return final;
}

export async function stopComputerSession(input: {
  auth: AuthState;
  sessionId: string;
}): Promise<ComputerSessionSnapshot> {
  // Stop allowed even if feature flag flipped off mid-session
  const row = await loadSessionForAuth(input.auth, input.sessionId);
  const canStop = row.userId === input.auth.user.id
    || requireGroup(input.auth, row.groupId) !== "member";
  if (!canStop) {
    throw new TRPCError({ code: "FORBIDDEN", message: "沒有權限停止這台工作電腦" });
  }
  const final = await stopComputerSessionInternal(row, "stopped", "user requested stop");
  return toSnapshot(final);
}

/** Periodic cleanup entry — expire idle sessions (call from runner tick or cron). */
export async function expireStaleComputerSessions(): Promise<number> {
  if (!isComputerRuntimeEnabled()) return 0;
  const now = new Date();
  const idleCutoff = new Date(now.getTime() - COMPUTER_SESSION_DEFAULTS.idleMs);
  const active = [
    "requested", "provisioning", "ready", "agent_control", "paused",
    "waiting_human", "human_control", "importing_artifacts",
  ] as ComputerSessionStatus[];
  const rows = await db
    .select()
    .from(schema.computerSessions)
    .where(and(
      inArray(schema.computerSessions.status, active),
      sql`(${schema.computerSessions.expiresAt} < ${now} or ${schema.computerSessions.lastActivityAt} < ${idleCutoff})`,
    ))
    .limit(50);
  for (const row of rows) {
    await stopComputerSessionInternal(row, "expired", "session TTL or idle timeout");
  }
  return rows.length;
}
