/**
 * BYOK Phase 1：個人 AI 供應商 API Key（目前只支援 fal）。
 *
 * 資安設計（沿用 integrations / external_accounts 慣例）：
 * - 金鑰 AES-256-GCM 加密落庫（iv:tag:cipher hex）；原文永不回前端。
 * - 加密金鑰：deriveIntegrationKey("ai-provider-key")——與 Google/Notion/Adobe 密文互不可解。
 * - setKey 先做 fal 輕量探活（GET api.fal.ai/v1/models）再落庫；401 拒絕保存。
 * - 列表只回 last4 + status + preferUserKey。
 *
 * Phase 2 會在 generationCore 呼叫 getDecryptedKey，有 active + prefer 時略過站方點數。
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, schema } from "../db";
import { deriveIntegrationKey } from "./integrations";
import { proxyFetch } from "./http";

export type AiProvider = "fal";
export type AiKeyStatus = "active" | "error" | "unverified";

export type UserAiProviderKeyRow = typeof schema.userAiProviderKeys.$inferSelect;

/** 前端可見的公開摘要——絕不包含密文或原文 */
export interface UserAiKeyPublic {
  provider: AiProvider;
  keyLast4: string;
  status: AiKeyStatus;
  preferUserKey: boolean;
  validatedAt: Date | null;
  lastUsedAt: Date | null;
  lastError: string | null;
  createdAt: Date;
}

/* ────────────────────────── 加解密 ────────────────────────── */

function providerKey(): Buffer {
  return deriveIntegrationKey("ai-provider-key");
}

function encryptKey(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", providerKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${enc.toString("hex")}`;
}

function decryptKey(stored: string): string {
  const [ivHex, tagHex, dataHex] = stored.split(":");
  if (!ivHex || !tagHex || !dataHex) throw new Error("金鑰格式不正確");
  const decipher = createDecipheriv("aes-256-gcm", providerKey(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]).toString("utf8");
}

function toPublic(row: UserAiProviderKeyRow): UserAiKeyPublic {
  return {
    provider: row.provider as AiProvider,
    keyLast4: row.keyLast4,
    status: row.status as AiKeyStatus,
    preferUserKey: row.preferUserKey,
    validatedAt: row.validatedAt,
    lastUsedAt: row.lastUsedAt,
    lastError: row.lastError,
    createdAt: row.createdAt,
  };
}

/* ────────────────────────── 格式與探活 ────────────────────────── */

/** 可列印 ASCII、合理長度；fal key 常見為 uuid:secret 或長 token */
export function validateFalKeyFormat(key: string): string | null {
  const trimmed = key.trim();
  if (!trimmed) return "請貼上 fal.ai API Key";
  if (trimmed.length < 16) return "金鑰太短——請確認是完整的 fal.ai Key";
  if (trimmed.length > 512) return "金鑰太長（上限 512 字）";
  if (!/^[\x21-\x7E]+$/.test(trimmed)) return "金鑰只能含可列印英數符號（不可有空白或換行）";
  return null;
}

/**
 * 輕量探活：GET https://api.fal.ai/v1/models
 * 不觸發生成計費；401＝金鑰無效；其餘 4xx/5xx 給人話錯誤。
 */
export async function testFalConnection(plaintextKey: string): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const res = await proxyFetch("https://api.fal.ai/v1/models", {
      headers: { Authorization: `Key ${plaintextKey}` },
      timeoutMs: 15_000,
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, message: "fal.ai 不認得這個金鑰——請到 fal.ai dashboard 確認 Key 是否有效" };
    }
    if (res.status === 429) {
      return { ok: false, message: "fal.ai 請求過於頻繁，請稍後再試" };
    }
    if (!res.ok) {
      return { ok: false, message: `fal.ai 回應 HTTP ${res.status}——請稍後再試` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, message: `連線失敗：${err instanceof Error ? err.message : "網路錯誤"}` };
  }
}

/* ────────────────────────── CRUD ────────────────────────── */

export async function listForUser(userId: string): Promise<UserAiKeyPublic[]> {
  const rows = await db.select().from(schema.userAiProviderKeys)
    .where(eq(schema.userAiProviderKeys.userId, userId));
  return rows.map(toPublic);
}

async function findRow(userId: string, provider: AiProvider): Promise<UserAiProviderKeyRow | null> {
  const [row] = await db.select().from(schema.userAiProviderKeys)
    .where(and(
      eq(schema.userAiProviderKeys.userId, userId),
      eq(schema.userAiProviderKeys.provider, provider),
    ));
  return row ?? null;
}

/**
 * 設定／覆蓋個人金鑰：先格式檢查 → 探活 → 加密 upsert。
 * 探活失敗不寫入（或把既有列標 error）。
 */
export async function setKey(
  userId: string,
  provider: AiProvider,
  plaintextKey: string,
): Promise<UserAiKeyPublic> {
  if (provider !== "fal") throw new Error("目前只支援 fal.ai 金鑰");
  const formatErr = validateFalKeyFormat(plaintextKey);
  if (formatErr) throw new Error(formatErr);
  const trimmed = plaintextKey.trim();

  const probe = await testFalConnection(trimmed);
  if (!probe.ok) throw new Error(probe.message);

  const secretEnc = encryptKey(trimmed);
  const keyLast4 = trimmed.slice(-4);
  const existing = await findRow(userId, provider);
  const now = new Date();

  if (existing) {
    const [row] = await db.update(schema.userAiProviderKeys)
      .set({
        secretEnc,
        keyLast4,
        status: "active",
        validatedAt: now,
        lastError: null,
        updatedAt: now,
      })
      .where(eq(schema.userAiProviderKeys.id, existing.id))
      .returning();
    return toPublic(row);
  }

  const [row] = await db.insert(schema.userAiProviderKeys).values({
    userId,
    provider,
    secretEnc,
    keyLast4,
    status: "active",
    preferUserKey: true,
    validatedAt: now,
  }).returning();
  return toPublic(row);
}

export async function removeKey(userId: string, provider: AiProvider): Promise<void> {
  const existing = await findRow(userId, provider);
  if (!existing) return; // 冪等
  await db.delete(schema.userAiProviderKeys)
    .where(eq(schema.userAiProviderKeys.id, existing.id));
}

export async function setPreferUserKey(
  userId: string,
  provider: AiProvider,
  preferUserKey: boolean,
): Promise<UserAiKeyPublic> {
  const existing = await findRow(userId, provider);
  if (!existing) throw new Error("尚未設定此供應商的金鑰");
  const [row] = await db.update(schema.userAiProviderKeys)
    .set({ preferUserKey, updatedAt: new Date() })
    .where(eq(schema.userAiProviderKeys.id, existing.id))
    .returning();
  return toPublic(row);
}

/**
 * 內部用：取出解密後的金鑰（僅當 active + preferUserKey）。
 * 解密失敗 → 標記 error 並回 null（呼叫端 fallback 平台 Key）。
 */
export async function getDecryptedKey(userId: string, provider: AiProvider): Promise<string | null> {
  const row = await findRow(userId, provider);
  if (!row || row.status !== "active" || !row.preferUserKey) return null;
  try {
    const key = decryptKey(row.secretEnc);
    void db.update(schema.userAiProviderKeys)
      .set({ lastUsedAt: new Date(), lastError: null })
      .where(eq(schema.userAiProviderKeys.id, row.id))
      .catch(() => {});
    return key;
  } catch {
    await db.update(schema.userAiProviderKeys)
      .set({
        status: "error",
        lastError: "憑證解密失敗（伺服器金鑰可能已輪替）——請重新貼上金鑰",
        updatedAt: new Date(),
      })
      .where(eq(schema.userAiProviderKeys.id, row.id))
      .catch(() => {});
    return null;
  }
}

/**
 * 測試連線（可測未存的金鑰，或重測已存的）。
 * 若測的是已存金鑰且失敗，更新 status=error。
 */
export async function testKey(
  userId: string,
  provider: AiProvider,
  plaintextKey?: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (provider !== "fal") return { ok: false, message: "目前只支援 fal.ai 金鑰" };

  let key = plaintextKey?.trim();
  if (!key) {
    const row = await findRow(userId, provider);
    if (!row) return { ok: false, message: "尚未設定此供應商的金鑰" };
    try {
      key = decryptKey(row.secretEnc);
    } catch {
      return { ok: false, message: "憑證解密失敗——請重新貼上金鑰" };
    }
  } else {
    const formatErr = validateFalKeyFormat(key);
    if (formatErr) return { ok: false, message: formatErr };
  }

  const result = await testFalConnection(key);
  const row = await findRow(userId, provider);
  if (row) {
    if (result.ok) {
      void db.update(schema.userAiProviderKeys)
        .set({ status: "active", validatedAt: new Date(), lastError: null, updatedAt: new Date() })
        .where(eq(schema.userAiProviderKeys.id, row.id))
        .catch(() => {});
    } else {
      void db.update(schema.userAiProviderKeys)
        .set({ status: "error", lastError: result.message, updatedAt: new Date() })
        .where(eq(schema.userAiProviderKeys.id, row.id))
        .catch(() => {});
    }
  }
  return result;
}
