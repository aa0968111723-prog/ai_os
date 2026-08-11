import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { authedProcedure, router } from "../trpc";
import {
  askOpenAiThroughMcp,
  configuredOpenAiMcpModel,
  decideOpenAiMcpApprovals,
  isOpenAiMcpConfigured,
  resolveOpenAiMcpServerUrl,
} from "../services/openaiMcpBridge";
import {
  consumeRateLimit,
  RATE_LIMIT_POLICIES,
  RATE_LIMIT_SCOPES,
  RateLimitConfigurationError,
  RateLimitUnavailableError,
} from "../services/rateLimit";

const decisionSchema = z.object({
  approvalRequestId: z.string().min(1).max(300),
  approve: z.boolean(),
  reason: z.string().trim().max(300).optional(),
});

async function guardRate(userId: string): Promise<void> {
  try {
    const decision = await consumeRateLimit(
      RATE_LIMIT_SCOPES.globalAssistant,
      userId,
      RATE_LIMIT_POLICIES.globalAssistant,
    );
    if (!decision.allowed) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: `GPT 直接操作太頻繁，請約 ${Math.max(1, Math.ceil(decision.retryAfterMs / 1_000))} 秒後再試`,
      });
    }
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    if (error instanceof RateLimitUnavailableError || error instanceof RateLimitConfigurationError) {
      throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "安全限流暫時無法使用，請稍後再試" });
    }
    throw error;
  }
}

function requestOrigin(req: { protocol: string; get(name: string): string | undefined }): string | undefined {
  const host = req.get("host")?.trim();
  if (!host) return undefined;
  return `${req.protocol}://${host}`;
}

function mapBridgeError(error: unknown): never {
  const message = error instanceof Error ? error.message : "GPT 直接操作暫時失敗";
  if (message.includes("OPENAI_API_KEY") || message.includes("PUBLIC_APP_URL")) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message });
  }
  if (message.includes("金鑰數已達上限")) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message });
  }
  if (message.includes("逾時") || message.includes("失效") || message.includes("簽章") || message.includes("不屬於")) {
    throw new TRPCError({ code: "BAD_REQUEST", message });
  }
  if (message.startsWith("OpenAI ") || message.startsWith("OpenAI Responses")) {
    throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message });
  }
  throw new TRPCError({ code: "BAD_REQUEST", message });
}

/**
 * GPT-5.6 Responses API × AI-OS Remote MCP。
 *
 * 讀取工具：模型可自動呼叫。
 * 寫入工具：OpenAI 只回 mcp_approval_request，前端逐項確認後才以短效可寫 MCP key 繼續。
 * MCP 本身仍以登入者身分走原有 ACL／點數／封存／資料驗證／審計，不另開後門。
 */
export const openaiMcpRouter = router({
  status: authedProcedure.query(() => ({
    configured: isOpenAiMcpConfigured(),
    model: configuredOpenAiMcpModel(),
    billing: "OpenAI API 用量走 OPENAI_API_KEY 的 OpenAI 帳單；MCP 內部生成仍照 AI-OS 既有點數與核准門檻。",
  })),

  ask: authedProcedure
    .input(z.object({ message: z.string().trim().min(1, "請輸入要 GPT 幫你做的事").max(8_000) }))
    .mutation(async ({ ctx, input }) => {
      await guardRate(ctx.auth.user.id);
      try {
        const serverUrl = resolveOpenAiMcpServerUrl(requestOrigin(ctx.req));
        return await askOpenAiThroughMcp(ctx.auth, input.message, serverUrl);
      } catch (error) {
        return mapBridgeError(error);
      }
    }),

  decide: authedProcedure
    .input(z.object({
      continuation: z.string().min(20).max(20_000),
      decisions: z.array(decisionSchema).min(1).max(20),
    }))
    .mutation(async ({ ctx, input }) => {
      await guardRate(ctx.auth.user.id);
      try {
        const serverUrl = resolveOpenAiMcpServerUrl(requestOrigin(ctx.req));
        return await decideOpenAiMcpApprovals(ctx.auth, input.continuation, input.decisions, serverUrl);
      } catch (error) {
        return mapBridgeError(error);
      }
    }),
});
