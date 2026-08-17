import { z } from "zod";
import { and, desc, eq, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure, requireGroup } from "../trpc";
import { db, schema } from "../db";
import { lockExportDedup } from "../services/locks";
import { projectDeliveryRights } from "../services/commercialRights";

/**
 * 交付包匯出 job（QA-005）：建 job → exportRunner 背景打包 → 前端輪詢進度 → 完成後走
 * GET /api/export/jobs/:id/download 下載（REST，見 server/index.ts）。
 * 冪等/防重複：同專案＋同素材選擇已有 queued/running job 時，create 直接回既有 job，
 * 不重複排隊——長打包期間重複點擊不再做出第二份相同交付包。
 */

/** 素材多選的正規化鍵（排序去重後串接）：null/空＝全量打包 */
function assetKey(assetIds: string[] | null | undefined): string {
  if (!assetIds || assetIds.length === 0) return "";
  return [...new Set(assetIds)].sort().join(",");
}

async function getJobChecked(auth: Parameters<typeof requireGroup>[0], id: string) {
  const [job] = await db.select().from(schema.exportJobs).where(eq(schema.exportJobs.id, id));
  if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這個匯出工作" });
  requireGroup(auth, job.groupId);
  return job;
}

export const exportJobsRouter = router({
  /** 建立匯出 job：同專案同選擇已有進行中 job 就回它（reused=true），否則排一筆新的 */
  create: authedProcedure
    .input(z.object({ projectId: z.string().uuid(), assetIds: z.array(z.string().uuid()).max(500).optional() }))
    .mutation(async ({ ctx, input }) => {
      const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, input.projectId));
      if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "找不到專案" });
      requireGroup(ctx.auth, project.groupId);

      const rights = await projectDeliveryRights({
        auth: ctx.auth,
        projectId: project.id,
        usageContext: "client_delivery",
        assetIds: input.assetIds,
      });
      if (rights.blocked) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `商用權利尚未就緒：${[...rights.blockers, ...rights.warnings].join("；")}`,
        });
      }

      const key = assetKey(input.assetIds);
      // 防重複（QA-005 ＋ export-job-dedup-not-atomic）：整個「查進行中→無則建」放進交易並取 per-(project,assetKey)
      // advisory lock——舊版讀後寫非原子，雙擊/併發下兩者都讀到「無進行中」而各插一筆，產出兩份相同交付包。
      return db.transaction(async (tx) => {
        await lockExportDedup(tx, project.id, key);
        const pending = await tx
          .select()
          .from(schema.exportJobs)
          .where(and(eq(schema.exportJobs.projectId, project.id), inArray(schema.exportJobs.status, ["queued", "running"])))
          .orderBy(desc(schema.exportJobs.createdAt));
        const existing = pending.find((j) => assetKey(j.assetIds as string[] | null) === key);
        if (existing) return { job: existing, reused: true };

        const [job] = await tx
          .insert(schema.exportJobs)
          .values({
            projectId: project.id,
            groupId: project.groupId,
            userId: ctx.auth.user.id,
            assetIds: input.assetIds && input.assetIds.length > 0 ? input.assetIds : null,
          })
          .returning();
        return { job, reused: false };
      });
    }),

  /** 進度輪詢：回 job 現況（完成後前端組下載連結 /api/export/jobs/:id/download） */
  get: authedProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ ctx, input }) => {
    return getJobChecked(ctx.auth, input.id);
  }),

  /** 取消：queued 直接取消；running 標記後由 worker 在下次進度回報時中止 */
  cancel: authedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const job = await getJobChecked(ctx.auth, input.id);
    const role = requireGroup(ctx.auth, job.groupId);
    if (job.userId !== ctx.auth.user.id && role === "member") {
      throw new TRPCError({ code: "FORBIDDEN", message: "只有發起者本人或組長以上可以取消匯出" });
    }
    const [updated] = await db
      .update(schema.exportJobs)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(and(eq(schema.exportJobs.id, job.id), inArray(schema.exportJobs.status, ["queued", "running"])))
      .returning();
    return updated ?? job; // 已終局（done/failed）就回現況，不覆蓋
  }),
});
