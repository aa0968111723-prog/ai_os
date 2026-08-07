import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "../db";
import type { AuthState } from "./auth";
import { requireGroup } from "../trpc";
import type { AiTraceStatus } from "../../shared/aiTrace";
import { recordAiTraceEventSafely } from "./aiTrace";

/**
 * 全站助手軌跡 session（ai_site_trace_sessions 分表）的服務層。
 *
 * 事件層完全重用 aiTrace.ts：recordAiTraceEventSafely 只認 sessionId
 * （events 表無 FK），sanitize／advisory-lock sequence 都是同一套——
 * 這裡只多管 session 的建立、狀態流轉與「owner+組」雙鎖讀取。
 */

export async function createSiteTraceSession(input: {
  groupId: string;
  projectId?: string | null;
  userId: string;
  title: string;
  summary?: string;
}) {
  const [row] = await db.insert(schema.aiSiteTraceSessions).values({
    groupId: input.groupId,
    projectId: input.projectId ?? null,
    userId: input.userId,
    title: input.title.slice(0, 1_000),
    summary: input.summary?.slice(0, 2_000),
  }).returning();
  return row;
}

export async function updateSiteTraceSession(sessionId: string, patch: {
  status?: AiTraceStatus;
  provider?: string | null;
  model?: string | null;
  summary?: string | null;
}): Promise<void> {
  await db.update(schema.aiSiteTraceSessions).set({
    ...patch,
    summary: patch.summary?.slice(0, 2_000),
    updatedAt: new Date(),
  }).where(eq(schema.aiSiteTraceSessions.id, sessionId));
}

/** 一次收尾：只有 prepared/running 的 session 會被翻成終局態（重複收尾只有第一次算數） */
export async function finalizeSiteTraceSession(input: {
  sessionId: string;
  status: Extract<AiTraceStatus, "completed" | "failed" | "stopped">;
  summary: string;
  payload?: unknown;
}): Promise<boolean> {
  const [updated] = await db.update(schema.aiSiteTraceSessions).set({
    status: input.status,
    summary: input.summary.slice(0, 2_000),
    updatedAt: new Date(),
  }).where(and(
    eq(schema.aiSiteTraceSessions.id, input.sessionId),
    inArray(schema.aiSiteTraceSessions.status, ["prepared", "running"]),
  )).returning({ id: schema.aiSiteTraceSessions.id });
  if (!updated) return false;
  await recordAiTraceEventSafely({
    sessionId: input.sessionId,
    eventType: input.status,
    summary: input.summary,
    payload: input.payload ?? {},
  });
  return true;
}

/**
 * 讀取一律 owner-scoped（與 aiTrace 同一條理由）：payload 可能含只有發問者
 * 本人有權讀到的資料（他可見的資料庫列、他的私訊對象清單），組員身分不足以看別人的軌跡。
 */
export async function listSiteTraceSessions(auth: AuthState, groupId: string, limit = 30) {
  requireGroup(auth, groupId);
  return db.select().from(schema.aiSiteTraceSessions)
    .where(and(
      eq(schema.aiSiteTraceSessions.groupId, groupId),
      eq(schema.aiSiteTraceSessions.userId, auth.user.id),
    ))
    .orderBy(desc(schema.aiSiteTraceSessions.createdAt))
    .limit(Math.max(1, Math.min(100, limit)));
}

export async function getSiteTraceSession(auth: AuthState, sessionId: string) {
  const [session] = await db.select().from(schema.aiSiteTraceSessions)
    .where(and(
      eq(schema.aiSiteTraceSessions.id, sessionId),
      eq(schema.aiSiteTraceSessions.userId, auth.user.id),
    ));
  if (!session) return null;
  requireGroup(auth, session.groupId);
  const events = await db.select().from(schema.aiTraceEvents)
    .where(eq(schema.aiTraceEvents.sessionId, sessionId))
    .orderBy(asc(schema.aiTraceEvents.sequence));
  return { session, events };
}
