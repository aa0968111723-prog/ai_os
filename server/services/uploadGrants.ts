/**
 * AUTH-03：單次上傳授權（upload grants）+ lineage helpers。
 * DB 只存 token SHA-256；原文僅 create 當下回傳一次（前綴 aidup_）。
 * 上傳可走 cookie session 或 Authorization: Bearer aidup_…。
 */
import { randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { Request } from "express";
import { db, schema } from "../db";
import { loadAuthState, resolveSession, type AuthState, sha256 } from "./auth";

export const UPLOAD_GRANT_TOKEN_PREFIX = "aidup_";
/** 預設 24h */
export const UPLOAD_GRANT_DEFAULT_TTL_SEC = 86_400;
/** 上限 7 天 */
export const UPLOAD_GRANT_MAX_TTL_SEC = 7 * 86_400;
const HANDOFF_MAX = 120;

export type UploadGrantRecord = {
  id: string;
  userId: string;
  projectId: string;
  groupId: string;
  sourceAssetId: string | null;
  handoffId: string | null;
  maxBytes: number;
  expiresAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
};

export function looksLikeUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function hashUploadGrantToken(token: string): string {
  return sha256(token);
}

/** Pure: build meta blob for assets.meta (lineage fields + originalName). */
export function buildUploadLineageMeta(input: {
  originalName: string;
  sourceAssetId?: string | null;
  desktopHandoffId?: string | null;
  editorId?: string | null;
}): Record<string, unknown> {
  const meta: Record<string, unknown> = { originalName: input.originalName };
  if (input.sourceAssetId) meta.sourceAssetId = input.sourceAssetId;
  if (input.desktopHandoffId) meta.desktopHandoffId = input.desktopHandoffId;
  if (input.editorId) meta.editorId = input.editorId;
  return meta;
}

function extractBearerToken(req: Request): string | undefined {
  const raw = req.headers.authorization;
  if (!raw || typeof raw !== "string") return undefined;
  const m = /^Bearer\s+(\S+)/i.exec(raw.trim());
  return m?.[1];
}

export async function createUploadGrant(input: {
  userId: string;
  projectId: string;
  groupId: string;
  sourceAssetId?: string | null;
  handoffId?: string | null;
  maxBytes: number;
  ttlSeconds?: number;
}): Promise<{
  id: string;
  token: string;
  expiresAt: Date;
  maxBytes: number;
  projectId: string;
}> {
  const ttl = Math.min(
    UPLOAD_GRANT_MAX_TTL_SEC,
    Math.max(60, input.ttlSeconds ?? UPLOAD_GRANT_DEFAULT_TTL_SEC),
  );
  const token = `${UPLOAD_GRANT_TOKEN_PREFIX}${randomBytes(32).toString("hex")}`;
  const tokenHash = hashUploadGrantToken(token);
  const expiresAt = new Date(Date.now() + ttl * 1000);
  const handoffId =
    input.handoffId && input.handoffId.trim()
      ? input.handoffId.trim().slice(0, HANDOFF_MAX)
      : null;

  const [row] = await db
    .insert(schema.uploadGrants)
    .values({
      tokenHash,
      userId: input.userId,
      projectId: input.projectId,
      groupId: input.groupId,
      sourceAssetId: input.sourceAssetId ?? null,
      handoffId,
      maxBytes: input.maxBytes,
      expiresAt,
    })
    .returning({ id: schema.uploadGrants.id });

  return {
    id: row.id,
    token,
    expiresAt,
    maxBytes: input.maxBytes,
    projectId: input.projectId,
  };
}

export async function findValidUploadGrantByToken(
  token: string,
  now: Date = new Date(),
): Promise<UploadGrantRecord | null> {
  if (!token.startsWith(UPLOAD_GRANT_TOKEN_PREFIX)) return null;
  const tokenHash = hashUploadGrantToken(token);
  const [row] = await db
    .select()
    .from(schema.uploadGrants)
    .where(
      and(
        eq(schema.uploadGrants.tokenHash, tokenHash),
        gt(schema.uploadGrants.expiresAt, now),
        isNull(schema.uploadGrants.usedAt),
        isNull(schema.uploadGrants.revokedAt),
      ),
    );
  if (!row) return null;
  return {
    id: row.id,
    userId: row.userId,
    projectId: row.projectId,
    groupId: row.groupId,
    sourceAssetId: row.sourceAssetId ?? null,
    handoffId: row.handoffId ?? null,
    maxBytes: row.maxBytes,
    expiresAt: row.expiresAt,
    usedAt: row.usedAt ?? null,
    revokedAt: row.revokedAt ?? null,
  };
}

export async function markUploadGrantUsed(grantId: string, now: Date = new Date()): Promise<void> {
  await db
    .update(schema.uploadGrants)
    .set({ usedAt: now })
    .where(and(eq(schema.uploadGrants.id, grantId), isNull(schema.uploadGrants.usedAt)));
}

/**
 * CAS 佔用單次 grant：只有 usedAt 仍為 null 時寫入 now 並回 true。
 * 並發兩請求只有一個成功——解決 findValid→markUsed 非原子窗口可重複上傳。
 */
export async function tryConsumeUploadGrant(grantId: string, now: Date = new Date()): Promise<boolean> {
  const rows = await db
    .update(schema.uploadGrants)
    .set({ usedAt: now })
    .where(and(eq(schema.uploadGrants.id, grantId), isNull(schema.uploadGrants.usedAt)))
    .returning({ id: schema.uploadGrants.id });
  return rows.length > 0;
}

/**
 * 上傳失敗後釋放 grant（僅當 usedAt 等於我們剛佔用的時間窗時由呼叫端保證）。
 * 允許同一 token 在「驗證後 DB 失敗」時重試，同時並發第二請求在 CAS 時已被擋。
 */
export async function releaseUploadGrant(grantId: string): Promise<void> {
  await db
    .update(schema.uploadGrants)
    .set({ usedAt: null })
    .where(eq(schema.uploadGrants.id, grantId));
}

/**
 * Resolve upload auth: Bearer aidup_ grant → load user session state for that user,
 * else fall back to cookie session.
 */
export async function resolveUploadRequestAuth(
  req: Request,
): Promise<{ auth: AuthState; grant: UploadGrantRecord | null } | null> {
  const bearer = extractBearerToken(req);
  if (bearer?.startsWith(UPLOAD_GRANT_TOKEN_PREFIX)) {
    const grant = await findValidUploadGrantByToken(bearer);
    if (!grant) return null;
    // Load auth as the grant owner (must be active user with group membership)
    // resolveSession only works with cookie — load user state via existing path:
    const authFromCookie = await resolveSession(req);
    if (authFromCookie && authFromCookie.user.id === grant.userId) {
      return { auth: authFromCookie, grant };
    }
    // No matching cookie: load auth state for grant userId directly
    const auth = await loadAuthState(grant.userId);
    if (!auth) return null;
    return { auth, grant };
  }
  const auth = await resolveSession(req);
  if (!auth) return null;
  return { auth, grant: null };
}
