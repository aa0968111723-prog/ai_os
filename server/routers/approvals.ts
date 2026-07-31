import { z } from "zod";
import { and, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure, requireGroup, requireLeader } from "../trpc";
import { db, schema } from "../db";
import { assertProjectEditable } from "../services/projectAcl";
import { canAccessGroup, groupLeaderIds, pushToUsers } from "../services/webPush";

async function getScene(sceneId: string) {
  const [scene] = await db
    .select()
    .from(schema.scenes)
    .where(and(eq(schema.scenes.id, sceneId), isNull(schema.scenes.deletedAt)));
  if (!scene) throw new TRPCError({ code: "NOT_FOUND", message: "找不到分鏡（可能已刪除）" });
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, scene.projectId));
  if (!project) throw new TRPCError({ code: "NOT_FOUND" });
  return { scene, project };
}

/** PLACEHOLDER_RESTORE_NEEDED - use full file from default branch */
export async function submitApprovalCore(
  sceneId: string,
  userId: string,
  assertAccess: (project: { id: string; groupId: string }) => void | Promise<void>,
  idempotencyApprovalId?: string,
) {
  void sceneId; void userId; void assertAccess; void idempotencyApprovalId;
  throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "approvals core not restored" });
}

export const approvalsRouter = router({
  submit: authedProcedure
    .input(z.object({ sceneId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return submitApprovalCore(input.sceneId, ctx.auth.user.id, async (project) => {
        requireGroup(ctx.auth, project.groupId);
        await assertProjectEditable(ctx.auth, project);
      });
    }),
});
