import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
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

/**
 * 送審核心（供 approvals.submit 與 AI 專案助手共用，行為單一來源，避免分岔）：
 * 作廢同分鏡舊 pending → 原子版本號 → 標分鏡 pending → 系統訊息。
 * assertAccess 由呼叫端帶入組隔離檢查（tRPC 端＝requireGroup）。
 */
export async function submitApprovalCore(
  sceneId: string,
  userId: string,
  assertAccess: (groupId: string) => void,
) {
  const { scene, project } = await getScene(sceneId);
  assertAccess(project.groupId);
  // 為什麼：同一分鏡任一時刻最多一筆 pending——送新版時舊 pending 一律作廢，
  // 避免懸置的舊版事後被裁決、覆寫最新版的分鏡狀態（status 沿用既有 enum，不動 schema）
  await db
    .update(schema.approvals)
    .set({ status: "needs_work", reason: "已被較新版本取代", decidedAt: new Date() })
    .where(and(eq(schema.approvals.sceneId, scene.id), eq(schema.approvals.status, "pending")));
  // 為什麼：版本號用單一 insert…select 原子產生（max+1 與寫入在同一條 SQL 的同一快照內），
  // 消除「先讀 max 再 insert」的競態窗口；依決策不加唯一索引、不動 schema
  const inserted = (await db.execute(sql`
    insert into approvals (project_id, scene_id, version, submitted_by)
    select ${project.id}::uuid, ${scene.id}::uuid, coalesce(max(version), 0) + 1, ${userId}::uuid
    from approvals
    where scene_id = ${scene.id}::uuid
    returning id
  `)) as unknown as { rows: Array<{ id: string }> };
  const insertedId = inserted.rows[0]?.id;
  // 為什麼：raw execute 回傳 snake_case 列，改用型別安全的重讀取得 camelCase 完整列給前端
  const [approval] = insertedId
    ? await db.select().from(schema.approvals).where(eq(schema.approvals.id, insertedId))
    : [];
  if (!approval) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "送審寫入失敗，請重試" });
  await db.update(schema.scenes).set({ status: "pending" }).where(eq(schema.scenes.id, scene.id));
  await db.insert(schema.messages).values({
    groupId: project.groupId,
    projectId: project.id,
    userId,
    kind: "system",
    body: `📋 「${scene.title}」已送審（v${approval.version}）`,
  });
  return approval;
}

/** 審批三態機（Frame.io 模式，盲點掃描定案）：pending → approved / needs_work，跟著版本走 */
export const approvalsRouter = router({
  /** 組員送審（同一分鏡重送＝新版本） */
  submit: authedProcedure.input(z.object({ sceneId: z.string().uuid() })).mutation(({ ctx, input }) =>
    submitApprovalCore(input.sceneId, ctx.auth.user.id, (groupId) => requireGroup(ctx.auth, groupId)),
  ),

  /** 組長裁決：通過 / 需修改（退回必附理由 → 自動變組內訊息） */
  decide: authedProcedure
    .input(z.object({ approvalId: z.string().uuid(), decision: z.enum(["approved", "needs_work"]), reason: z.string().max(500).optional() }))
    .mutation(async ({ ctx, input }) => {
      const [approval] = await db.select().from(schema.approvals).where(eq(schema.approvals.id, input.approvalId));
      if (!approval || !approval.sceneId) throw new TRPCError({ code: "NOT_FOUND" });
      if (approval.status !== "pending") throw new TRPCError({ code: "BAD_REQUEST", message: "此版本已裁決過" });
      const { scene, project } = await getScene(approval.sceneId);
      requireLeader(ctx.auth, project.groupId); // 只有組長以上能裁決
      // 為什麼：只允許裁決該分鏡的最新版本——防 DB 既存的多筆 pending 舊資料被裁決後覆寫最新狀態
      const [latest] = await db
        .select()
        .from(schema.approvals)
        .where(eq(schema.approvals.sceneId, approval.sceneId))
        .orderBy(desc(schema.approvals.version))
        .limit(1);
      if (latest && latest.version > approval.version) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "已有較新版本送審，請裁決最新版" });
      }
      if (input.decision === "needs_work" && !input.reason?.trim()) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "退回必須附一句理由（會通知提交人）" });
      }
      const [updated] = await db
        .update(schema.approvals)
        .set({ status: input.decision, decidedBy: ctx.auth.user.id, reason: input.reason?.trim(), decidedAt: new Date() })
        .where(eq(schema.approvals.id, approval.id))
        .returning();
      // 為什麼：裁決生效時把同分鏡其他仍懸置的 pending（守衛保證都是舊版）一併標過期，
      // 避免它們日後被誤裁決、把分鏡狀態改回過期結果（剛裁決那筆已非 pending，不會被誤觸）
      await db
        .update(schema.approvals)
        .set({ status: "needs_work", reason: "已被較新版本裁決取代", decidedBy: ctx.auth.user.id, decidedAt: new Date() })
        .where(and(eq(schema.approvals.sceneId, approval.sceneId), eq(schema.approvals.status, "pending")));
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
