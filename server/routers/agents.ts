import { z } from "zod";
import { router, authedProcedure } from "../trpc";
import {
  planAgentCore,
  approveAgentCore,
  discardAgentCore,
  stopAgentCore,
  listAgentRunsForProject,
} from "../services/agentCore";

/**
 * AI 代理（代理系統核心）：一句目標 → LLM 規劃多步計畫（估點）→ 使用者核准 → 背景執行器逐步執行。
 * 守門、併發與計畫解析（含可寫資料庫代號解析、record_to_database）全集中在 services/agentCore
 * （tRPC 與 MCP 介面共用同一套，不分岔）；本檔只是薄殼路由。
 * 安全設計：規劃固定守門、核准前不扣執行費、核准畫面揭示每步估點、執行期各步走既有守門與退點。
 */
export const agentsRouter = router({
  /** 規劃：讀專案現況＋知識庫＋可寫資料庫，請 LLM 針對目標排一份多步計畫（只規劃不執行） */
  plan: authedProcedure
    .input(z.object({ projectId: z.string().uuid(), goal: z.string().min(5, "目標至少 5 個字").max(1000) }))
    .mutation(({ ctx, input }) => planAgentCore({ auth: ctx.auth, projectId: input.projectId, goal: input.goal })),

  /** 核准計畫：這一刻起才開始花執行點數（背景執行器下一個 tick 接手） */
  approve: authedProcedure
    .input(z.object({ runId: z.string().uuid() }))
    .mutation(({ ctx, input }) => approveAgentCore({ auth: ctx.auth, runId: input.runId })),

  /** 放棄一份還沒核准的計畫 */
  discard: authedProcedure
    .input(z.object({ runId: z.string().uuid() }))
    .mutation(({ ctx, input }) => discardAgentCore({ auth: ctx.auth, runId: input.runId })),

  /** 停止後續步驟 */
  stop: authedProcedure
    .input(z.object({ runId: z.string().uuid() }))
    .mutation(({ ctx, input }) => stopAgentCore({ auth: ctx.auth, runId: input.runId })),

  /** 待核准＋執行中全列＋最近 5 筆終局 */
  listByProject: authedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(({ ctx, input }) => listAgentRunsForProject(ctx.auth, input.projectId)),
});
