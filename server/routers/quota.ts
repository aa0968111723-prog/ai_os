import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure, adminProcedure, requireGroup, requireLeader } from "../trpc";
import { db, schema } from "../db";
import { getSettings, updateSettings, usedTotal, usedThisWeek, usedToday, effectiveWeeklyQuota, effectiveDailyQuota, groupUsage } from "../services/points";

/** 點數與額度管理（定案：不鎖死——超管調全域、管理員調組、組長調成員） */
export const quotaRouter = router({
  /** 我的額度＋剩餘（頂欄徽章；groupId 用當前作用組） */
  my: authedProcedure.input(z.object({ groupId: z.string().uuid().optional() }).optional()).query(async ({ ctx, input }) => {
    const settings = await getSettings();
    const total = await usedTotal();
    const weekly = await usedThisWeek(ctx.auth.user.id);
    const today = await usedToday(ctx.auth.user.id);
    // 只在使用者確實屬於該組時才算組額度（舊版任意 groupId 都算，洩漏他組額度設定）
    const isMember = input?.groupId ? ctx.auth.groups.some((g) => g.groupId === input.groupId) : false;
    const quota = isMember ? await effectiveWeeklyQuota(ctx.auth.user.id, input!.groupId!) : null;
    // 成本審核門檻（需求 2.1）：前端生成確認彈窗要提示「這筆需組長核准」——同樣只給本組成員看
    let approvalThreshold: number | null = null;
    if (isMember) {
      const [group] = await db.select().from(schema.groups).where(eq(schema.groups.id, input!.groupId!));
      const th = group?.approvalThresholdPoints;
      approvalThreshold = th != null && th > 0 ? th : null;
    }
    return {
      totalBudget: settings.totalBudgetPoints, // null＝不限
      totalUsed: total,
      totalRemaining: settings.totalBudgetPoints != null && settings.totalBudgetPoints > 0 ? Math.max(0, settings.totalBudgetPoints - total) : null,
      weeklyQuota: quota, // null＝不限
      weeklyUsed: weekly,
      dailyQuota: effectiveDailyQuota(settings), // null＝不限
      dailyUsed: today,
      approvalThreshold, // null＝不啟用成本審核門檻
    };
  }),

  /** 全域設定（超管改；管理員可看） */
  getSettings: adminProcedure.query(() => getSettings()),
  updateSettings: adminProcedure
    .input(
      z.object({
        totalBudgetPoints: z.number().int().min(0).nullable(),
        defaultWeeklyPoints: z.number().int().min(0).nullable(),
        defaultDailyPoints: z.number().int().min(0).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.auth.user.isSuperAdmin) throw new TRPCError({ code: "FORBIDDEN", message: "只有開發者能調全域預算" });
      return updateSettings(input);
    }),

  /** 組週額度（團隊管理/組長可調；0 或空＝不限） */
  setGroupQuota: authedProcedure
    .input(z.object({ groupId: z.string().uuid(), weeklyPointsPerUser: z.number().int().min(0).nullable() }))
    .mutation(async ({ ctx, input }) => {
      requireLeader(ctx.auth, input.groupId); // 組長或管理層
      await db.update(schema.groups).set({ weeklyPointsPerUser: input.weeklyPointsPerUser }).where(eq(schema.groups.id, input.groupId));
      return { ok: true };
    }),

  /** 成本審核門檻（需求 2.1）：組員單筆生成估點 ≥ 門檻需組長核准；0/null＝不啟用。組長以上可調 */
  setApprovalThreshold: authedProcedure
    .input(z.object({ groupId: z.string().uuid(), thresholdPoints: z.number().int().min(0).nullable() }))
    .mutation(async ({ ctx, input }) => {
      requireLeader(ctx.auth, input.groupId);
      // 0 一律正規化成 null（不啟用）——守門處只需判 null，不用兩套「關閉」語意
      const value = input.thresholdPoints && input.thresholdPoints > 0 ? input.thresholdPoints : null;
      await db.update(schema.groups).set({ approvalThresholdPoints: value }).where(eq(schema.groups.id, input.groupId));
      return { ok: true, thresholdPoints: value };
    }),

  /** 個別成員覆寫（組長對自己組員微調） */
  setMemberOverride: authedProcedure
    .input(z.object({ groupId: z.string().uuid(), userId: z.string().uuid(), weeklyPointsOverride: z.number().int().min(0).nullable() }))
    .mutation(async ({ ctx, input }) => {
      requireLeader(ctx.auth, input.groupId);
      await db
        .update(schema.groupMembers)
        .set({ weeklyPointsOverride: input.weeklyPointsOverride })
        .where(and(eq(schema.groupMembers.groupId, input.groupId), eq(schema.groupMembers.userId, input.userId)));
      return { ok: true };
    }),

  /** 組用量儀表（組長/管理層） */
  usage: authedProcedure.input(z.object({ groupId: z.string().uuid() })).query(async ({ ctx, input }) => {
    requireLeader(ctx.auth, input.groupId);
    const usage = await groupUsage(input.groupId);
    const users = await db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users);
    const [group] = await db.select().from(schema.groups).where(eq(schema.groups.id, input.groupId));
    return {
      groupQuota: group?.weeklyPointsPerUser ?? null,
      /** 成本審核門檻（需求 2.1）：組長設定 UI 讀這裡 */
      approvalThreshold: group?.approvalThresholdPoints ?? null,
      rows: usage.map((u) => ({ ...u, name: users.find((x) => x.id === u.userId)?.name ?? "?" })),
    };
  }),
});
