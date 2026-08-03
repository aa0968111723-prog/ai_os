/**
 * BYOK Phase 1：個人 AI 供應商 API Key（目前只支援 fal）。
 *
 * 資安設計沿用 services/integrations 與 adobe/tokenService 已確立的慣例：
 * - 金鑰屬「需重放」型 → AES-256-GCM 加密落庫（iv:tag:cipher hex），不是雜湊；原文永不回前端。
 * - 金鑰由同一顆持久種子（INTEGRATION_TOKEN_SECRET → Volume 持久檔）分域派生 `ai-provider-key:`——
 *   與 Google/Notion/Adobe 的密文互不可解；種子與 DB 分離，DB 外洩不可解密。
 * - setKey 先做輕量探活（不觸發付費生成）再落庫；401 → 拒絕保存。
 * - 解密失敗（金鑰輪替／檔案遺失）→ 列標記 error，UI 引導重新貼上，不是無聲失敗。
 *
 * Phase 1 只做 CRUD + testConnection；falSubmit 覆寫與雙模計費是 Phase 2。
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, schema } from "../db";
import { deriveIntegrationKey } from "./integrations";
import { proxyFetch } from "./http";

export type AiProvider = "fal";
export type AiKeyStatus = "active" | "error" | "unverified";

export type UserAiProviderKeyRow = typeof schema.userAiProviderKeys.$inferSelect;

/** 前端可見的公開視圖——絕不含密文／原文 */
export interface UserAiKeyPublic {
  provider: AiProvider;
  keyLast4: string;
  status: AiKeyStatus;
  preferUserKey: boolean;
  validatedAt: Date | null;
  lastUsedAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

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
  if (!ivHex || !tagHex || !dataHex) throw new Error("AI 金鑰憑證格式不正確");
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
    updatedAt: row.updatedAt,
  };
}

/** 純函式（可測）：金鑰格式粗檢——fal key 通常是可列印 ASCII、長度合理 */
export function validateFalKeyFormat(key: string): string | null {
  const trimmed = key.trim();
  if (!trimmed) return "請貼上 fal.ai API Key";
  if (trimmed.length < 16 || trimmed.length > 500) return "fal.ai API Key 長度不正確";
  if (!/^[\x21-\x7E]+$/.test(trimmed)) return "API Key 含不可見字元——請重新複製貼上";
  return null;
}

/**
 * fal 輕量探活：打 queue 根路徑或 models 列表。
 * 401 → 金鑰無效；2xx/其他 4xx（非授權）→ 視為金鑰可被接受（不觸發付費生成）。
 * 網路錯誤回 transient 訊息，不落庫。
 */
export async function testFalConnection(plaintextKey: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const key = plaintextKey.trim();
  try {
    // 使用 fal platform API 的 models 列表（免費、不進 queue、不扣額度）
    const res = await proxyFetch("https://api.fal.ai/v1/models?limit=1", {
      headers: { Authorization: `Key ${key}` },
      timeoutMs: 15_000,
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, message: "fal.ai 不認得這個金鑰——請到 fal.ai → API Keys 確認後重新貼上" };
    }
    // 2xx 或非授權類 4xx（例如 404/422 因 path 差異）都視為金鑰本身可用
    if (res.status >= 500) {
      return { ok: false, message: "fal.ai 服務暫時無法使用，請稍後再試" };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      message: `無法連線到 fal.ai：${err instanceof Error ? err.message : "網路錯誤"}`,
    };
  }
}

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
 * 設定／覆蓋個人金鑰：先格式檢查 → 探活 → 加密落庫。
 * 探活失敗不寫入（避免把壞金鑰存進去）。
 */
export async function setKey(
  userId: string,
  provider: AiProvider,
  plaintext: string,
): Promise<UserAiKeyPublic> {
  if (provider !== "fal") throw new Error(`目前尚不支援供應商「${provider}」`);
  const formatErr = validateFalKeyFormat(plaintext);
  if (formatErr) throw new Error(formatErr);

  const trimmed = plaintext.trim();
  const probe = await testFalConnection(trimmed);
  if (!probe.ok) throw new Error(probe.message);

  const secretEnc = encryptKey(trimmed);
  const keyLast4 = trimmed.slice(-4);
  const now = new Date();
  const values = {
    secretEnc,
    keyLast4,
    status: "active" as const,
    validatedAt: now,
    lastError: null,
    updatedAt: now,
  };

  const existing = await findRow(userId, provider);
  if (existing) {
    const [row] = await db.update(schema.userAiProviderKeys)
      .set(values)
      .where(eq(schema.userAiProviderKeys.id, existing.id))
      .returning();
    return toPublic(row);
  }
  const [row] = await db.insert(schema.userAiProviderKeys).values({
    userId,
    provider,
    preferUserKey: true,
    ...values,
  }).returning();
  return toPublic(row);
}

/** 移除個人金鑰（冪等） */
export async function removeKey(userId: string, provider: AiProvider): Promise<void> {
  await db.delete(schema.userAiProviderKeys)
    .where(and(
      eq(schema.userAiProviderKeys.userId, userId),
      eq(schema.userAiProviderKeys.provider, provider),
    ));
}

/** 切換「優先使用個人金鑰」開關 */
export async function setPreferUserKey(
  userId: string,
  provider: AiProvider,
  preferUserKey: boolean,
): Promise<UserAiKeyPublic> {
  const existing = await findRow(userId, provider);
  if (!existing) throw new Error("尚未設定此供應商的個人金鑰");
  const [row] = await db.update(schema.userAiProviderKeys)
    .set({ preferUserKey, updatedAt: new Date() })
    .where(eq(schema.userAiProviderKeys.id, existing.id))
    .returning();
  return toPublic(row);
}

/**
 * 內部用：取得解密後的金鑰（給 Phase 2 falSubmit 覆寫）。
 * 無列／非 active／解密失敗 → null（呼叫端退回站方 FAL_KEY）。
 */
export async function getDecryptedKey(userId: string, provider: AiProvider): Promise<string | null> {
  const row = await findRow(userId, provider);
  if (!row || row.status !== "active" || !row.preferUserKey) return null;
  try {
    const plain = decryptKey(row.secretEnc);
    void db.update(schema.userAiProviderKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(schema.userAiProviderKeys.id, row.id))
      .catch(() => {});
    return plain;
  } catch {
    await db.update(schema.userAiProviderKeys)
      .set({
        status: "error",
        lastError: "憑證解密失敗（伺服器金鑰可能已輪替）——請重新貼上 API Key",
        updatedAt: new Date(),
      })
      .where(eq(schema.userAiProviderKeys.id, row.id))
      .catch(() => {});
    return null;
  }
}

/**
 * 只測金鑰、不落庫（設定頁「測試連線」按鈕用）。
 * 若省略 plaintext 則用已存的 active 金鑰重測。
 */
export async function testKey(
  userId: string,
  provider: AiProvider,
  plaintext?: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (provider !== "fal") return { ok: false, message: `目前尚不支援供應商「${provider}」` };

  let key = plaintext?.trim() ?? "";
  if (!key) {
    const row = await findRow(userId, provider);
    if (!row) return { ok: false, message: "尚未設定此供應商的個人金鑰" };
    try {
      key = decryptKey(row.secretEnc);
    } catch {
      return { ok: false, message: "已存金鑰無法解密——請重新貼上" };
    }
  } else {
    const formatErr = validateFalKeyFormat(key);
    if (formatErr) return { ok: false, message: formatErr };
  }

  const result = await testFalConnection(key);
  // 若是測已存金鑰，依結果更新 status
  if (!plaintext) {
    const row = await findRow(userId, provider);
    if (row) {
      if (result.ok) {
        await db.update(schema.userAiProviderKeys)
          .set({ status: "active", validatedAt: new Date(), lastError: null, updatedAt: new Date() })
          .where(eq(schema.userAiProviderKeys.id, row.id))
          .catch(() => {});
      } else {
        await db.update(schema.userAiProviderKeys)
          .set({ status: "error", lastError: result.message, updatedAt: new Date() })
          .where(eq(schema.userAiProviderKeys.id, row.id))
          .catch(() => {});
      }
    }
  }
  return result;
}
