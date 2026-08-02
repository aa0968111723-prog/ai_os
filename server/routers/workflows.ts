import { z } from "zod";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { MAX_GENERATE_CHARACTERS, MAX_GENERATE_PROPS, MAX_GENERATE_SCENE_PRESETS } from "../../shared/cardLimits";
import { router, authedProcedure, requireGroup } from "../trpc";
import { db, schema } from "../db";
import { getModel, getWorkflow } from "../../shared/models";
import { savePromptCore } from "./prompts";
import { createAiTraceSession, finalizeAiTraceSession, recordAiTraceEventSafely, sanitizeAiTracePayload, updateAiTraceSession } from "../services/aiTrace";
import { assertGenerationEntityIds } from "../services/generationCore";
import { analyzeContinuitySnapshot, buildContinuitySnapshot } from "../services/continuity";

/** 與 services/workflowRunner 的 RunStep 同形狀（jsonb 落庫的每步快照） */
interface RunStep {
  note: string;
  status: "pending" | "running" | "done" | "failed" | "stopped";
  generationId?: string;
  detail?: string;
}

/** 啟動核心的輸入：userId 一律為「登入者本人」；assertAccess 由呼叫端注入 requireGroup（多組隔離不可省略） */
export interface StartWorkflowCoreInput {
  userId: string;
  projectId: string;
  presetId: string;
  prompt: string;
  /** 沿用生成台勾選的角色定裝/場景設定/素材設定卡：落庫在 run 上，runner 每步視覺生成都注入同一套錨點（跨步一致） */
  characterIds?: string[];
  scenePresetIds?: string[];
  propIds?: string[];
  stepPromptOverrides?: Record<string, string>;
  traceSessionId?: string;
  assertAccess: (project: typeof schema.projects.$inferSelect) => void | Promise<void>;
}

type WorkflowContinuitySelection = Pick<StartWorkflowCoreInput, "characterIds" | "scenePresetIds" | "propIds">;

async function prepareWorkflowContinuity(projectId: string, selection: WorkflowContinuitySelection) {
  await assertGenerationEntityIds(projectId, selection);
  const snapshot = await buildContinuitySnapshot(projectId, selection, true);
  return { snapshot, coverage: analyzeContinuitySnapshot(snapshot) };
}

/**
 * 啟動一條工作流（自 start mutation 原樣抽出，行為不變）：
 * presetId 白名單 → 專案存在＋組隔離 → 同人同專案單併發守門 → 建 run（實際送出由 runner 下一個 tick 接手）。
 * 為什麼抽函式：AI 專案助手（assistant.runAction）要以登入者本人身分重用同一套守門——
 * 邏輯若複製兩份，白名單／併發守門遲早分岔。
 */
export async function startWorkflowCore(input: StartWorkflowCoreInput) {
  const preset = getWorkflow(input.presetId);
  if (!preset) throw new TRPCError({ code: "BAD_REQUEST", message: "未知的工作流（請重新整理頁面後再選一次）" });
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, input.projectId));
  if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "找不到專案" });
  await input.assertAccess(project); // 多組隔離（可含 2.3 專案級 ACL）
  const { snapshot: continuitySnapshot } = await prepareWorkflowContinuity(project.id, input);
  // 併發守門：同人同專案一次只跑一條。以 advisory xact lock（classifier 3，與 points=0/approvals=1/
  // 拆分鏡=2 不撞）序列化「檢查有無在跑＋建 run」，徹底關掉 check-then-insert 的競態窗口——避免並發
  // 雙擊建出兩條 run、雙重扣點（原本只靠 runner 端冪等兜底，這裡從源頭擋掉）。
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${project.id + ":" + input.userId}), 3)`);
    const [active] = await tx
      .select({ id: schema.workflowRuns.id })
      .from(schema.workflowRuns)
      .where(
        and(
          eq(schema.workflowRuns.projectId, project.id),
          eq(schema.workflowRuns.userId, input.userId),
          eq(schema.workflowRuns.status, "running"),
        ),
      )
      .limit(1);
    if (active) throw new TRPCError({ code: "BAD_REQUEST", message: "你已有一條工作流在跑——等它完成或先按停止" });
    const steps: RunStep[] = preset.steps.map((s) => ({ note: s.note, status: "pending" }));
    const [run] = await tx
      .insert(schema.workflowRuns)
      .values({
        projectId: project.id,
        groupId: project.groupId,
        userId: input.userId,
        presetId: preset.id,
        prompt: input.prompt.trim(),
        characterIds: input.characterIds?.length ? input.characterIds : null,
        scenePresetIds: input.scenePresetIds?.length ? input.scenePresetIds : null,
        propIds: input.propIds?.length ? input.propIds : null,
        continuitySnapshot,
        stepPromptOverrides: input.stepPromptOverrides ?? null,
        traceSessionId: input.traceSessionId ?? null,
        steps,
      })
      .returning();
    return run;
  }).then(async (run) => {
    // 三合一：工作流的「想法」也入提示詞庫（與生成台自動存同一套去重），連同這條 run 實際帶的
    // 角色/場景錨點（modelId 不帶——工作流是多模型串鏈，沒有單一模型可記）——失敗不擋啟動主流程
    await savePromptCore({ id: run.projectId, groupId: run.groupId }, input.userId, run.prompt, {
      characterIds: input.characterIds,
      scenePresetIds: input.scenePresetIds,
      propIds: input.propIds,
    }).catch((err) =>
      console.warn("[workflow] 想法入提示詞庫失敗（不影響執行）：", err instanceof Error ? err.message : err),
    );
    return run;
  });
}

/** 工作流執行（伺服器背景推進版）：start 只建 run，實際送出由 workflowRunner 的下一個 tick 接手 */
export const workflowsRouter = router({
  preview: authedProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      presetId: z.string(),
      prompt: z.string().trim().min(1).max(2000),
      characterIds: z.array(z.string().uuid()).max(MAX_GENERATE_CHARACTERS).optional(),
      scenePresetIds: z.array(z.string().uuid()).max(MAX_GENERATE_SCENE_PRESETS).optional(),
      propIds: z.array(z.string().uuid()).max(MAX_GENERATE_PROPS).optional(),
      stepPromptOverrides: z.record(z.string().regex(/^\d+$/), z.string().max(8000)).refine((v) => Object.keys(v).length <= 20).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const preset = getWorkflow(input.presetId);
      if (!preset) throw new TRPCError({ code: "BAD_REQUEST", message: "未知的工作流" });
      const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, input.projectId));
      if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "找不到專案" });
      requireGroup(ctx.auth, project.groupId);
      const { assertProjectEditable } = await import("../services/projectAcl");
      await assertProjectEditable(ctx.auth, project);
      const { snapshot: continuitySnapshot, coverage: continuityCoverage } = await prepareWorkflowContinuity(project.id, input);
      const steps = preset.steps.map((step, index) => {
        const template = input.stepPromptOverrides?.[String(index)] ?? step.promptTemplate;
        const knownPrompt = template.replaceAll("{prompt}", input.prompt);
        return {
          index,
          note: step.note,
          modelId: step.modelId,
          model: getModel(step.modelId)?.label ?? step.modelId,
          promptTemplate: template,
          previewPrompt: knownPrompt,
          dynamic: knownPrompt.includes("{prev}"),
          usePrevAsSource: !!step.usePrevAsSource,
        };
      });
      const warnings: Array<{ code: string; severity: "info" | "warning"; title: string; detail: string; suggestion?: string }> = steps.filter((step) => step.dynamic).map((step) => ({
        code: `workflow_dynamic_${step.index}`,
        severity: "info" as const,
        title: `步驟 ${step.index + 1} 需等前一步完成`,
        detail: "{prev} 會在執行時替換成上一個實際文字或媒體結果；送出前無法偽造確定值。",
      }));
      if (continuityCoverage.totalCards > 0 && continuityCoverage.coveragePercent < 100) warnings.push({
        code: "workflow_continuity_partial_references",
        severity: "warning",
        title: `多鏡參考圖覆蓋 ${continuityCoverage.coveragePercent}%`,
        detail: `已選 ${continuityCoverage.totalCards} 張設定卡，缺少參考圖：${continuityCoverage.missingReferences.map((row) => row.name).join("、")}。`,
        suggestion: "為主要角色、常用場景與關鍵道具各綁定一張清楚參考圖，再開始多鏡工作流。",
      });
      if (continuityCoverage.duplicateNames.length > 0) warnings.push({
        code: "workflow_continuity_ambiguous_names",
        severity: "warning",
        title: "設定卡名稱有歧義",
        detail: `同一次工作流有重名設定：${continuityCoverage.duplicateNames.map((row) => row.name).join("、")}。`,
        suggestion: "替角色、場景與素材使用可區分的名稱，避免提示詞指向錯誤。",
      });
      const continuitySummary = continuitySnapshot ? {
        fingerprint: continuitySnapshot.fingerprint,
        locked: continuitySnapshot.locked,
        characters: continuitySnapshot.characters.length,
        scenes: continuitySnapshot.scenes.length,
        props: continuitySnapshot.props.length,
        referenceCoverage: continuityCoverage,
      } : null;
      const safe = sanitizeAiTracePayload({ presetId: preset.id, prompt: input.prompt, steps, continuity: continuitySummary });
      return {
        mode: "workflow" as const,
        title: `範本「${preset.label}」，AI 會怎麼理解`,
        dynamicNotice: steps.some((step) => step.dynamic) ? "後續步驟包含執行期資料，完成後才顯示實際值。" : undefined,
        context: [
          { type: "character", label: `角色定裝 ${input.characterIds?.length ?? 0}`, included: !!input.characterIds?.length },
          { type: "scene", label: `場景設定 ${input.scenePresetIds?.length ?? 0}`, included: !!input.scenePresetIds?.length },
          { type: "prop", label: `素材設定 ${input.propIds?.length ?? 0}`, included: !!input.propIds?.length },
          {
            type: "continuity",
            label: continuitySnapshot?.locked ? "整條工作流的一致性版本已鎖定" : "未選設定卡，沒有一致性快照",
            included: !!continuitySnapshot?.locked,
            note: continuitySnapshot ? `版本 ${continuitySnapshot.fingerprint.slice(0, 8)}・參考圖 ${continuityCoverage.cardsWithReference}/${continuityCoverage.totalCards}` : undefined,
          },
        ],
        request: safe.payload,
        warnings,
        estimatedPoints: preset.points,
        canOverrideCreativePrompt: true,
      };
    }),

  start: authedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        presetId: z.string(),
        // 先 trim 再驗非空／上限：擋純空白；max 與 assistant run_workflow 同口徑（2000）
        prompt: z.string().trim().min(1, "請填想法").max(2000, "想法過長（上限 2000 字）"),
        /** 生成台勾選的角色/場景/素材卡：整條工作流的視覺步驟都注入同一套錨點（上限與 generation.submit 同口徑） */
        characterIds: z.array(z.string().uuid()).max(MAX_GENERATE_CHARACTERS).optional(),
        scenePresetIds: z.array(z.string().uuid()).max(MAX_GENERATE_SCENE_PRESETS).optional(),
        propIds: z.array(z.string().uuid()).max(MAX_GENERATE_PROPS).optional(),
        stepPromptOverrides: z.record(z.string().regex(/^\d+$/), z.string().max(8000)).refine((v) => Object.keys(v).length <= 20).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const preset = getWorkflow(input.presetId);
      if (!preset) throw new TRPCError({ code: "BAD_REQUEST", message: "未知的工作流" });
      const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, input.projectId));
      if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "找不到專案" });
      requireGroup(ctx.auth, project.groupId);
      const { assertProjectEditable } = await import("../services/projectAcl");
      await assertProjectEditable(ctx.auth, project);
      const trace = await createAiTraceSession({
        groupId: project.groupId,
        projectId: project.id,
        userId: ctx.auth.user.id,
        mode: "workflow",
        title: `範本：${preset.label}`,
      });
      await recordAiTraceEventSafely({
        sessionId: trace.id,
        eventType: "prepared",
        summary: "已保存工作流模板與本次覆寫",
        payload: { presetId: preset.id, prompt: input.prompt, stepPromptOverrides: input.stepPromptOverrides, steps: preset.steps },
      });
      try {
      const run = await startWorkflowCore({
        userId: ctx.auth.user.id,
        projectId: input.projectId,
        presetId: input.presetId,
        prompt: input.prompt,
        characterIds: input.characterIds,
        scenePresetIds: input.scenePresetIds,
        propIds: input.propIds,
        stepPromptOverrides: input.stepPromptOverrides,
        traceSessionId: trace.id,
        assertAccess: async (p) => {
          requireGroup(ctx.auth, p.groupId);
          // 2.3：專案檢視者不能啟動工作流（一次多步生成＝內容寫入）
          const { assertProjectEditable } = await import("../services/projectAcl");
          await assertProjectEditable(ctx.auth, p);
        },
      });
      if (run.continuitySnapshot) {
        const coverage = analyzeContinuitySnapshot(run.continuitySnapshot);
        await recordAiTraceEventSafely({
          sessionId: trace.id,
          eventType: "prepared",
          summary: "已鎖定整條工作流的一致性版本",
          payload: {
            fingerprint: run.continuitySnapshot.fingerprint,
            characters: run.continuitySnapshot.characters.length,
            scenes: run.continuitySnapshot.scenes.length,
            props: run.continuitySnapshot.props.length,
            referenceCoverage: coverage,
          },
        });
      }
      await updateAiTraceSession(trace.id, { status: "running", sourceType: "workflow", sourceId: run.id, summary: "工作流執行中" }).catch(() => undefined);
      return { ...run, traceSessionId: trace.id };
      } catch (error) {
        const summary = error instanceof Error ? error.message : "啟動失敗";
        await finalizeAiTraceSession({
          sessionId: trace.id,
          status: "failed",
          summary,
          payload: { stage: "start", error: summary },
        }).catch(() => undefined);
        throw error;
      }
    }),

  /** 全部 running ＋ 最近 5 筆終局（各自新到舊）：running 永遠可見可停，不會被新的終局擠出清單 */
  listByProject: authedProcedure.input(z.object({ projectId: z.string().uuid() })).query(async ({ ctx, input }) => {
    const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, input.projectId));
    if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "找不到專案" });
    requireGroup(ctx.auth, project.groupId);
    const running = await db
      .select()
      .from(schema.workflowRuns)
      .where(and(eq(schema.workflowRuns.projectId, input.projectId), eq(schema.workflowRuns.status, "running")))
      .orderBy(desc(schema.workflowRuns.createdAt));
    const finished = await db
      .select()
      .from(schema.workflowRuns)
      .where(and(eq(schema.workflowRuns.projectId, input.projectId), ne(schema.workflowRuns.status, "running")))
      .orderBy(desc(schema.workflowRuns.createdAt))
      .limit(5);
    return [...running, ...finished];
  }),

  /** 停止後續步驟：正在生成的那一步讓它自然完成（runner 會收尾），未送出的標 stopped 不扣點 */
  stop: authedProcedure.input(z.object({ runId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const [run] = await db.select().from(schema.workflowRuns).where(eq(schema.workflowRuns.id, input.runId));
    if (!run) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這筆工作流執行" });
    const role = requireGroup(ctx.auth, run.groupId);
    if (run.userId !== ctx.auth.user.id && role === "member") {
      throw new TRPCError({ code: "FORBIDDEN", message: "只有發起人或組長以上可以停止" });
    }
    if (run.status !== "running") {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "這個工作流已經結束，不需要停止" });
    }
    // 這裡只改 run 狀態，不動 steps：pending→stopped 的標記全交給 runner（steps 單一寫者），
    // 雙邊都寫會跟推進中的寫回互相蓋掉
    // Compare-and-set：runner 可能同時把 run 推進成 done/failed——只有仍在 running 的才停，
    // 搶輸就回現況（已到終局，沒東西可停）
    const updated = await db
      .update(schema.workflowRuns)
      .set({ status: "stopped", updatedAt: new Date() })
      .where(and(eq(schema.workflowRuns.id, run.id), eq(schema.workflowRuns.status, "running")))
      .returning();
    if (updated.length === 0) {
      const [current] = await db.select().from(schema.workflowRuns).where(eq(schema.workflowRuns.id, run.id));
      return current;
    }
    if (run.traceSessionId) {
      await finalizeAiTraceSession({
        sessionId: run.traceSessionId,
        status: "stopped",
        summary: "工作流已由使用者停止",
        payload: { runId: run.id, status: "stopped" },
      }).catch(() => undefined);
    }
    return updated[0];
  }),
});
