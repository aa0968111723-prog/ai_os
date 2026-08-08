import { z } from "zod";
import { authedProcedure, router } from "../trpc";
import {
  addProjectTaskCore,
  completeProjectTaskCore,
  decideProjectApprovalCore,
  listProjectTasks,
} from "../services/taskCore";

/** 正式人類任務傳輸層；建立來源先由 Agent Runner 負責，完成／核准走共用 core 喚醒計畫。 */
export const tasksRouter = router({
  listByProject: authedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(({ ctx, input }) => listProjectTasks(ctx.auth, input.projectId)),

  /**
   * 建立正式任務（留言轉任務走這裡：sourceMessageId 記 provenance）。
   * 核心邏輯在 taskCore.addProjectTaskCore（AI 代理建任務走同一支）——
   * 人建的與 AI 建的任務永遠是同一張表、同一套規則。
   */
  create: authedProcedure
    .input(z.object({
      groupId: z.string().uuid(),
      projectId: z.string().uuid(),
      title: z.string().min(1).max(160),
      description: z.string().max(4_000).optional(),
      assigneeId: z.string().uuid().optional(),
      dueAt: z.string().datetime().optional(),
      sourceMessageId: z.string().uuid().optional(),
    }))
    .mutation(({ ctx, input }) => addProjectTaskCore({
      auth: ctx.auth,
      groupId: input.groupId,
      projectId: input.projectId,
      title: input.title,
      description: input.description ?? null,
      assigneeId: input.assigneeId ?? null,
      dueAt: input.dueAt ?? null,
      sourceMessageId: input.sourceMessageId ?? null,
    })),

  complete: authedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) => completeProjectTaskCore(ctx.auth, input.id)),

  decideApproval: authedProcedure
    .input(z.object({
      id: z.string().uuid(),
      decision: z.enum(["approve", "reject"]),
    }))
    .mutation(({ ctx, input }) => decideProjectApprovalCore(
      ctx.auth,
      input.id,
      input.decision,
    )),
});
