/**
 * MCP 個人連線金鑰自助管理（每位登入使用者都可用）：
 * 建立／列出／撤銷「自己的」金鑰——讓每位夥伴各自拿到金鑰，外部 AI 客戶端帶它連進來時
 * 一律以該人的身分與權限操作系統（見 services/mcp、services/mcpAuth）。
 * 全走 authedProcedure：mutation 自動落審計（trpc.ts 中介層），且只能碰自己的金鑰。
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure } from "../trpc";
import {
  activeMcpTokenCount,
  createMcpToken,
  listMcpTokens,
  revokeMcpToken,
  MCP_TOKEN_MAX_PER_USER,
} from "../services/mcpAuth";

export const mcpTokensRouter = router({
  /** 列出自己的金鑰（不含原文；未撤銷優先、新到舊） */
  list: authedProcedure.query(async ({ ctx }) => {
    return listMcpTokens(ctx.auth.user.id);
  }),

  /**
   * 建立一把新金鑰：回傳「原文」——僅此一次，之後只存雜湊、再也拿不回。
   * 先擋每人有效金鑰上限，避免無限灌爆。
   */
  create: authedProcedure
    .input(z.object({ label: z.string().trim().min(1, "請幫這把金鑰取個名字").max(40, "名稱請在 40 字內") }))
    .mutation(async ({ ctx, input }) => {
      const count = await activeMcpTokenCount(ctx.auth.user.id);
      if (count >= MCP_TOKEN_MAX_PER_USER) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `金鑰數已達上限（${MCP_TOKEN_MAX_PER_USER} 把）——請先撤銷用不到的再新增`,
        });
      }
      return createMcpToken(ctx.auth.user.id, input.label);
    }),

  /** 撤銷自己的一把金鑰（冪等；撤掉後帶它連線立即失效） */
  revoke: authedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const revoked = await revokeMcpToken(ctx.auth.user.id, input.id);
      return { revoked };
    }),
});
