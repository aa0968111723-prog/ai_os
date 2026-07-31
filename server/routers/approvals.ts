import { z } from "zod";
import { and, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure, requireGroup, requireLeader } from "../trpc";
import { db, schema } from "../db";
import { assertProjectEditable } from "../services/projectAcl";
import { canAccessGroup, groupLeaderIds, pushToUsers } from "../services/webPush";

async function getScene(sceneId: string) {
  // isNull(deletedAt)：軟刪除（回收桶）的分鏡不得被送審／裁決——否則會把已刪分鏡復活進審批流程
  const [scene] = await db
    .select()
    .from(schema.scenes)
    .where(and(eq(schema.scenes.id, sceneId), isNull(schema.scenes.deletedAt)));
  if (!scene) throw new TRPCError({ code: "NOT_FOUND", message: "找不到分鏡（可能已刪除）" });
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, scene.projectId));
  if (!project) throw new TRPCError({ code: "NOT_FOUND" });
  return { scene, project };
}

/**
 * 送審核心（供 approvals.submit 與 AI 專案助手共用，行為單一來源，避免分岔）：
 * 作廢同分鏡舊 pending → 原子版本號 → 標分鏡 pending → 系統訊息。
 * assertAccess 收「分鏡的真實 project」且可 async——呼叫端帶組隔離（requireGroup）＋
 * 2.3 專案級 ACL（assertProjectEditable）；對 project 而非 groupId 檢查，兩個入口一次補齊，
 * 也避免助手入口對錯誤的專案做守衛（守衛與實際被改動的專案綁定）。
 */
export async function submitApprovalCore(
  sceneId: string,
  userId: string,
  assertAccess: (project: { id: string; groupId: string }) => void | Promise<void>,
  idempotencyApprovalId?: string,
) {
  const { scene, project } = await getScene(sceneId);
  await assertAccess(project);
  const result = await db.transaction(async (tx) => {
    // 為什麼：以 advisory xact lock 序列化「同一分鏡」的送審（classifier 1，與 points per-user 鎖的
    // classifier 0 不同鍵空間、不互卡；交易結束自動釋放）。單一 insert…select 的 max()+1 只在該語句
    // 快照內原子，並不序列化「另一交易的並發語句」——READ COMMITTED 下兩並發送審會各算同一 max→插入
    // 相同 version（重複 pending，decide 的 latest 守衛對相等版本失效→雙裁決）。上鎖後同分鏡送審全序列化。
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${scene.id}), 1)`);
    if (idempotencyApprovalId) {
      const [existing] = await tx
        .select()
        .from(schema.approvals)
        .where(eq(schema.approvals.id, idempotencyApprovalId));
      if (existing) {
        if (
          existing.sceneId !== scene.id
          || existing.projectId !== project.id
          || existing.submittedBy !== userId
        ) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "送審冪等識別碼已被其他操作使用",
          });
        }
        return { approval: existing, created: false };
      }
    }
    // 同一分鏡任一時刻最多一筆 pending——送新版時舊 pending 一律作廢，避免懸置舊版事後被裁決覆寫最新狀態
    await tx
      .update(schema.approvals)
      .set({ status: "needs_work", reason: "已被較新版本取代", decidedAt: new Date() })
      .where(and(eq(schema.approvals.sceneId, scene.id), eq(schema.approvals.status, "pending")));
    const inserted = idempotencyApprovalId
      ? (await tx.execute(sql`
          insert into approvals (id, project_id, scene_id, version, submitted_by)
          select ${idempotencyApprovalId}::uuid, ${project.id}::uuid, ${scene.id}::uuid, coalesce(max(version), 0) + 1, ${userId}::uuid
          from approvals
          where scene_id = ${scene.id}::uuid
          returning id
        `)) as unknown as { rows: Array<{ id: string }> }
      : (await tx.execute(sql`
          insert into approvals (project_id, scene_id, version, submitted_by)
          select ${project.id}::uuid, ${scene.id}::uuid, coalesce(max(version), 0) + 1, ${userId}::uuid
          from approvals
          where scene_id = ${scene.id}::uuid
          returning id
        `)) as unknown as { rows: Array<{ id: string }> };
    const insertedId = inserted.rows[0]?.id;
    // 為什麼：raw execute 回傳 snake_case 列，改用型別安全的重讀取得 camelCase 完整列給前端
    const [approval] = insertedId
      ? await tx.select().from(schema.approvals).where(eq(schema.approvals.id, insertedId))
      : [];
    if (!approval) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "送審寫入失敗，請重試" });
    await tx.update(schema.scenes).set({ status: "pending" }).where(eq(schema.scenes.id, scene.id));
    await tx.insert(schema.messages).values({
      groupId: project.groupId,
      projectId: project.id,
      userId,
      kind: "system",
      body: `📋 「${scene.title}」已送審（v${approval.version}）`,
    });
    return { approval, created: true };
  });
  const { approval } = result;
  // 跨裝置推播給組長們（fire-and-forget：推播失敗不影響送審本身）；同分鏡重送以 tag 覆蓋舊通知
  if (result.created) {
    void groupLeaderIds(project.groupId, userId)
      .then((ids) => pushToUsers(ids, {
        title: "分鏡送審",
        body: `「${scene.title}」已送審（v${approval.version}）——請裁決`,
        url: `/p/${project.id}`,
        tag: `approval-${scene.id}`,
      }))
      .catch((err) => console.warn("[approvals] 送審推播失敗：", err instanceof Error ? err.message : err));
  }
  return approval;
}

/** 審批三態機（Frame.io 模式，盲點掃描定案）：pending → approved / needs_work，跟著版本走 */
export const approvalsRouter = router({
  /** 組員送審（同一分鏡重送＝新版本）。2.3：檢視者不能改分鏡審批狀態 */
  submit: authedProcedure.input(z.object({ sceneId: z.string().uuid() })).mutation(({ ctx, input }) =>
    submitApprovalCore(input.sceneId, ctx.auth.user.id, async (project) => {
      requireGroup(ctx.auth, project.groupId);
      await assertProjectEditable(ctx.auth, project);
    }),
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
      if (input.decision === "needs_work" && !input.reason?.trim()) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "退回必須附一句理由（會通知提交人）" });
      }
      // 整段裁決包進單一交易＋與 submitApprovalCore 相同的 advisory lock（classifier 1）：
      // decide 若不取鎖，「latest 守衛通過 → CAS」與「blanket void → 改分鏡狀態」之間 submit 可插隊——
      // 剛送出的最新 pending 會被 blanket void 誤標「已被較新版本裁決取代」、分鏡狀態被舊版裁決覆蓋。
      // 上鎖後 decide 與 submit 對同一分鏡完全序列化；交易也保證四筆寫入不留半套（CAS 後崩潰的不一致）。
      const decided = await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${scene.id}), 1)`);
        // 為什麼：只允許裁決該分鏡的最新版本——防 DB 既存的多筆 pending 舊資料被裁決後覆寫最新狀態。
        // 讀取放在鎖之後，守衛與後續寫入之間不再有 submit 插隊窗口。
        const [latest] = await tx
          .select()
          .from(schema.approvals)
          .where(eq(schema.approvals.sceneId, approval.sceneId!))
          .orderBy(desc(schema.approvals.version))
          .limit(1);
        if (latest && latest.version > approval.version) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "已有較新版本送審，請裁決最新版" });
        }
        // CAS：UPDATE 加 status='pending' 守衛——兩位組長（或雙擊／雙分頁）同時裁決時只有第一筆更到列，
        // 其餘 returning 為空即擋下，避免 lost-update／重複系統訊息（比照 generationCore 的 inArray CAS）
        const [updated] = await tx
          .update(schema.approvals)
          .set({ status: input.decision, decidedBy: ctx.auth.user.id, reason: input.reason?.trim(), decidedAt: new Date() })
          .where(and(eq(schema.approvals.id, approval.id), eq(schema.approvals.status, "pending")))
          .returning();
        if (!updated) throw new TRPCError({ code: "BAD_REQUEST", message: "此版本已被裁決過" });
        // 為什麼：裁決生效時把同分鏡其他仍懸置的 pending（守衛保證都是舊版）一併標過期，
        // 避免它們日後被誤裁決、把分鏡狀態改回過期結果（剛裁決那筆已非 pending，不會被誤觸）
        await tx
          .update(schema.approvals)
          .set({ status: "needs_work", reason: "已被較新版本裁決取代", decidedBy: ctx.auth.user.id, decidedAt: new Date() })
          .where(and(eq(schema.approvals.sceneId, approval.sceneId!), eq(schema.approvals.status, "pending")));
        await tx.update(schema.scenes).set({ status: input.decision === "approved" ? "approved" : "needs_work" }).where(eq(schema.scenes.id, scene.id));
        await tx.insert(schema.messages).values({
          groupId: project.groupId,
          projectId: project.id,
          userId: ctx.auth.user.id,
          kind: "system",
          body: input.decision === "approved" ? `✅ 「${scene.title}」v${approval.version} 已通過` : `↩️ 「${scene.title}」v${approval.version} 需修改：${input.reason}`,
        });
        return updated;
      });
      // 裁決結果推播給提交人（自己裁自己送的不用通知）；失敗不擋裁決。
      // 先驗「現在還在組裡」：submittedBy 是存好的舊 id——提交後被移出組的前成員
      // 不該再收到組內內容（退回理由等），與其他事件「臨場重算收件人」的口徑一致。
      if (approval.submittedBy && approval.submittedBy !== ctx.auth.user.id) {
        const submitterId = approval.submittedBy;
        void canAccessGroup(project.groupId, submitterId)
          .then((ok) => (ok ? pushToUsers([submitterId], {
            title: input.decision === "approved" ? "分鏡已通過" : "分鏡需修改",
            body: input.decision === "approved"
              ? `「${scene.title}」v${approval.version} 已通過 ✅`
              : `「${scene.title}」v${approval.version} 需修改：${input.reason?.trim() ?? ""}`,
            url: `/p/${project.id}`,
            tag: `approval-${scene.id}`,
          }) : undefined))
          .catch((err) => console.warn("[approvals] 裁決推播失敗：", err instanceof Error ? err.message : err));
      }
      return decided;
    }),

  /**
   * 跨專案待辦彙總（UX 高嚴重度：首頁/頂欄完全不顯示待審/待核，多專案組長必然漏審）：
   * 各專案的「送審待裁決」（approvals pending，過濾已軟刪分鏡）與「生成待核准」
   * （generations awaiting_approval）計數。Launchpad 專案卡角標＋頂欄計數共用這一條查詢。
   */
  pendingSummary: authedProcedure.input(z.object({ groupId: z.string().uuid() })).query(async ({ ctx, input }) => {
    requireGroup(ctx.auth, input.groupId);
    // 兩條聚合都排除封存專案：Launchpad 預設不列封存案，計入會讓頂欄出現「找不到入口的幽靈待辦」
    const [apprAgg, genAgg] = await Promise.all([
      // join scenes 過濾軟刪：回收桶分鏡的懸置 pending 無法裁決（decide 的 getScene 會拒絕），不該計入待辦
      db
        // oldest：最久沒人裁決的那一件是哪天送的——作業台「待我裁決」用它排「卡最久的排前面」。
        // 只是既有聚合多一個 min()，不是新查詢。
        .select({ projectId: schema.approvals.projectId, n: sql<number>`count(*)`, oldest: sql<string | null>`min(${schema.approvals.createdAt})` })
        .from(schema.approvals)
        .innerJoin(schema.projects, eq(schema.approvals.projectId, schema.projects.id))
        .innerJoin(schema.scenes, eq(schema.approvals.sceneId, schema.scenes.id))
        .where(
          and(
            eq(schema.projects.groupId, input.groupId),
            ne(schema.projects.status, "archived"),
            eq(schema.approvals.status, "pending"),
            isNull(schema.scenes.deletedAt),
          ),
        )
        .groupBy(schema.approvals.projectId),
      db
        .select({ projectId: schema.generations.projectId, n: sql<number>`count(*)`, oldest: sql<string | null>`min(${schema.generations.createdAt})` })
        .from(schema.generations)
        .innerJoin(schema.projects, eq(schema.generations.projectId, schema.projects.id))
        .where(
          and(
            eq(schema.generations.groupId, input.groupId),
            ne(schema.projects.status, "archived"),
            eq(schema.generations.status, "awaiting_approval"),
          ),
        )
        .groupBy(schema.generations.projectId),
    ]);
    // count 經 node-postgres 回來是字串，一律 Number()（比照 teamAssistant 的守則）
    type PendingCell = {
      pendingApprovals: number;
      awaitingGenerations: number;
      oldestPendingApprovalAt: Date | null;
      oldestAwaitingGenerationAt: Date | null;
    };
    const emptyCell = (): PendingCell => ({
      pendingApprovals: 0, awaitingGenerations: 0,
      oldestPendingApprovalAt: null, oldestAwaitingGenerationAt: null,
    });
    // min(timestamp) 依驅動設定可能回 Date 或字串，統一轉 Date（無效值當作沒有）
    const toDate = (v: unknown): Date | null => {
      if (v == null) return null;
      const d = v instanceof Date ? v : new Date(String(v));
      return Number.isNaN(d.getTime()) ? null : d;
    };
    const byProject = new Map<string, PendingCell>();
    for (const r of apprAgg) {
      const cur = byProject.get(r.projectId) ?? emptyCell();
      cur.pendingApprovals += Number(r.n);
      cur.oldestPendingApprovalAt = toDate(r.oldest);
      byProject.set(r.projectId, cur);
    }
    for (const r of genAgg) {
      const cur = byProject.get(r.projectId) ?? emptyCell();
      cur.awaitingGenerations += Number(r.n);
      cur.oldestAwaitingGenerationAt = toDate(r.oldest);
      byProject.set(r.projectId, cur);
    }
    const projects = [...byProject.entries()].map(([projectId, c]) => ({ projectId, ...c }));
    return {
      projects,
      totalPendingApprovals: projects.reduce((s, p) => s + p.pendingApprovals, 0),
      totalAwaitingGenerations: projects.reduce((s, p) => s + p.awaitingGenerations, 0),
    };
  }),

  /** 專案內審批清單（分鏡卡顯示最新版狀態） */
  listByProject: authedProcedure.input(z.object({ projectId: z.string().uuid() })).query(async ({ ctx, input }) => {
    const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, input.projectId));
    if (!project) throw new TRPCError({ code: "NOT_FOUND" });
    requireGroup(ctx.auth, project.groupId);
    return db.select().from(schema.approvals).where(eq(schema.approvals.projectId, input.projectId)).orderBy(desc(schema.approvals.createdAt));
  }),
});
