/**
 * MCP 個人連線金鑰自助管理（每位登入使用者都可用）：
 * 建立／列出／撤銷「自己的」金鑰——讓每位夥伴各自拿到金鑰，外部 AI 客戶端帶它連進來時
 * 一律以該人的身分與權限操作系統（見 services/mcp、services/mcpAuth）。
 * 全走 authedProcedure：mutation 自動落審計（trpc.ts 中介層），且只能碰自己的金鑰。
 */
import { z } from "zod";
import { and, desc, eq, like } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure } from "../trpc";
import { db, schema } from "../db";
import {
  activeMcpTokenCount,
  createMcpToken,
  listMcpTokens,
  revokeMcpToken,
  MCP_TOKEN_MAX_PER_USER,
} from "../services/mcpAuth";

/** 到期天數上限：一年夠長、又避免「幾乎永不過期」的長效金鑰失去意義 */
const MAX_EXPIRE_DAYS = 365;

export const mcpTokensRouter = router({
  /** 列出自己的金鑰（不含原文；未撤銷優先、新到舊） */
  list: authedProcedure.query(async ({ ctx }) => {
    return listMcpTokens(ctx.auth.user.id);
  }),

  /**
   * 建立一把新金鑰：回傳「原文」——僅此一次，之後只存雜湊、再也拿不回。
   * 先擋每人有效金鑰上限，避免無限灌爆。可選最小權限：唯讀、到期天數。
   */
  create: authedProcedure
    .input(z.object({
      label: z.string().trim().min(1, "請幫這把金鑰取個名字").max(40, "名稱請在 40 字內"),
      /** true＝唯讀金鑰（只准讀取類工具）——交給外部自動化時建議勾選 */
      readOnly: z.boolean().optional(),
      /** 幾天後到期（不填＝永不過期）；1～365 天 */
      expiresInDays: z.number().int().min(1).max(MAX_EXPIRE_DAYS).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const count = await activeMcpTokenCount(ctx.auth.user.id);
      if (count >= MCP_TOKEN_MAX_PER_USER) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `金鑰數已達上限（${MCP_TOKEN_MAX_PER_USER} 把）——請先撤銷用不到的再新增`,
        });
      }
      const expiresAt = input.expiresInDays != null ? new Date(Date.now() + input.expiresInDays * 86_400_000) : null;
      return createMcpToken(ctx.auth.user.id, input.label, { readOnly: input.readOnly ?? false, expiresAt });
    }),

  /** 撤銷自己的一把金鑰（冪等；撤掉後帶它連線立即失效） */
  revoke: authedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const revoked = await revokeMcpToken(ctx.auth.user.id, input.id);
      return { revoked };
    }),

  /**
   * 我最近的 MCP 活動（觀測性）：只回「本人」透過 MCP 觸發的審計列（action 以 mcp. 開頭）。
   * 安全：一律綁 actorId＝本人，看不到別人的活動（不需管理權限，是自己的操作紀錄）。
   * 供專區頁顯示「這把金鑰在做什麼」，也讓使用者一眼看出是否有異常呼叫。
   */
  recentActivity: authedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).optional() }).optional())
    .query(async ({ ctx, input }) => {
      const rows = await db
        .select({
          id: schema.auditLog.id,
          action: schema.auditLog.action,
          projectId: schema.auditLog.projectId,
          input: schema.auditLog.input, // 落庫前已由 sanitizeAuditInput 脫敏截斷；且只回本人的列
          ok: schema.auditLog.ok,
          error: schema.auditLog.error,
          createdAt: schema.auditLog.createdAt,
        })
        .from(schema.auditLog)
        .where(and(eq(schema.auditLog.actorId, ctx.auth.user.id), like(schema.auditLog.action, "mcp.%")))
        .orderBy(desc(schema.auditLog.createdAt))
        .limit(input?.limit ?? 30);
      return rows;
    }),
});
