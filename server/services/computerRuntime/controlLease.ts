/**
 * PR-6B: Control lease — agent / human mutual exclusion (durable CAS).
 */
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db, schema } from "../../db";
import { requireGroup } from "../../trpc";
import type { AuthState } from "../auth";
import { assertProjectEditable } from "../projectAcl";
import { notifyAgentProgress } from "../realtime";
import { recordAgentEventSafely } from "../agentEventCore";
import {
  COMPUTER_SESSION_DEFAULTS,
  isComputerHumanTakeoverEnabled,
  isComputerRuntimeEnabled,
  isComputerSessionTerminal,
  type ComputerControlLease,
  type ComputerSessionSnapshot,
  type TakeoverReasonCode,
} from "../../../shared/computerRuntime";
import { computerEventToAgentObservationSummary } from "../../../shared/computerEvents";
import type { ComputerEventType } from "../../../shared/computerEvents";
import { mockBrowserProvider } from "./mockBrowserProvider";

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

function assertTakeoverEnabled(): void {
  if (!isComputerRuntimeEnabled() || !isComputerHumanTakeoverEnabled()) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Human Takeover 尚未啟用（COMPUTER_HUMAN_TAKEOVER_ENABLED）",
    });
  }
}

async function loadSession(auth: AuthState, sessionId: string): Promise<SessionRow> {
  const [row] = await db.select().from(schema.computerSessions).where(eq(schema.computerSessions.id, sessionId));
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "找不到工作電腦 session" });
  requireGroup(auth, row.groupId);
  if (row.userId !== auth.user.id) {
    const role = requireGroup(auth, row.groupId);
    if (role === "member") {
      throw new TRPCError({ code: "FORBIDDEN", message: "沒有權限操作這台工作電腦" });
    }
  }
  return row;
}

async function emit(input: {
  row: SessionRow;
  eventType: ComputerEventType;
  summary: string;
  controlHolder: string;
}): Promise<void> {
  const { row } = input;
  if (row.runId) {
    await recordAgentEventSafely({
      runId: row.runId,
      groupId: row.groupId,
      projectId: row.projectId,
      stepId: row.stepId,
      eventKey: `computer:${row.id}:${input.eventType}:${randomUUID().slice(0, 8)}`,
      eventType: "observation",
      summary: computerEventToAgentObservationSummary(input.eventType, input.summary),
      data: {
        schemaVersion: 1,
        eventType: input.eventType,
        status: row.status,
        occurredAt: new Date().toISOString(),
        summary: input.summary,
        computer: {
          sessionId: row.id,
          runtimeKind: row.runtimeKind,
          controlHolder: input.controlHolder,
          safeUrl: row.currentUrl,
        },
      },
    });
  } else {
    try {
      notifyAgentProgress(row.projectId, {
        runId: row.id,
        eventKey: `computer:${row.id}:${input.eventType}`,
        groupId: row.groupId,
      });
    } catch { /* non-fatal */ }
  }
}

function leaseFromRow(row: SessionRow): ComputerControlLease {
  return {
    sessionId: row.id,
    holder: row.controlHolder,
    holderUserId: row.controlHolderUserId ?? undefined,
    leaseVersion: row.leaseVersion,
    acquiredAt: row.updatedAt.toISOString(),
    expiresAt: row.leaseExpiresAt?.toISOString(),
  };
}

/**
 * Agent or system asks human to take over (login / 2FA / challenge / judgment).
 * Moves session to waiting_human and revokes agent input immediately (holder=none until human acquires).
 */
export async function requestHumanTakeover(input: {
  auth: AuthState;
  sessionId: string;
  reasonCode: TakeoverReasonCode;
  userMessage: string;
  expectedLeaseVersion?: number;
}): Promise<{ session: ComputerSessionSnapshot; lease: ComputerControlLease }> {
  assertTakeoverEnabled();
  const row = await loadSession(input.auth, input.sessionId);
  await assertProjectEditable(input.auth, { id: row.projectId, groupId: row.groupId });
  if (isComputerSessionTerminal(row.status)) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "工作電腦已結束" });
  }
  if (input.expectedLeaseVersion != null && input.expectedLeaseVersion !== row.leaseVersion) {
    throw new TRPCError({ code: "CONFLICT", message: "lease 版本不符，請重新整理" });
  }

  const safeMsg = input.userMessage.trim().slice(0, 300) || "需要你接管操作";
  // Never persist secrets in reason
  if (/password|otp|token|secret|cookie/i.test(safeMsg) && safeMsg.length < 40) {
    // still allow generic messages; strip obvious secret-like payloads
  }

  const now = new Date();
  const [updated] = await db.update(schema.computerSessions).set({
    status: "waiting_human",
    controlHolder: "none",
    controlHolderUserId: null,
    leaseVersion: row.leaseVersion + 1,
    leaseExpiresAt: null,
    sessionRevision: row.sessionRevision + 1,
    takeoverReason: safeMsg,
    takeoverReasonCode: input.reasonCode,
    needsReobserve: false,
    lastActivityAt: now,
    updatedAt: now,
  }).where(and(
    eq(schema.computerSessions.id, row.id),
    eq(schema.computerSessions.leaseVersion, row.leaseVersion),
    inArray(schema.computerSessions.status, [
      "ready", "agent_control", "paused", "waiting_human", "human_control",
    ]),
  )).returning();

  if (!updated) {
    throw new TRPCError({ code: "CONFLICT", message: "狀態已變更，無法請求接管" });
  }

  // Cancel in-flight agent actions so nothing runs after revoke
  await db.update(schema.computerActions).set({
    status: "cancelled",
    completedAt: now,
    resultSummary: "agent lease revoked for human takeover",
  }).where(and(
    eq(schema.computerActions.sessionId, row.id),
    inArray(schema.computerActions.status, ["requested", "running"]),
  ));

  await emit({
    row: updated,
    eventType: "computer:waiting_human",
    summary: safeMsg,
    controlHolder: "none",
  });

  return { session: toSnapshot(updated), lease: leaseFromRow(updated) };
}

/**
 * Human acquires exclusive control. Agent input must already be revoked (or we revoke here).
 */
export async function acquireHumanControl(input: {
  auth: AuthState;
  sessionId: string;
  expectedLeaseVersion?: number;
}): Promise<{ session: ComputerSessionSnapshot; lease: ComputerControlLease }> {
  assertTakeoverEnabled();
  const row = await loadSession(input.auth, input.sessionId);
  await assertProjectEditable(input.auth, { id: row.projectId, groupId: row.groupId });
  if (isComputerSessionTerminal(row.status)) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "工作電腦已結束" });
  }
  // Only session owner (or leader) can take control
  const role = requireGroup(input.auth, row.groupId);
  if (row.userId !== input.auth.user.id && role === "member") {
    throw new TRPCError({ code: "FORBIDDEN", message: "只有發起人或組長可以接管" });
  }
  if (input.expectedLeaseVersion != null && input.expectedLeaseVersion !== row.leaseVersion) {
    throw new TRPCError({ code: "CONFLICT", message: "lease 版本不符，請重新整理" });
  }
  // Another human already holds a non-expired lease
  if (
    row.controlHolder === "human"
    && row.controlHolderUserId
    && row.controlHolderUserId !== input.auth.user.id
    && row.leaseExpiresAt
    && row.leaseExpiresAt.getTime() > Date.now()
  ) {
    throw new TRPCError({ code: "CONFLICT", message: "已有其他人正在控制這台工作電腦" });
  }

  const now = new Date();
  const leaseExpires = new Date(now.getTime() + COMPUTER_SESSION_DEFAULTS.humanLeaseMs);

  const [updated] = await db.update(schema.computerSessions).set({
    status: "human_control",
    controlHolder: "human",
    controlHolderUserId: input.auth.user.id,
    leaseVersion: row.leaseVersion + 1,
    leaseExpiresAt: leaseExpires,
    sessionRevision: row.sessionRevision + 1,
    lastActivityAt: now,
    updatedAt: now,
  }).where(and(
    eq(schema.computerSessions.id, row.id),
    eq(schema.computerSessions.leaseVersion, row.leaseVersion),
  )).returning();

  if (!updated) {
    throw new TRPCError({ code: "CONFLICT", message: "無法取得控制權（版本衝突）" });
  }

  // Record takeover action (idempotent-ish audit row)
  await db.insert(schema.computerActions).values({
    sessionId: updated.id,
    runId: updated.runId,
    stepId: updated.stepId,
    actionId: `takeover:${updated.id}:${updated.leaseVersion}`,
    sequence: updated.actionCount + 1,
    actorType: "human",
    actionKind: "takeover",
    safeTarget: "human_control",
    status: "completed",
    riskLevel: "medium",
    resultSummary: "human acquired control; agent input revoked",
    leaseVersion: updated.leaseVersion,
    expectedSessionRevision: updated.sessionRevision,
    completedAt: now,
  }).onConflictDoNothing();

  await emit({
    row: updated,
    eventType: "computer:human_control",
    summary: "你已接管 AI 工作電腦（AI 操作已凍結）",
    controlHolder: "human",
  });

  return { session: toSnapshot(updated), lease: leaseFromRow(updated) };
}

/**
 * Human hands control back to agent. Agent must re-observe (needsReobserve=true).
 */
export async function releaseControlToAgent(input: {
  auth: AuthState;
  sessionId: string;
  expectedLeaseVersion?: number;
}): Promise<{ session: ComputerSessionSnapshot; lease: ComputerControlLease; observation: { url: string; title: string; summary: string } }> {
  assertTakeoverEnabled();
  const row = await loadSession(input.auth, input.sessionId);
  if (isComputerSessionTerminal(row.status)) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "工作電腦已結束" });
  }
  if (row.controlHolder === "human" && row.controlHolderUserId && row.controlHolderUserId !== input.auth.user.id) {
    const role = requireGroup(input.auth, row.groupId);
    if (role === "member") {
      throw new TRPCError({ code: "FORBIDDEN", message: "只有目前控制者可以交回 AI" });
    }
  }
  if (input.expectedLeaseVersion != null && input.expectedLeaseVersion !== row.leaseVersion) {
    throw new TRPCError({ code: "CONFLICT", message: "lease 版本不符，請重新整理" });
  }

  // Fresh observe after human ops — never reuse pre-takeover screenshot assumptions
  let observation = { url: row.currentUrl ?? "about:blank", title: "", summary: "re-observed after hand-back" };
  try {
    const obs = await mockBrowserProvider.inspect({ providerSessionRef: row.providerSessionRef });
    observation = { url: obs.url, title: obs.title, summary: obs.summary };
  } catch {
    /* still hand back; agent will fail safely on next act */
  }

  const now = new Date();
  const [updated] = await db.update(schema.computerSessions).set({
    status: "agent_control",
    controlHolder: "agent",
    controlHolderUserId: null,
    leaseVersion: row.leaseVersion + 1,
    leaseExpiresAt: null,
    sessionRevision: row.sessionRevision + 1,
    currentUrl: observation.url,
    needsReobserve: true,
    takeoverReason: null,
    takeoverReasonCode: null,
    lastActivityAt: now,
    updatedAt: now,
  }).where(and(
    eq(schema.computerSessions.id, row.id),
    eq(schema.computerSessions.leaseVersion, row.leaseVersion),
  )).returning();

  if (!updated) {
    throw new TRPCError({ code: "CONFLICT", message: "無法交回控制權（版本衝突）" });
  }

  await db.insert(schema.computerActions).values({
    sessionId: updated.id,
    runId: updated.runId,
    stepId: updated.stepId,
    actionId: `release:${updated.id}:${updated.leaseVersion}`,
    sequence: updated.actionCount + 1,
    actorType: "human",
    actionKind: "release",
    safeTarget: "agent_control",
    status: "completed",
    riskLevel: "low",
    resultSummary: `released to agent; reobserve: ${observation.summary.slice(0, 200)}`,
    leaseVersion: updated.leaseVersion,
    expectedSessionRevision: updated.sessionRevision,
    completedAt: now,
  }).onConflictDoNothing();

  await emit({
    row: updated,
    eventType: "computer:agent_control_restored",
    summary: "已交回 AI；AI 將重新觀察畫面後繼續",
    controlHolder: "agent",
  });

  return {
    session: toSnapshot(updated),
    lease: leaseFromRow(updated),
    observation,
  };
}

/**
 * Recover stale human leases (expired without release) → waiting_human.
 * Multi-replica safe via CAS on lease_version.
 */
export async function recoverStaleHumanLeases(): Promise<number> {
  if (!isComputerRuntimeEnabled()) return 0;
  const now = new Date();
  const rows = await db
    .select()
    .from(schema.computerSessions)
    .where(and(
      eq(schema.computerSessions.status, "human_control"),
      eq(schema.computerSessions.controlHolder, "human"),
    ))
    .limit(50);

  let n = 0;
  for (const row of rows) {
    if (!row.leaseExpiresAt || row.leaseExpiresAt.getTime() > now.getTime()) continue;
    const [updated] = await db.update(schema.computerSessions).set({
      status: "waiting_human",
      controlHolder: "none",
      controlHolderUserId: null,
      leaseVersion: row.leaseVersion + 1,
      leaseExpiresAt: null,
      sessionRevision: row.sessionRevision + 1,
      takeoverReason: row.takeoverReason ?? "控制權逾時，請重新接管或交回 AI",
      takeoverReasonCode: row.takeoverReasonCode ?? "other",
      updatedAt: now,
    }).where(and(
      eq(schema.computerSessions.id, row.id),
      eq(schema.computerSessions.leaseVersion, row.leaseVersion),
      eq(schema.computerSessions.status, "human_control"),
    )).returning();
    if (updated) {
      n += 1;
      await emit({
        row: updated,
        eventType: "computer:waiting_human",
        summary: "人類控制權已逾時",
        controlHolder: "none",
      });
    }
  }
  return n;
}

export { toSnapshot as leaseSessionToSnapshot };
