/**
 * PR-6E: Persisted Auth Context — explicit opt-in, encrypted opaque refs, revoke, service-scoped reuse.
 * Never returns raw cookies / tokens / OTP to client or LLM.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db, schema } from "../../db";
import { requireGroup } from "../../trpc";
import type { AuthState } from "../auth";
import { deriveIntegrationKey } from "../integrations";
import { notifyAgentProgress } from "../realtime";
import { recordAgentEventSafely } from "../agentEventCore";
import {
  COMPUTER_AUTH_CONTEXT_DEFAULT_TTL_MS,
  COMPUTER_AUTH_CONTEXT_MAX_PER_USER,
  isComputerPersistedAuthEnabled,
  isComputerRuntimeEnabled,
  normalizeAuthServiceHost,
  type ComputerAuthContextSnapshot,
} from "../../../shared/computerRuntime";
import { computerEventToAgentObservationSummary } from "../../../shared/computerEvents";
import type { ComputerEventType } from "../../../shared/computerEvents";
import { mockBrowserProvider } from "./mockBrowserProvider";

type AuthRow = typeof schema.computerAuthContexts.$inferSelect;
type SessionRow = typeof schema.computerSessions.$inferSelect;

function assertPersistedAuthEnabled(): void {
  if (!isComputerRuntimeEnabled() || !isComputerPersistedAuthEnabled()) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "已儲存登入尚未啟用（COMPUTER_PERSISTED_AUTH_ENABLED；需安全審核後開啟）",
    });
  }
}

/** Domain-isolated AES key (same seed as integrations, different prefix). */
function authEncKey(): Buffer {
  return deriveIntegrationKey("computer-auth-context");
}

export function encryptAuthContextBlob(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", authEncKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${enc.toString("hex")}`;
}

export function decryptAuthContextBlob(stored: string): string {
  const [ivHex, tagHex, dataHex] = stored.split(":");
  if (!ivHex || !tagHex || !dataHex) throw new Error("auth context 格式不正確");
  const decipher = createDecipheriv("aes-256-gcm", authEncKey(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]).toString("utf8");
}

function fingerprintEnc(enc: string): string {
  return createHash("sha256").update(enc).digest("hex").slice(0, 32);
}

function toSafeSnapshot(row: AuthRow): ComputerAuthContextSnapshot {
  return {
    id: row.id,
    userId: row.userId,
    serviceHost: row.serviceHost,
    serviceLabel: row.serviceLabel,
    scope: row.scope,
    provider: row.provider,
    sourceSessionId: row.sourceSessionId,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

async function emitAuthEvent(input: {
  projectId?: string | null;
  groupId: string;
  runId?: string | null;
  stepId?: string | null;
  sessionId?: string | null;
  eventType: ComputerEventType;
  summary: string;
}): Promise<void> {
  const sid = input.sessionId ?? "auth";
  if (!input.runId || !input.projectId) {
    if (input.projectId) {
      try {
        notifyAgentProgress(input.projectId, {
          runId: sid,
          stepId: input.stepId ?? undefined,
          eventKey: `computer:${sid}:${input.eventType}:${Date.now()}`,
          groupId: input.groupId,
        });
      } catch { /* non-fatal */ }
    }
    return;
  }
  await recordAgentEventSafely({
    runId: input.runId,
    groupId: input.groupId,
    projectId: input.projectId,
    stepId: input.stepId,
    eventKey: `computer:${sid}:${input.eventType}:${randomBytes(4).toString("hex")}`,
    eventType: "observation",
    summary: computerEventToAgentObservationSummary(input.eventType, input.summary),
    data: {
      schemaVersion: 1,
      eventType: input.eventType,
      status: "auth",
      occurredAt: new Date().toISOString(),
      summary: input.summary,
      computer: {
        sessionId: sid,
        runtimeKind: "browser",
        controlHolder: "none",
      },
    },
  });
}

async function loadOwnedSession(auth: AuthState, sessionId: string): Promise<SessionRow> {
  const [row] = await db.select().from(schema.computerSessions).where(eq(schema.computerSessions.id, sessionId));
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "找不到工作電腦 session" });
  requireGroup(auth, row.groupId);
  if (row.userId !== auth.user.id) {
    const role = requireGroup(auth, row.groupId);
    if (role === "member") throw new TRPCError({ code: "FORBIDDEN", message: "沒有權限" });
  }
  return row;
}

/**
 * Explicit opt-in: remember login for the service host of the current session.
 * Captures an opaque provider blob (mock cookie jar id) — never passwords.
 */
export async function saveAuthContextFromSession(input: {
  auth: AuthState;
  sessionId: string;
  /** Must be true — no silent save */
  explicitOptIn: boolean;
  serviceLabel?: string;
}): Promise<ComputerAuthContextSnapshot> {
  assertPersistedAuthEnabled();
  if (!input.explicitOptIn) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "必須明確同意「記住此登入」" });
  }

  const session = await loadOwnedSession(input.auth, input.sessionId);
  if (session.userId !== input.auth.user.id) {
    throw new TRPCError({ code: "FORBIDDEN", message: "只能為自己的 session 儲存登入" });
  }

  // Prefer after human login path; allow any non-terminal active session with a URL
  if (session.runtimeKind !== "browser") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "目前僅 Browser session 支援記住登入" });
  }
  if (!session.currentUrl) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "session 尚無網址，無法判定服務範圍" });
  }

  const host = normalizeAuthServiceHost(session.currentUrl);
  if (!host) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "無法從此網址建立安全的服務範圍" });
  }

  let opaque: string;
  try {
    opaque = await mockBrowserProvider.exportAuthContext({
      providerSessionRef: session.providerSessionRef,
      serviceHost: host,
    });
  } catch (err) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: err instanceof Error ? err.message : "無法匯出登入上下文",
    });
  }

  const activeCount = await db
    .select({ id: schema.computerAuthContexts.id })
    .from(schema.computerAuthContexts)
    .where(and(
      eq(schema.computerAuthContexts.userId, input.auth.user.id),
      isNull(schema.computerAuthContexts.revokedAt),
      gt(schema.computerAuthContexts.expiresAt, new Date()),
    ));
  if (activeCount.length >= COMPUTER_AUTH_CONTEXT_MAX_PER_USER) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: `已儲存登入數量已達上限（${COMPUTER_AUTH_CONTEXT_MAX_PER_USER}）`,
    });
  }

  // Upsert by user+host: revoke older active for same host, then insert fresh
  const now = new Date();
  await db.update(schema.computerAuthContexts).set({
    revokedAt: now,
    updatedAt: now,
  }).where(and(
    eq(schema.computerAuthContexts.userId, input.auth.user.id),
    eq(schema.computerAuthContexts.serviceHost, host),
    isNull(schema.computerAuthContexts.revokedAt),
  ));

  const contextEnc = encryptAuthContextBlob(opaque);
  const expiresAt = new Date(now.getTime() + COMPUTER_AUTH_CONTEXT_DEFAULT_TTL_MS);
  const label = (input.serviceLabel?.trim() || host).slice(0, 80);

  const [row] = await db.insert(schema.computerAuthContexts).values({
    userId: input.auth.user.id,
    groupId: session.groupId,
    serviceHost: host,
    serviceLabel: label,
    scope: "browser_session",
    provider: session.provider,
    contextEnc,
    contextFingerprint: fingerprintEnc(contextEnc),
    sourceSessionId: session.id,
    lastUsedAt: now,
    expiresAt,
  }).returning();

  await emitAuthEvent({
    projectId: session.projectId,
    groupId: session.groupId,
    runId: session.runId,
    stepId: session.stepId,
    sessionId: session.id,
    eventType: "computer:auth_saved",
    summary: `已記住 ${host} 登入（加密參考；不含密碼）`,
  });

  return toSafeSnapshot(row);
}

export async function listAuthContexts(
  auth: AuthState,
  opts?: { includeRevoked?: boolean },
): Promise<ComputerAuthContextSnapshot[]> {
  assertPersistedAuthEnabled();
  const rows = await db
    .select()
    .from(schema.computerAuthContexts)
    .where(eq(schema.computerAuthContexts.userId, auth.user.id))
    .orderBy(desc(schema.computerAuthContexts.createdAt))
    .limit(50);

  return rows
    .filter((r) => {
      if (!opts?.includeRevoked && r.revokedAt) return false;
      return true;
    })
    .map(toSafeSnapshot);
}

export async function revokeAuthContext(input: {
  auth: AuthState;
  authContextId: string;
}): Promise<ComputerAuthContextSnapshot> {
  assertPersistedAuthEnabled();
  const [row] = await db
    .select()
    .from(schema.computerAuthContexts)
    .where(and(
      eq(schema.computerAuthContexts.id, input.authContextId),
      eq(schema.computerAuthContexts.userId, input.auth.user.id),
    ));
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "找不到已儲存登入" });

  if (row.revokedAt) return toSafeSnapshot(row);

  const now = new Date();
  const [updated] = await db.update(schema.computerAuthContexts).set({
    revokedAt: now,
    updatedAt: now,
  }).where(eq(schema.computerAuthContexts.id, row.id)).returning();

  await emitAuthEvent({
    projectId: null,
    groupId: row.groupId,
    sessionId: row.sourceSessionId,
    eventType: "computer:auth_revoked",
    summary: `已撤銷 ${row.serviceHost} 的記住登入`,
  });

  return toSafeSnapshot(updated ?? { ...row, revokedAt: now });
}

/**
 * Server-only: resolve decrypted opaque blob for provider attach.
 * Never expose return value to tRPC client responses or planner prompts.
 */
export async function resolveAuthContextForProvider(input: {
  auth: AuthState;
  authContextId: string;
  /** Optional start host — must match service scope when provided */
  expectedHost?: string | null;
}): Promise<{ opaque: string; snapshot: ComputerAuthContextSnapshot }> {
  assertPersistedAuthEnabled();
  const [row] = await db
    .select()
    .from(schema.computerAuthContexts)
    .where(and(
      eq(schema.computerAuthContexts.id, input.authContextId),
      eq(schema.computerAuthContexts.userId, input.auth.user.id),
    ));
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "找不到已儲存登入" });
  if (row.revokedAt) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "此登入已被撤銷",
    });
  }
  if (row.expiresAt.getTime() <= Date.now()) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "此登入已過期，請重新登入並記住",
    });
  }
  if (input.expectedHost) {
    const host = normalizeAuthServiceHost(input.expectedHost);
    if (host && host !== row.serviceHost) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `登入範圍不符：已儲存 ${row.serviceHost}，目標為 ${host}`,
      });
    }
  }

  let opaque: string;
  try {
    opaque = decryptAuthContextBlob(row.contextEnc);
  } catch {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "登入上下文解密失敗（金鑰可能已輪替）——請撤銷後重新記住",
    });
  }

  const now = new Date();
  await db.update(schema.computerAuthContexts).set({
    lastUsedAt: now,
    updatedAt: now,
  }).where(eq(schema.computerAuthContexts.id, row.id));

  return { opaque, snapshot: toSafeSnapshot({ ...row, lastUsedAt: now }) };
}

export async function markAuthContextReused(input: {
  projectId: string;
  groupId: string;
  runId?: string | null;
  stepId?: string | null;
  sessionId: string;
  serviceHost: string;
}): Promise<void> {
  await emitAuthEvent({
    projectId: input.projectId,
    groupId: input.groupId,
    runId: input.runId,
    stepId: input.stepId,
    sessionId: input.sessionId,
    eventType: "computer:auth_reused",
    summary: `已套用 ${input.serviceHost} 的記住登入（opaque）`,
  });
}
