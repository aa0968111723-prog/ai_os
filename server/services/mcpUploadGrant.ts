/**
 * MCP 素材上傳授權：簽發單次 aidup_ grant，真正選檔仍走 POST /api/upload。
 * MCP JSON-RPC 不傳二進位；外部 AI 取得 token 後請使用者／腳本上傳。
 */
import { and, eq, gt, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db, schema } from "../db";
import type { AuthState } from "./auth";
import { requireGroup } from "../trpc";
import { assertProjectEditable } from "./projectAcl";
import {
  createUploadGrant,
  looksLikeUuid,
  UPLOAD_GRANT_MAX_TTL_SEC,
} from "./uploadGrants";
import { MAX_FILE_BYTES } from "./storage";

/** MCP 上傳授權預設有效 1 小時（比網頁桌面 handoff 24h 更緊）。 */
export const MCP_UPLOAD_GRANT_DEFAULT_TTL_SEC = 3600;
/** 每位使用者同時未使用且未過期的 grant 上限，防灌爆。 */
export const MCP_UPLOAD_GRANT_MAX_PENDING = 5;

/** 對外絕對網址基底（與 signAssetUrl 同口徑）。 */
export function publicAppBase(): string {
  return process.env.APP_URL?.replace(/\/$/, "") || `http://localhost:${process.env.PORT ?? 3000}`;
}

export const MCP_UPLOAD_GRANT_TOOLS = [
  {
    name: "request_upload_grant",
    description:
      "簽發單次素材上傳授權（前綴 aidup_）。MCP 不接受二進位檔案；請把回傳的 token 用於 POST /api/upload（Authorization: Bearer aidup_… + multipart file），或請使用者到網頁上傳台選檔。成功入庫後用 list_assets 確認。token 只回一次。",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        maxBytes: { type: "number", description: "此授權允許的最大位元組（不可超過系統上限；可省略＝系統上限）" },
        ttlSeconds: { type: "number", description: "有效秒數（預設 3600＝1 小時；下限 60、上限 7 天）" },
        sourceAssetId: { type: "string", description: "可選：來源素材 id（寫入 lineage）" },
        purpose: { type: "string", description: "可選：用途備註（僅審計，不影響上傳）", maxLength: 120 },
      },
      required: ["projectId"],
      additionalProperties: false,
    },
  },
  {
    name: "get_upload_grant_status",
    description: "查詢你簽發的上傳授權狀態（pending／used／expired／revoked）。不回 token 原文。",
    inputSchema: {
      type: "object",
      properties: { grantId: { type: "string" } },
      required: ["grantId"],
      additionalProperties: false,
    },
  },
] as const;

export async function handleGetUploadGrantStatus(
  auth: AuthState,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const grantId = String(args.grantId ?? "");
  if (!looksLikeUuid(grantId)) throw new TRPCError({ code: "BAD_REQUEST", message: "grantId 無效" });
  const [row] = await db.select().from(schema.uploadGrants).where(eq(schema.uploadGrants.id, grantId));
  if (!row || row.userId !== auth.user.id) {
    throw new TRPCError({ code: "NOT_FOUND", message: "找不到這筆上傳授權（或不屬於你）" });
  }
  requireGroup(auth, row.groupId);
  const now = Date.now();
  let status: "pending" | "used" | "expired" | "revoked" = "pending";
  if (row.revokedAt) status = "revoked";
  else if (row.usedAt) status = "used";
  else if (row.expiresAt.getTime() <= now) status = "expired";
  return {
    grantId: row.id,
    projectId: row.projectId,
    status,
    maxBytes: row.maxBytes,
    expiresAt: row.expiresAt,
    usedAt: row.usedAt,
    revokedAt: row.revokedAt,
  };
}

export async function handleRequestUploadGrant(
  auth: AuthState,
  project: { id: string; groupId: string },
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  await assertProjectEditable(auth, project);

  const pending = await db
    .select({ id: schema.uploadGrants.id })
    .from(schema.uploadGrants)
    .where(
      and(
        eq(schema.uploadGrants.userId, auth.user.id),
        isNull(schema.uploadGrants.usedAt),
        isNull(schema.uploadGrants.revokedAt),
        gt(schema.uploadGrants.expiresAt, new Date()),
      ),
    );
  if (pending.length >= MCP_UPLOAD_GRANT_MAX_PENDING) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: `未使用的上傳授權已達上限（${MCP_UPLOAD_GRANT_MAX_PENDING} 筆）——請先用掉或等過期後再簽`,
    });
  }

  let sourceAssetId: string | null = null;
  if (args.sourceAssetId != null && String(args.sourceAssetId).trim()) {
    const sid = String(args.sourceAssetId).trim();
    if (!looksLikeUuid(sid)) throw new TRPCError({ code: "BAD_REQUEST", message: "來源素材 id 無效" });
    const [src] = await db.select().from(schema.assets).where(eq(schema.assets.id, sid));
    if (!src || src.projectId !== project.id) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "來源素材不在此專案" });
    }
    sourceAssetId = sid;
  }

  let maxBytes = MAX_FILE_BYTES;
  if (args.maxBytes != null && args.maxBytes !== "") {
    const n = Number(args.maxBytes);
    if (!Number.isFinite(n) || n < 1) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "maxBytes 無效" });
    }
    maxBytes = Math.min(Math.floor(n), MAX_FILE_BYTES);
  }

  let ttlSeconds = MCP_UPLOAD_GRANT_DEFAULT_TTL_SEC;
  if (args.ttlSeconds != null && args.ttlSeconds !== "") {
    const t = Number(args.ttlSeconds);
    if (!Number.isFinite(t)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "ttlSeconds 無效" });
    }
    ttlSeconds = Math.min(UPLOAD_GRANT_MAX_TTL_SEC, Math.max(60, Math.floor(t)));
  }

  const grant = await createUploadGrant({
    userId: auth.user.id,
    projectId: project.id,
    groupId: project.groupId,
    sourceAssetId,
    maxBytes,
    ttlSeconds,
  });

  console.log(
    `[audit] mcp.request_upload_grant：user=${auth.user.id} project=${project.id} grant=${grant.id}`,
  );

  const base = publicAppBase();
  return {
    grantId: grant.id,
    token: grant.token,
    expiresAt: grant.expiresAt,
    maxBytes: grant.maxBytes,
    projectId: grant.projectId,
    uploadUrl: `${base}/api/upload`,
    http: {
      method: "POST",
      headers: { Authorization: `Bearer ${grant.token}` },
      multipart: {
        file: "<binary>",
      },
    },
    webHandoffPath: "/mcp-upload",
    instructions:
      "MCP 無法直接接收檔案。請用回傳的 token 對 uploadUrl 做 multipart 上傳（Authorization: Bearer aidup_…），或請使用者到網頁「MCP 上傳台」貼上 token 並用檔案選擇器選檔。成功後呼叫 list_assets 確認。token 僅此一次。",
  };
}
