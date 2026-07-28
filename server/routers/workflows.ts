import { z } from "zod";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure, requireGroup } from "../trpc";
import { db, schema } from "../db";
import { getWorkflow } from "../../shared/models";
import { savePromptCore } from "./prompts";

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
  /** 沿用生成台勾選的角色定裝/場景設定卡：落庫在 run 上，runner 每步視覺生成都注入同一套錨點（跨步一致） */
  characterIds?: string[];
  scenePresetIds?: string[];
  assertAccess: (project: typeof schema.projects.$inferSelect) => void | Promise<void>;
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
    }).catch((err) =>
      console.warn("[workflow] 想法入提示詞庫失敗（不影響執行）：", err instanceof Error ? err.message : err),
    );
    return run;
  });
}

/** 工作流執行（伺服器背景推進版）：start 只建 run，實際送出由 workflowRunner 的下一個 tick 接手 */
export const workflowsRouter = router({
  start: authedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        presetId: z.string(),
        // 先 trim 再驗非空／上限：擋純空白；max 與 assistant run_workflow 同口徑（2000）
        prompt: z.string().trim().min(1, "請填想法").max(2000, "想法過長（上限 2000 字）"),
        /** 生成台勾選的角色/場景卡：整條工作流的視覺步驟都注入同一套錨點（上限與 generation.submit 同口徑） */
        characterIds: z.array(z.string().uuid()).max(6).optional(),
        scenePresetIds: z.array(z.string().uuid()).max(4).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      startWorkflowCore({
        userId: ctx.auth.user.id,
        projectId: input.projectId,
        presetId: input.presetId,
        prompt: input.prompt,
        characterIds: input.characterIds,
        scenePresetIds: input.scenePresetIds,
        assertAccess: async (p) => {
          requireGroup(ctx.auth, p.groupId);
          // 2.3：專案檢視者不能啟動工作流（一次多步生成＝內容寫入）
          const { assertProjectEditable } = await import("../services/projectAcl");
          await assertProjectEditable(ctx.auth, p);
        },
      }),
    ),

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
    return updated[0];
  }),
});
