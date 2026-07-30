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
      "簽發單次素材上傳授權（aidup_…）。MCP 不傳二進位檔；回傳 token + uploadUrl 後，請使用者或腳本對 /api/upload 上傳，或到網頁上傳台選檔。",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "目標專案 ID（必須有編輯權）" },
        ttlSeconds: {
          type: "number",
          description: `授權有效秒數（預設 ${3600}，上限見 UPLOAD_GRANT_MAX_TTL_SEC）`,
        },
        note: { type: "string", description: "可選備註（僅自己可見）" },
      },
      required: ["projectId"],
    },
  },
  {
    name: "get_upload_grant_status",
    description: "查詢你簽發的上傳授權是否仍有效／已用／過期（不回 token 原文）。",
    inputSchema: {
      type: "object",
      properties: {
        grantId: { type: "string", description: "request_upload_grant 回傳的 grantId" },
      },
      required: ["grantId"],
    },
  },
] as const;

export async function handleRequestUploadGrant(
  auth: AuthState,
  project: { id: string; groupId: string; status: string },
  args: Record<string, unknown>,
) {
  const projectId = String(args.projectId ?? project.id);
  if (projectId !== project.id) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "projectId 必須與目前上下文一致" });
  }

  // ACL + 封存已由呼叫端 assertProjectEditable / archivedWriteReason 處理
  await assertProjectEditable(auth, projectId);

  // pending 上限
  const pending = await db
    .select({ id: schema.uploadGrants.id })
    .from(schema.uploadGrants)
    .where(
      and(
        eq(schema.uploadGrants.userId, auth.user.id),
        isNull(schema.uploadGrants.usedAt),
        gt(schema.uploadGrants.expiresAt, new Date()),
      ),
    );
  if (pending.length >= MCP_UPLOAD_GRANT_MAX_PENDING) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: `你同時有 ${pending.length} 個未使用的上傳授權（上限 ${MCP_UPLOAD_GRANT_MAX_PENDING}）。請先用掉或等過期再簽。`,
    });
  }

  let ttl = MCP_UPLOAD_GRANT_DEFAULT_TTL_SEC;
  if (typeof args.ttlSeconds === "number" && Number.isFinite(args.ttlSeconds)) {
    ttl = Math.min(Math.max(60, Math.floor(args.ttlSeconds)), UPLOAD_GRANT_MAX_TTL_SEC);
  }

  const note = typeof args.note === "string" ? args.note.slice(0, 200) : undefined;

  const { token, grant } = await createUploadGrant({
    userId: auth.user.id,
    projectId,
    ttlSeconds: ttl,
    note,
    source: "mcp",
  });

  const base = publicAppBase();
  const uploadUrl = `${base}/api/upload`;
  return {
    grantId: grant.id,
    token, // 僅此一次回傳
    uploadUrl,
    expiresAt: grant.expiresAt.toISOString(),
    maxBytes: MAX_FILE_BYTES,
    instructions: [
      "1. 用 Authorization: Bearer <token> 或 form field grantToken 呼叫 POST /api/upload",
      "2. 或把 token 貼到網頁「上傳台」選檔",
      "3. 成功後可用 get_upload_grant_status 確認 status=used",
      "4. token 為一次性；過期或用過即失效",
    ],
  };
}

export async function handleGetUploadGrantStatus(auth: AuthState, args: Record<string, unknown>) {
  const grantId = String(args.grantId ?? "");
  if (!looksLikeUuid(grantId)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "grantId 必須是有效 UUID" });
  }

  const [row] = await db
    .select()
    .from(schema.uploadGrants)
    .where(and(eq(schema.uploadGrants.id, grantId), eq(schema.uploadGrants.userId, auth.user.id)))
    .limit(1);

  if (!row) {
    throw new TRPCError({ code: "NOT_FOUND", message: "找不到此上傳授權（或不屬於你）" });
  }

  const now = new Date();
  let status: "pending" | "used" | "expired" = "pending";
  if (row.usedAt) status = "used";
  else if (row.expiresAt <= now) status = "expired";

  return {
    grantId: row.id,
    projectId: row.projectId,
    status,
    expiresAt: row.expiresAt.toISOString(),
    usedAt: row.usedAt?.toISOString() ?? null,
    note: row.note ?? null,
  };
}
