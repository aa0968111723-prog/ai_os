import { z } from "zod";
import { router, authedProcedure } from "../trpc";
import {
  planAgentCore,
  approveAgentCore,
  discardAgentCore,
  stopAgentCore,
  listAgentRunsForProject,
} from "../services/agentCore";
import {
  getProjectAgentInsights,
  listProjectAgentEvents,
} from "../services/agentEventCore";
import { agentPlannerModeSchema } from "../../shared/agentPlanner";
import { listAiProjectRoles } from "../../shared/aiProjectRoles";
import { listPlaybooks } from "../../shared/rolePlaybooks";

/**
 * AI 代理（代理系統核心）：一句目標 → LLM 規劃多步計畫（估點）→ 使用者核准 → 背景執行器逐步執行。
 * 守門、併發與計畫解析（含可寫資料庫代號解析、record_to_database）全集中在 services/agentCore
 * （tRPC 與 MCP 介面共用同一套，不分岔）；本檔只是薄殼路由。
 * 安全設計：規劃固定守門、核准前不扣執行費、核准畫面揭示每步估點、執行期各步走既有守門與退點。
 */
export const agentsRouter = router({
  /**
   * 唯讀：AI 職能目錄＋playbook 摘要（L0/L1 產品敘事用；非真人成員、不建假帳號）。
   * 前端亦可直接 import shared；此 query 供需要經 tRPC 的入口使用。
   */
  listRoles: authedProcedure.query(() => ({
    roles: listAiProjectRoles().map((r) => ({
      id: r.id,
      title: r.title,
      summary: r.summary,
      primary: r.primary,
      kindHints: r.kindHints,
      humanKeeps: r.humanKeeps,
      defaultGoalHint: r.defaultGoalHint,
    })),
    playbooks: listPlaybooks().map((p) => ({
      id: p.id,
      roleId: p.roleId,
      version: p.version,
      title: p.title,
      goalTemplate: p.goalTemplate,
      suggestedKinds: p.suggestedKinds,
    })),
  })),

  /** 規劃：讀專案現況＋知識庫＋可寫資料庫，請 LLM 針對目標排一份多步計畫（只規劃不執行） */
  plan: authedProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      goal: z.string().min(5, "目標至少 5 個字").max(1000),
      plannerMode: agentPlannerModeSchema.optional(),
      // PR-E2：使用者明確選中要注入本次規劃的站內來源（知識／資料庫文件 id）——優先於一般知識節錄
      extraSourceIds: z.array(z.string().uuid()).max(10).optional(),
      // PR-E3：使用者搜尋雲端後「勾選」僅本次納入的 Google 檔案 id（不落庫；每檔 8k 字硬頂）
      driveFileIds: z.array(z.string().regex(/^[\w-]{5,200}$/, "Google 檔案 id 格式不正確")).max(5).optional(),
    }))
    .mutation(({ ctx, input }) => planAgentCore({
      auth: ctx.auth,
      projectId: input.projectId,
      goal: input.goal,
      plannerMode: input.plannerMode,
      extraSourceIds: input.extraSourceIds,
      driveFileIds: input.driveFileIds,
    })),

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

  eventsByProject: authedProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      cursor: z.string().max(200).optional(),
      limit: z.number().int().min(1).max(500).optional(),
    }))
    .query(({ ctx, input }) => listProjectAgentEvents(ctx.auth, input.projectId, {
      cursor: input.cursor,
      limit: input.limit,
    })),

  insights: authedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(({ ctx, input }) => getProjectAgentInsights(ctx.auth, input.projectId)),
});
