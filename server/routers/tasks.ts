import { z } from "zod";
import { authedProcedure, router } from "../trpc";
import {
  completeProjectTaskCore,
  decideProjectApprovalCore,
  listProjectTasks,
} from "../services/taskCore";

/** 正式人類任務傳輸層；建立來源先由 Agent Runner 負責，完成／核准走共用 core 喚醒計畫。 */
export const tasksRouter = router({
  listByProject: authedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(({ ctx, input }) => listProjectTasks(ctx.auth, input.projectId)),

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
