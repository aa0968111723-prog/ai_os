/**
 * Adobe 連結的 token 保管（#224 PR1）。
 *
 * 資安設計沿用 services/integrations 已確立的慣例：
 * - token 屬「需重放」型 → AES-256-GCM 加密落庫（iv:tag:cipher hex），不是雜湊；原文永不回前端。
 * - 金鑰由同一顆持久種子（INTEGRATION_TOKEN_SECRET → Volume 持久檔）分域派生 `adobe-token:`——
 *   與 Google/Notion 的密文互不可解；種子與 DB 分離，DB 外洩不可解密。
 *   （路線圖原本寫 TOKEN_ENCRYPTION_KEY；實作沿用既有種子機制，避免站方要顧兩把金鑰、
 *     也避免第二套「金鑰遺失就解不開」的失敗模式。輪替方式與既有整合完全相同。）
 * - access token 有效期短：到期前 5 分鐘即視為過期，先換新再用（避免臨界點打到 401）。
 * - 解密失敗（金鑰輪替／檔案遺失）→ 連結標記 error，UI 引導重新連結，不是無聲失敗。
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, schema } from "../../db";
import { deriveIntegrationKey } from "../integrations";
import type { AdobeMode } from "../../../shared/adobe";

export type ExternalAccountRow = typeof schema.externalAccounts.$inferSelect;

/** access token 到期邊際：早 5 分鐘換新 */
export const TOKEN_REFRESH_MARGIN_MS = 5 * 60_000;

function tokenKey(): Buffer {
  return deriveIntegrationKey("adobe-token");
}

export function encryptAdobeToken(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", tokenKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${enc.toString("hex")}`;
}

export function decryptAdobeToken(stored: string): string {
  const [ivHex, tagHex, dataHex] = stored.split(":");
  if (!ivHex || !tagHex || !dataHex) throw new Error("Adobe 憑證格式不正確");
  const decipher = createDecipheriv("aes-256-gcm", tokenKey(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]).toString("utf8");
}

/** 純函式（可測接縫）：目前的 access token 還能不能用 */
export function isAccessTokenUsable(
  row: Pick<ExternalAccountRow, "accessTokenEnc" | "expiresAt">,
  now = Date.now(),
): boolean {
  if (!row.accessTokenEnc) return false;
  if (!row.expiresAt) return false;
  return row.expiresAt.getTime() - TOKEN_REFRESH_MARGIN_MS > now;
}

export interface AdobeTokenSet {
  accessToken: string;
  /** Adobe 每次刷新都會回新的 refresh token；沒回就沿用舊的 */
  refreshToken?: string;
  expiresInSec: number;
  scope?: string;
}

export interface AdobeProfile {
  email: string | null;
  accountId: string | null;
}

/** 完成授權後落庫（重新連結＝覆蓋，含清掉上一輪的錯誤狀態） */
export async function saveAdobeAccount(
  userId: string,
  tokens: AdobeTokenSet,
  profile: AdobeProfile,
  mode: AdobeMode,
): Promise<void> {
  const values = {
    accountEmail: profile.email,
    accountId: profile.accountId,
    accessTokenEnc: encryptAdobeToken(tokens.accessToken),
    refreshTokenEnc: tokens.refreshToken ? encryptAdobeToken(tokens.refreshToken) : null,
    expiresAt: new Date(Date.now() + Math.max(60, tokens.expiresInSec) * 1000),
    scope: tokens.scope ?? null,
    mode,
    status: "active" as const,
    lastError: null,
  };
  const existing = await findAdobeAccount(userId);
  if (existing) {
    await db.update(schema.externalAccounts).set(values).where(eq(schema.externalAccounts.id, existing.id));
  } else {
    await db.insert(schema.externalAccounts).values({ userId, provider: "adobe", ...values });
  }
}

export async function findAdobeAccount(userId: string): Promise<ExternalAccountRow | null> {
  const [row] = await db.select().from(schema.externalAccounts)
    .where(and(eq(schema.externalAccounts.userId, userId), eq(schema.externalAccounts.provider, "adobe")));
  return row ?? null;
}

export async function markAdobeError(accountId: string, message: string): Promise<void> {
  await db.update(schema.externalAccounts)
    .set({ status: "error", lastError: message })
    .where(eq(schema.externalAccounts.id, accountId))
    .catch(() => {});
}

export async function touchAdobeUsage(accountId: string): Promise<void> {
  await db.update(schema.externalAccounts)
    .set({ lastUsedAt: new Date() })
    .where(eq(schema.externalAccounts.id, accountId))
    .catch(() => {});
}

/** 中斷連結：直接刪列（憑證一併消失）；冪等 */
export async function removeAdobeAccount(userId: string): Promise<void> {
  await db.delete(schema.externalAccounts)
    .where(and(eq(schema.externalAccounts.userId, userId), eq(schema.externalAccounts.provider, "adobe")));
}

/** 更新刷新後的 token（refresh token 若有換新就一起存） */
export async function updateAdobeTokens(accountId: string, tokens: AdobeTokenSet): Promise<void> {
  await db.update(schema.externalAccounts)
    .set({
      accessTokenEnc: encryptAdobeToken(tokens.accessToken),
      ...(tokens.refreshToken ? { refreshTokenEnc: encryptAdobeToken(tokens.refreshToken) } : {}),
      expiresAt: new Date(Date.now() + Math.max(60, tokens.expiresInSec) * 1000),
      ...(tokens.scope ? { scope: tokens.scope } : {}),
      status: "active" as const,
      lastError: null,
    })
    .where(eq(schema.externalAccounts.id, accountId));
}

/** 解密（含失效標記）：解不開就標記 error 引導重新連結，不讓呼叫端拿到空字串繼續跑 */
export async function decryptOrMarkError(row: ExternalAccountRow, field: "access" | "refresh"): Promise<string | null> {
  const stored = field === "access" ? row.accessTokenEnc : row.refreshTokenEnc;
  if (!stored) return null;
  try {
    return decryptAdobeToken(stored);
  } catch {
    await markAdobeError(row.id, "Adobe 憑證解密失敗（伺服器金鑰可能已輪替）——請重新連結 Adobe 帳號");
    return null;
  }
}
