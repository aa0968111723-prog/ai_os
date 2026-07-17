/**
 * MCP 身分解析（per-user 金鑰）：把外部客戶端帶來的金鑰對應到「某位使用者」，
 * 之後 MCP 工具一律以該使用者的真實權限執行（見 services/mcp.ts）。
 *
 * 兩條認證路徑並存：
 *  1) 個人金鑰（本檔，推薦）：每人自助建立、可撤銷；解析成該人的 AuthState。
 *  2) 舊有共用金鑰 env MCP_API_KEY（向後相容）：對應到超級管理員身分。
 *     這是「單一金鑰＝人人超管」的舊模型，僅為不破壞既有部署／e2e 而保留；
 *     要讓夥伴各自依權限連線，請改用個人金鑰、並移除此環境變數。
 *
 * 保護等級與 sessions/invites 一致：DB 只存 SHA-256，原文只在建立當下回一次。
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "../db";
import { loadAuthState, type AuthState } from "./auth";

/** 金鑰前綴：讓人一眼認出這是 AI Director 的 MCP 金鑰（也方便日後掃描外洩） */
export const MCP_TOKEN_PREFIX = "aidmcp_";
/** 每人可同時存在的有效金鑰上限（多裝置夠用，又擋無限灌爆） */
export const MCP_TOKEN_MAX_PER_USER = 10;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** 產生一把新金鑰原文（前綴＋256-bit 隨機 hex）——只在建立時回一次 */
export function newMcpTokenPlaintext(): string {
  return MCP_TOKEN_PREFIX + randomBytes(32).toString("hex");
}

/**
 * 金鑰是否「格式上像」一把 MCP 個人金鑰（純函式，供快速排除／單元測試）：
 * 前綴正確且其餘為 64 位 hex。格式不符者連 DB 都不必查（省一次查詢、也縮小攻擊面）。
 */
export function looksLikeMcpToken(provided: string): boolean {
  if (!provided.startsWith(MCP_TOKEN_PREFIX)) return false;
  const body = provided.slice(MCP_TOKEN_PREFIX.length);
  return /^[0-9a-f]{64}$/.test(body);
}

/** 固定時間比對 env 共用金鑰（先等長再 timingSafeEqual，避免以耗時差回推） */
export function envKeyMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** 會「寫入／扣點」的工具（讀取類不在內）——封存專案守衛與未來擴充的單一清單 */
export const MCP_WRITE_TOOLS = new Set(["submit_generation", "post_message"]);

/**
 * 封存專案寫入守衛（純函式，供單元測試）：外部 AI 客戶端拿舊 projectId 對已封存專案
 * 生成／留言，會讓擁有者以為停用卻持續扣點——寫入類工具一律擋，讀取類放行。
 */
export function archivedWriteReason(name: string, status: string): string | null {
  if (status === "archived" && MCP_WRITE_TOOLS.has(name)) {
    return "此專案已封存——請先在網頁端還原專案，或改用其他專案";
  }
  return null;
}

export type McpIdentity =
  | { kind: "user"; auth: AuthState; tokenId: string }
  | { kind: "admin"; auth: AuthState };

/**
 * MCP 是否已啟用：設了 env 共用金鑰，或至少有一把未撤銷的個人金鑰存在。
 * 兩者皆無＝沒人開通，維持「未啟用」（handleMcp 回 404、不對外張揚端點）。
 */
export async function isMcpEnabled(): Promise<boolean> {
  if (process.env.MCP_API_KEY) return true;
  const [row] = await db
    .select({ id: schema.mcpTokens.id })
    .from(schema.mcpTokens)
    .where(isNull(schema.mcpTokens.revokedAt))
    .limit(1);
  return row != null;
}

/**
 * 解析金鑰 → 身分。找不到／已撤銷／使用者停用皆回 null（呼叫端一律回 401，不區分原因）。
 * 成功時 fire-and-forget 更新 lastUsedAt（純輔助資訊，失敗不影響認證）。
 */
export async function resolveMcpIdentity(provided: string): Promise<McpIdentity | null> {
  // 路徑 2：舊有共用金鑰 → 超管。放在最前面，維持既有部署行為不變。
  const envKey = process.env.MCP_API_KEY;
  if (envKey && envKeyMatches(provided, envKey)) {
    const [admin] = await db.select().from(schema.users).where(eq(schema.users.isSuperAdmin, true)).limit(1);
    if (!admin) return null; // 系統尚未初始化
    const auth = await loadAuthState(admin.id);
    return auth ? { kind: "admin", auth } : null;
  }

  // 路徑 1：個人金鑰。格式不符直接排除（避免拿 env 金鑰或亂碼去查表）。
  if (!looksLikeMcpToken(provided)) return null;
  const [row] = await db
    .select()
    .from(schema.mcpTokens)
    .where(and(eq(schema.mcpTokens.tokenHash, sha256(provided)), isNull(schema.mcpTokens.revokedAt)));
  if (!row) return null;
  const auth = await loadAuthState(row.userId); // 使用者停用／不存在 → null
  if (!auth) return null;
  // lastUsedAt 更新（射後不理）：認證結果已定，這只是給使用者看的輔助欄位
  void db
    .update(schema.mcpTokens)
    .set({ lastUsedAt: new Date() })
    .where(eq(schema.mcpTokens.id, row.id))
    .catch((err) => console.warn("[mcp] lastUsedAt 更新失敗（不影響認證）：", err instanceof Error ? err.message : err));
  return { kind: "user", auth, tokenId: row.id };
}

/* ── 自助管理（供 routers/mcpTokens 呼叫） ── */

/** 建立一把新金鑰：回原文（只此一次）＋列資訊。呼叫端須先擋上限。 */
export async function createMcpToken(userId: string, label: string): Promise<{ id: string; token: string; label: string }> {
  const token = newMcpTokenPlaintext();
  const [row] = await db
    .insert(schema.mcpTokens)
    .values({ userId, tokenHash: sha256(token), label })
    .returning();
  return { id: row.id, token, label: row.label };
}

/** 列出某人的金鑰（不含原文與雜湊）——供管理 UI 顯示。 */
export async function listMcpTokens(userId: string): Promise<
  Array<{ id: string; label: string; lastUsedAt: Date | null; revokedAt: Date | null; createdAt: Date }>
> {
  const rows = await db
    .select({
      id: schema.mcpTokens.id,
      label: schema.mcpTokens.label,
      lastUsedAt: schema.mcpTokens.lastUsedAt,
      revokedAt: schema.mcpTokens.revokedAt,
      createdAt: schema.mcpTokens.createdAt,
    })
    .from(schema.mcpTokens)
    .where(eq(schema.mcpTokens.userId, userId));
  // 未撤銷優先、再依建立時間新到舊
  return rows.sort((a, b) => {
    if ((a.revokedAt == null) !== (b.revokedAt == null)) return a.revokedAt == null ? -1 : 1;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });
}

/** 未撤銷金鑰數（建立前擋上限用） */
export async function activeMcpTokenCount(userId: string): Promise<number> {
  const rows = await db
    .select({ id: schema.mcpTokens.id })
    .from(schema.mcpTokens)
    .where(and(eq(schema.mcpTokens.userId, userId), isNull(schema.mcpTokens.revokedAt)));
  return rows.length;
}

/** 撤銷自己的一把金鑰（冪等；只能撤自己的）。回是否有實際撤銷到列。 */
export async function revokeMcpToken(userId: string, tokenId: string): Promise<boolean> {
  const updated = await db
    .update(schema.mcpTokens)
    .set({ revokedAt: new Date() })
    .where(and(
      eq(schema.mcpTokens.id, tokenId),
      eq(schema.mcpTokens.userId, userId), // 只能撤自己的——別人的 id 撈不到不會被撤
      isNull(schema.mcpTokens.revokedAt),
    ))
    .returning();
  return updated.length > 0;
}
