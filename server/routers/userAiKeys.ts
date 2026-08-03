import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure } from "../trpc";
import {
  listForUser,
  setKey,
  removeKey,
  setPreferUserKey,
  testKey,
} from "../services/userAiKeys";
import {
  consumeRateLimit,
  RATE_LIMIT_POLICIES,
  RATE_LIMIT_SCOPES,
  RateLimitConfigurationError,
  RateLimitUnavailableError,
} from "../services/rateLimit";

const providerSchema = z.enum(["fal"]);

/**
 * BYOK Phase 1：個人 AI API Key 自助管理。
 * 全走 authedProcedure：只能操作自己的金鑰；敏感輸入欄位命名為 key——
 * sanitizeAuditInput 依鍵名整鍵剔除，原文不落 audit_log。
 */
export const userAiKeysRouter = router({
  /** 我的個人金鑰清單（絕不回密文／原文——只給末四碼與狀態） */
  list: authedProcedure.query(({ ctx }) => listForUser(ctx.auth.user.id)),

  /**
   * 設定／更換個人金鑰：先格式檢查＋fal 探活，通過才加密落庫。
   * 探活失敗回 BAD_REQUEST，不寫入。
   */
  set: authedProcedure
    .input(z.object({
      provider: providerSchema,
      key: z.string().min(1).max(500),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const rate = await consumeRateLimit(
          RATE_LIMIT_SCOPES.apiFetch,
          ctx.auth.user.id,
          RATE_LIMIT_POLICIES.apiFetch,
        );
        if (!rate.allowed) {
          throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "操作太頻繁——請一分鐘後再試" });
        }
      } catch (err) {
        if (err instanceof RateLimitUnavailableError || err instanceof RateLimitConfigurationError) {
          throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "安全限流暫時無法使用，請稍後再試" });
        }
        if (err instanceof TRPCError) throw err;
        throw err;
      }
      try {
        return await setKey(ctx.auth.user.id, input.provider, input.key);
      } catch (err) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: err instanceof Error ? err.message : "金鑰設定失敗",
        });
      }
    }),

  /** 移除個人金鑰（冪等） */
  remove: authedProcedure
    .input(z.object({ provider: providerSchema }))
    .mutation(async ({ ctx, input }) => {
      await removeKey(ctx.auth.user.id, input.provider);
      return { ok: true };
    }),

  /** 切換「優先使用個人金鑰」 */
  setPrefer: authedProcedure
    .input(z.object({
      provider: providerSchema,
      preferUserKey: z.boolean(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await setPreferUserKey(ctx.auth.user.id, input.provider, input.preferUserKey);
      } catch (err) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: err instanceof Error ? err.message : "找不到此金鑰",
        });
      }
    }),

  /**
   * 測試連線：可帶 plaintext（設定前預測）或不帶（重測已存金鑰）。
   * 不寫入新金鑰；已存金鑰會依結果更新 status。
   */
  test: authedProcedure
    .input(z.object({
      provider: providerSchema,
      key: z.string().min(1).max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const rate = await consumeRateLimit(
          RATE_LIMIT_SCOPES.apiFetch,
          ctx.auth.user.id,
          RATE_LIMIT_POLICIES.apiFetch,
        );
        if (!rate.allowed) {
          throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "操作太頻繁——請一分鐘後再試" });
        }
      } catch (err) {
        if (err instanceof RateLimitUnavailableError || err instanceof RateLimitConfigurationError) {
          throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "安全限流暫時無法使用，請稍後再試" });
        }
        if (err instanceof TRPCError) throw err;
        throw err;
      }
      return testKey(ctx.auth.user.id, input.provider, input.key);
    }),
});
