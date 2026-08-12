import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { router, authedProcedure, requireGroup } from "../trpc";
import { db, schema } from "../db";
import {
  planAgentCore,
  approveAgentCore,
  discardAgentCore,
  stopAgentCore,
  pauseAgentCore,
  resumePausedAgentCore,
  resumeFailedAgentCore,
  listAgentRunsForProject,
} from "../services/agentCore";
import {
  getProjectAgentInsights,
  listProjectAgentEvents,
} from "../services/agentEventCore";
import { agentPlannerModeSchema } from "../../shared/agentPlanner";
import { listAiProjectRoles } from "../../shared/aiProjectRoles";
import { listPlaybooks } from "../../shared/rolePlaybooks";
import { assertProjectEditable } from "../services/projectAcl";
import { createAiTraceSession, sanitizeAiTracePayload } from "../services/aiTrace";
import {
  answerAgentQuestion,
  listPendingAgentQuestionsForProject,
} from "../services/agentQuestionCore";
import { listProjectFiles, readProjectFile, searchProjectFiles } from "../services/agentProjectFiles";
import { buildProjectIntelligence } from "../services/projectIntelligence";
import { AGENT_SKILLS, validateSkillContracts } from "../services/practicalAutonomy";
import { agentToolRegistry } from "../services/agentToolRegistry";
import { buildCapabilityContractReport, executeCapabilityCertification, getCapabilityHealthView } from "../services/agentCapabilityCertification";
import { runAgentDbIntegrityScan } from "../services/agentDbIntegrity";

const agentQuestionAnswerSchema = z.union([
  z.string().max(20_000),
  z.number().finite(),
  z.boolean(),
  z.array(z.string().max(500)).max(100),
]);

/**
 * AI 代理（代理系統核心）：一句目標 → LLM 規劃多步計畫（估點）→ 使用者核准 → 背景執行器逐步執行。
 * 守門、併發與計畫解析（含可寫資料庫代號解析、record_to_database）全集中在 services/agentCore
 * （tRPC 與 MCP 介面共用同一套，不分岔）；本檔只是薄殼路由。
 * 安全設計：規劃固定守門、核准前不扣執行費、核准畫面揭示每步估點、執行期各步走既有守門與退點。
 */
export const agentsRouter = router({
  practicalCapabilities: authedProcedure.query(async () => {
    const health = await getCapabilityHealthView();
    const plannerEligible = new Set(health.tools.filter((tool) => tool.plannerEligible).map((tool) => tool.capabilityId));
    return {
      tools: agentToolRegistry.capabilities().filter((tool) => plannerEligible.has(tool.id)),
      skills: AGENT_SKILLS.filter((skill) =>
        validateSkillContracts(agentToolRegistry, [skill]).length === 0
        && skill.requiredCapabilities.every((id) => plannerEligible.has(id)))
        .map(({ inputs: _inputs, ...skill }) => skill),
      // Diagnostics/UI can still explain declared-but-blocked capabilities;
      // only `tools` is planner executable truth.
      declaredTools: agentToolRegistry.capabilities(),
      contract: buildCapabilityContractReport(),
      certificationSummary: health.summary,
    };
  }),

  practicalCapabilityHealth: authedProcedure.query(() => getCapabilityHealthView()),

  practicalDbIntegrity: authedProcedure.query(({ ctx }) => {
    if (!ctx.auth.user.isSuperAdmin) throw new TRPCError({ code: "FORBIDDEN", message: "Database integrity evidence requires a QA administrator" });
    return runAgentDbIntegrityScan();
  }),

  certifyPracticalCapability: authedProcedure.input(z.object({
    capabilityId: z.string().min(1).max(120),
    projectId: z.string().uuid(),
    toolInput: z.unknown(),
    mode: z.enum(["contract", "mock", "staging", "external_live", "production_smoke"]),
    resolutionObserved: z.boolean().default(false),
    usefulObserved: z.boolean().default(false),
    trustOrigin: z.enum(["SYSTEM", "USER_EXPLICIT", "VERIFIED_INTERNAL", "EXTERNAL_UNTRUSTED", "GENERATED_UNTRUSTED"]).optional(),
    evidence: z.array(z.object({ type: z.string().min(1).max(80), ref: z.string().min(1).max(500) })).max(30).optional(),
  })).mutation(({ ctx, input }) => executeCapabilityCertification({ auth: ctx.auth, ...input })),

  listProjectFiles: authedProcedure.input(z.object({ projectId: z.string().uuid() })).query(({ ctx, input }) => listProjectFiles(ctx.auth, input.projectId)),
  readProjectFile: authedProcedure.input(z.object({ projectId: z.string().uuid(), fileId: z.string().uuid(), offset: z.number().int().min(0).optional(), limit: z.number().int().min(1).max(24_000).optional() })).query(({ ctx, input }) => readProjectFile(ctx.auth, input.projectId, input.fileId, input.offset, input.limit)),
  searchProjectFiles: authedProcedure.input(z.object({ projectId: z.string().uuid(), query: z.string().min(1).max(200), limit: z.number().int().min(1).max(30).optional() })).query(({ ctx, input }) => searchProjectFiles(ctx.auth, input.projectId, input.query, input.limit)),
  // 對應 project.health tool 的獨立 procedure：assistant.ts / teamAssistant.ts 內部
  // 只能間接呼叫 buildProjectIntelligence，MCP／外部 harness 打不到；補一支與
  // listProjectFiles 同等守門（專案存在 + requireGroup）的直接呼叫入口。
  projectHealth: authedProcedure.input(z.object({ projectId: z.string().uuid() })).query(async ({ ctx, input }) => {
    const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, input.projectId));
    if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "找不到專案" });
    requireGroup(ctx.auth, project.groupId);
    return buildProjectIntelligence(input.projectId);
  }),
  preview: authedProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      goal: z.string().min(5).max(1000),
      plannerMode: agentPlannerModeSchema.optional(),
      extraSourceIds: z.array(z.string().uuid()).max(10).optional(),
      driveFileIds: z.array(z.string()).max(5).optional(),
      playbookId: z.string().max(80).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, input.projectId));
      if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "找不到專案" });
      requireGroup(ctx.auth, project.groupId);
      await assertProjectEditable(ctx.auth, project);
      const context = [
        { type: "project", label: "專案現況與世界觀", included: true },
        { type: "scene", label: "分鏡現況", included: true },
        { type: "team", label: "團隊成員與人類任務", included: true },
        { type: "knowledge", label: `指定站內來源 ${input.extraSourceIds?.length ?? 0}`, included: !!input.extraSourceIds?.length },
        { type: "drive", label: `僅本次雲端來源 ${input.driveFileIds?.length ?? 0}`, included: !!input.driveFileIds?.length, note: "內容在真正規劃時抓取並受預算截斷" },
        { type: "catalog", label: "可用模型、資料庫與工具白名單", included: true },
      ];
      const safe = sanitizeAiTracePayload({
        goal: input.goal,
        plannerMode: input.plannerMode ?? "auto",
        playbookId: input.playbookId,
        extraSourceIds: input.extraSourceIds,
        driveFileIds: input.driveFileIds,
        immutableRules: ["只輸出結構化計畫", "不得輸出 chain-of-thought", "只能引用伺服器提供的代號", "核准前不執行"],
      });
      return {
        mode: "agent_plan" as const,
        title: "多步計畫，AI 會怎麼理解",
        dynamicNotice: "完整 planner prompt、實際來源字數、模型草稿與驗證結果會在規劃完成後保存於實際運作軌跡。",
        provider: input.plannerMode === "nim" ? "nvidia-nim" : input.plannerMode?.startsWith("fal_") ? "fal-openrouter" : "NIM 優先／fal 備援",
        context,
        request: safe.payload,
        warnings: [],
        estimatedPoints: 0,
        canOverrideCreativePrompt: false,
      };
    }),

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
      // D5/M4：明確指定 playbook（與 MCP plan_agent 的 shortCreation 同一語意）
      playbookId: z.string().max(80).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, input.projectId));
      if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "找不到專案" });
      requireGroup(ctx.auth, project.groupId);
      await assertProjectEditable(ctx.auth, project);
      const trace = await createAiTraceSession({
        groupId: project.groupId,
        projectId: project.id,
        userId: ctx.auth.user.id,
        mode: "agent_plan",
        title: `多步計畫：${input.goal.trim().slice(0, 80)}`,
      });
      const run = await planAgentCore({
        auth: ctx.auth,
        projectId: input.projectId,
        goal: input.goal,
        plannerMode: input.plannerMode,
        extraSourceIds: input.extraSourceIds,
        driveFileIds: input.driveFileIds,
        playbookId: input.playbookId,
        traceSessionId: trace.id,
      });
      return { ...run, traceSessionId: trace.id };
    }),

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

  pause: authedProcedure.input(z.object({ runId: z.string().uuid() })).mutation(({ ctx, input }) => pauseAgentCore({ auth: ctx.auth, runId: input.runId })),
  resume: authedProcedure.input(z.object({ runId: z.string().uuid() })).mutation(({ ctx, input }) => resumePausedAgentCore({ auth: ctx.auth, runId: input.runId })),
  resumeFailed: authedProcedure.input(z.object({ runId: z.string().uuid() })).mutation(({ ctx, input }) => resumeFailedAgentCore({ auth: ctx.auth, runId: input.runId })),

  /** Validate a durable Human-in-the-loop answer and resume the same run. */
  answerAgentQuestion: authedProcedure
    .input(z.object({
      runId: z.string().uuid(),
      questionId: z.string().uuid(),
      answer: agentQuestionAnswerSchema,
      resumeToken: z.string().uuid().optional(),
    }))
    .mutation(({ ctx, input }) => answerAgentQuestion({ auth: ctx.auth, ...input })),

  pendingQuestions: authedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(({ ctx, input }) => listPendingAgentQuestionsForProject(ctx.auth, input.projectId)),

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
