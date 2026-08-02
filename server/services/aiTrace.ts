import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, max, sql } from "drizzle-orm";
import { db, schema } from "../db";
import type { AiOperationMode, AiTraceEventType, AiTraceStatus } from "../../shared/aiTrace";

const MAX_EVENT_BYTES = 512 * 1024;
const MAX_STRING_CHARS = 100_000;
const REDACTED = "（已遮蔽敏感資料）";
const PRIVATE_REASONING = "（不保存模型私密推理）";

const SECRET_KEY = /(?:authorization|api[-_]?key|access[-_]?token|refresh[-_]?token|cookie|password|passwd|secret|session[-_]?token|credential)/i;
const REASONING_KEY = /^(?:reasoning|thinking|chain[-_]?of[-_]?thought|cot|analysis)$/i;
const SIGNED_QUERY_KEY = /^(?:x-amz-|signature$|sig$|token$|key$|expires$|policy$|credential$)/i;

export interface SanitizedTracePayload {
  payload: Record<string, unknown>;
  sha256: string;
  truncatedFields: string[];
}

function sanitizeUrl(value: string): string {
  if (!/^https?:\/\//i.test(value)) return value;
  try {
    const url = new URL(value);
    const sensitive = [...url.searchParams.keys()].some((key) => SIGNED_QUERY_KEY.test(key));
    if (sensitive) url.search = "";
    return url.toString();
  } catch {
    return value;
  }
}

/**
 * Trace 的唯一入口：秘密、簽名 query 與 provider 私密推理永不落庫。
 * 這個函式刻意 export，讓單元測試可以鎖住「完整技術檢視仍不洩密」的承諾。
 */
export function sanitizeAiTracePayload(input: unknown): SanitizedTracePayload {
  const truncatedFields: string[] = [];
  const seen = new WeakSet<object>();

  const walk = (value: unknown, path: string, depth: number): unknown => {
    if (value == null || typeof value === "number" || typeof value === "boolean") return value;
    if (typeof value === "bigint") return value.toString();
    if (typeof value === "string") {
      const safeUrl = sanitizeUrl(value);
      if (safeUrl.length <= MAX_STRING_CHARS) return safeUrl;
      truncatedFields.push(path);
      return `${safeUrl.slice(0, MAX_STRING_CHARS)}…（已截斷）`;
    }
    if (typeof value !== "object") return String(value);
    if (depth >= 12) {
      truncatedFields.push(path);
      return "（超過追蹤深度，已截斷）";
    }
    if (seen.has(value as object)) return "（循環引用）";
    seen.add(value as object);
    if (Array.isArray(value)) {
      if (value.length > 200) truncatedFields.push(path);
      return value.slice(0, 200).map((item, index) => walk(item, `${path}[${index}]`, depth + 1));
    }
    const out: Record<string, unknown> = {};
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > 200) truncatedFields.push(path);
    for (const [key, child] of entries.slice(0, 200)) {
      const childPath = path ? `${path}.${key}` : key;
      if (SECRET_KEY.test(key)) out[key] = REDACTED;
      else if (REASONING_KEY.test(key)) out[key] = PRIVATE_REASONING;
      else out[key] = walk(child, childPath, depth + 1);
    }
    return out;
  };

  let value = walk(input, "payload", 0);
  if (!value || typeof value !== "object" || Array.isArray(value)) value = { value };
  let json = JSON.stringify(value);
  const sha256 = createHash("sha256").update(json).digest("hex");
  if (Buffer.byteLength(json, "utf8") > MAX_EVENT_BYTES) {
    truncatedFields.push("payload");
    json = json.slice(0, MAX_EVENT_BYTES - 2_000);
    value = {
      _truncated: true,
      _originalSha256: sha256,
      preview: json,
    };
  }
  return {
    payload: value as Record<string, unknown>,
    sha256,
    truncatedFields: [...new Set(truncatedFields)],
  };
}

export async function createAiTraceSession(input: {
  groupId: string;
  projectId: string;
  userId: string;
  mode: AiOperationMode;
  title: string;
  provider?: string;
  model?: string;
  sourceType?: string;
  sourceId?: string;
  summary?: string;
}) {
  const [row] = await db.insert(schema.aiTraceSessions).values({
    ...input,
    title: input.title.slice(0, 1_000),
    summary: input.summary?.slice(0, 2_000),
  }).returning();
  return row;
}

export async function updateAiTraceSession(sessionId: string, patch: {
  status?: AiTraceStatus;
  provider?: string | null;
  model?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
  summary?: string | null;
}): Promise<void> {
  await db.update(schema.aiTraceSessions).set({
    ...patch,
    summary: patch.summary?.slice(0, 2_000),
    updatedAt: new Date(),
  }).where(eq(schema.aiTraceSessions.id, sessionId));
}

export async function recordAiTraceEvent(input: {
  sessionId: string;
  eventType: AiTraceEventType;
  summary: string;
  payload?: unknown;
  latencyMs?: number;
}): Promise<void> {
  const safe = sanitizeAiTracePayload(input.payload ?? {});
  await db.transaction(async (tx) => {
    // 同一 session 的背景工作可能同時回報；以 advisory lock 固定 sequence，避免唯一鍵競態。
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.sessionId}), 4)`);
    const [current] = await tx.select({ sequence: max(schema.aiTraceEvents.sequence) })
      .from(schema.aiTraceEvents)
      .where(eq(schema.aiTraceEvents.sessionId, input.sessionId));
    await tx.insert(schema.aiTraceEvents).values({
      sessionId: input.sessionId,
      sequence: (current?.sequence ?? 0) + 1,
      eventType: input.eventType,
      summary: input.summary.slice(0, 1_000),
      payload: safe.payload,
      payloadSha256: safe.sha256,
      truncatedFields: safe.truncatedFields.length ? safe.truncatedFields : null,
      latencyMs: input.latencyMs == null ? null : Math.max(0, Math.min(86_400_000, Math.round(input.latencyMs))),
    });
  });
}

/** 透明化失敗不應讓合法創作失敗；呼叫端需要真實 traceId 時仍先 create session。 */
export async function recordAiTraceEventSafely(input: Parameters<typeof recordAiTraceEvent>[0]): Promise<void> {
  try {
    await recordAiTraceEvent(input);
  } catch (error) {
    console.warn(`[ai-trace] event write failed session=${input.sessionId}:`, error instanceof Error ? error.message : error);
  }
}

/**
 * Trace payloads may contain source data that was readable only by the initiating user.
 * Project edit access is therefore not sufficient: every read remains scoped to the owner.
 */
export async function listAiTraceSessions(projectId: string, userId: string, limit = 30) {
  return db.select().from(schema.aiTraceSessions)
    .where(and(
      eq(schema.aiTraceSessions.projectId, projectId),
      eq(schema.aiTraceSessions.userId, userId),
    ))
    .orderBy(desc(schema.aiTraceSessions.createdAt))
    .limit(Math.max(1, Math.min(100, limit)));
}

export async function getAiTraceSession(projectId: string, sessionId: string, userId: string) {
  const [session] = await db.select().from(schema.aiTraceSessions)
    .where(and(
      eq(schema.aiTraceSessions.id, sessionId),
      eq(schema.aiTraceSessions.projectId, projectId),
      eq(schema.aiTraceSessions.userId, userId),
    ));
  if (!session) return null;
  const events = await db.select().from(schema.aiTraceEvents)
    .where(eq(schema.aiTraceEvents.sessionId, sessionId))
    .orderBy(asc(schema.aiTraceEvents.sequence));
  return { session, events };
}

/** Atomically closes a trace once and records the matching terminal event for the winner. */
export async function finalizeAiTraceSession(input: {
  sessionId: string;
  status: Extract<AiTraceStatus, "completed" | "failed" | "stopped">;
  summary: string;
  payload?: unknown;
}): Promise<boolean> {
  const [updated] = await db.update(schema.aiTraceSessions).set({
    status: input.status,
    summary: input.summary.slice(0, 2_000),
    updatedAt: new Date(),
  }).where(and(
    eq(schema.aiTraceSessions.id, input.sessionId),
    inArray(schema.aiTraceSessions.status, ["prepared", "running"]),
  )).returning({ id: schema.aiTraceSessions.id });
  if (!updated) return false;
  await recordAiTraceEventSafely({
    sessionId: input.sessionId,
    eventType: input.status,
    summary: input.summary,
    payload: input.payload ?? {},
  });
  return true;
}

export async function findAiTraceSessionBySource(sourceType: string, sourceId: string) {
  const [session] = await db.select().from(schema.aiTraceSessions)
    .where(and(eq(schema.aiTraceSessions.sourceType, sourceType), eq(schema.aiTraceSessions.sourceId, sourceId)))
    .orderBy(desc(schema.aiTraceSessions.createdAt))
    .limit(1);
  return session ?? null;
}
