import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure, requireGroup, requireLeader } from "../trpc";
import { db, schema } from "../db";

async function getScene(sceneId: string) {
  const [scene] = await db.select().from(schema.scenes).where(eq(schema.scenes.id, sceneId));
  if (!scene) throw new TRPCError({ code: "NOT_FOUND", message: "找不到分鏡" });
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, scene.projectId));
  if (!project) throw new TRPCError({ code: "NOT_FOUND" });
  return { scene, project };
}

/** 審批三態機（Frame.io 模式，盲點掃描定案）：pending → approved / needs_work，跟著版本走 */
export const approvalsRouter = router({
  /** 組員送審（同一分鏡重送＝新版本） */
  submit: authedProcedure.input(z.object({ sceneId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const { scene, project } = await getScene(input.sceneId);
    requireGroup(ctx.auth, project.groupId);
    const prev = await db
      .select()
      .from(schema.approvals)
      .where(eq(schema.approvals.sceneId, scene.id))
      .orderBy(desc(schema.approvals.version))
      .limit(1);
    const version = (prev[0]?.version ?? 0) + 1;
    const [approval] = await db
      .insert(schema.approvals)
      .values({ projectId: project.id, sceneId: scene.id, version, submittedBy: ctx.auth.user.id })
      .returning();
    await db.update(schema.scenes).set({ status: "pending" }).where(eq(schema.scenes.id, scene.id));
    await db.insert(schema.messages).values({
      groupId: project.groupId,
      projectId: project.id,
      userId: ctx.auth.user.id,
      kind: "system",
      body: `📋 「${scene.title}」已送審（v${version}）`,
    });
    return approval;
  }),

  /** 組長裁決：通過 / 需修改（退回必附理由 → 自動變組內訊息） */
  decide: authedProcedure
    .input(z.object({ approvalId: z.string().uuid(), decision: z.enum(["approved", "needs_work"]), reason: z.string().max(500).optional() }))
    .mutation(async ({ ctx, input }) => {
      const [approval] = await db.select().from(schema.approvals).where(eq(schema.approvals.id, input.approvalId));
      if (!approval || !approval.sceneId) throw new TRPCError({ code: "NOT_FOUND" });
      if (approval.status !== "pending") throw new TRPCError({ code: "BAD_REQUEST", message: "此版本已裁決過" });
      const { scene, project } = await getScene(approval.sceneId);
      requireLeader(ctx.auth, project.groupId); // 只有組長以上能裁決
      if (input.decision === "needs_work" && !input.reason?.trim()) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "退回必須附一句理由（會通知提交人）" });
      }
      const [updated] = await db
        .update(schema.approvals)
        .set({ status: input.decision, decidedBy: ctx.auth.user.id, reason: input.reason?.trim(), decidedAt: new Date() })
        .where(eq(schema.approvals.id, approval.id))
        .returning();
      await db.update(schema.scenes).set({ status: input.decision === "approved" ? "approved" : "needs_work" }).where(eq(schema.scenes.id, scene.id));
      await db.insert(schema.messages).values({
        groupId: project.groupId,
        projectId: project.id,
        userId: ctx.auth.user.id,
        kind: "system",
        body: input.decision === "approved" ? `✅ 「${scene.title}」v${approval.version} 已通過` : `↩️ 「${scene.title}」v${approval.version} 需修改：${input.reason}`,
      });
      return updated;
    }),

  /** 專案內審批清單（分鏡卡顯示最新版狀態） */
  listByProject: authedProcedure.input(z.object({ projectId: z.string().uuid() })).query(async ({ ctx, input }) => {
    const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, input.projectId));
    if (!project) throw new TRPCError({ code: "NOT_FOUND" });
    requireGroup(ctx.auth, project.groupId);
    return db.select().from(schema.approvals).where(eq(schema.approvals.projectId, input.projectId)).orderBy(desc(schema.approvals.createdAt));
  }),
});
