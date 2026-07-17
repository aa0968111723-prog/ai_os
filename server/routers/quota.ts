import { z } from "zod";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure, adminProcedure, requireGroup, requireLeader } from "../trpc";
import { db, schema } from "../db";
import { getSettings, updateSettings, usedTotal, usedThisWeek, usedToday, effectiveWeeklyQuota, effectiveDailyQuota, groupUsage, usedByGroup, usedByMember, groupBudget, memberBudget } from "../services/points";

/** 團隊管理權檢查（組預算是由上往下分配的，只有團隊管理員以上能調）：開發者或該組所屬團隊的 admin */
async function assertGroupTeamAdmin(auth: { user: { isSuperAdmin: boolean }; adminTeamIds: string[] }, groupId: string): Promise<void> {
  const [group] = await db.select().from(schema.groups).where(eq(schema.groups.id, groupId));
  if (!group) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這個組" });
  if (!auth.user.isSuperAdmin && !auth.adminTeamIds.includes(group.teamId)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "只有團隊管理員以上能分配組預算" });
  }
}

/** 點數與額度管理（定案：不鎖死——開發者調全域、管理員調組、組長調成員） */
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
    // 分配樹（累計上限）：個人預算 → 組預算——只給本組成員看自己的剩餘
    let memberBudgetRemaining: number | null = null;
    let groupBudgetRemaining: number | null = null;
    if (isMember) {
      const gid = input!.groupId!;
      const [group] = await db.select().from(schema.groups).where(eq(schema.groups.id, gid));
      const th = group?.approvalThresholdPoints;
      approvalThreshold = th != null && th > 0 ? th : null;
      const mBudget = await memberBudget(ctx.auth.user.id, gid);
      if (mBudget != null) memberBudgetRemaining = Math.max(0, mBudget - (await usedByMember(ctx.auth.user.id, gid)));
      const gBudget = await groupBudget(gid);
      if (gBudget != null) groupBudgetRemaining = Math.max(0, gBudget - (await usedByGroup(gid)));
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
      memberBudgetRemaining, // null＝個人無累計上限
      groupBudgetRemaining, // null＝組無累計上限
    };
  }),

  /** 全域設定（開發者改；管理員可看） */
  getSettings: adminProcedure.query(() => getSettings()),
  updateSettings: adminProcedure
    .input(
      z.object({
        totalBudgetPoints: z.number().int().min(0).nullable(),
        defaultWeeklyPoints: z.number().int().min(0).nullable(),
        defaultDailyPoints: z.number().int().min(0).nullable().optional(),
        /** 資料庫文件每人儲存配額 GB（null＝預設 5；0＝不限） */
        fileQuotaGb: z.number().int().min(0).nullable().optional(),
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

  /** 組總預算（累計上限）：開發者/團隊管理員分配給組的點數池；0 或空＝不限。組長不可調（分配是由上往下） */
  setGroupBudget: authedProcedure
    .input(z.object({ groupId: z.string().uuid(), budgetPoints: z.number().int().min(0).nullable() }))
    .mutation(async ({ ctx, input }) => {
      await assertGroupTeamAdmin(ctx.auth, input.groupId);
      // 0 一律正規化成 null（不限）——守門處只判 null，不用兩套「不限」語意
      const value = input.budgetPoints && input.budgetPoints > 0 ? input.budgetPoints : null;
      await db.update(schema.groups).set({ budgetPoints: value }).where(eq(schema.groups.id, input.groupId));
      return { ok: true, budgetPoints: value };
    }),

  /** 組員個人預算（累計上限）：組長從組預算再分配給組員；0 或空＝不限。組長對自己組員調 */
  setMemberBudget: authedProcedure
    .input(z.object({ groupId: z.string().uuid(), userId: z.string().uuid(), budgetPoints: z.number().int().min(0).nullable() }))
    .mutation(async ({ ctx, input }) => {
      requireLeader(ctx.auth, input.groupId);
      const value = input.budgetPoints && input.budgetPoints > 0 ? input.budgetPoints : null;
      const updated = await db
        .update(schema.groupMembers)
        .set({ budgetPoints: value })
        .where(and(eq(schema.groupMembers.groupId, input.groupId), eq(schema.groupMembers.userId, input.userId)))
        .returning({ id: schema.groupMembers.id });
      if (updated.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "這位成員不在這個組" });
      return { ok: true, budgetPoints: value };
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

  /** 組用量儀表（組長/管理層）＋點數分配狀態（組預算、各組員分配額與累計用量） */
  usage: authedProcedure.input(z.object({ groupId: z.string().uuid() })).query(async ({ ctx, input }) => {
    requireLeader(ctx.auth, input.groupId);
    const usage = await groupUsage(input.groupId); // 只含有帳本的成員（weekly/total）
    const usageByUser = new Map(usage.map((u) => [u.userId, u]));
    const users = await db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users);
    const [group] = await db.select().from(schema.groups).where(eq(schema.groups.id, input.groupId));
    // 全體組員（含零用量者，才能對還沒花點的人分配預算）＋各自個人預算與角色
    const members = await db.select().from(schema.groupMembers).where(eq(schema.groupMembers.groupId, input.groupId));
    const rows = members.map((m) => {
      const u = usageByUser.get(m.userId);
      return {
        userId: m.userId,
        name: users.find((x) => x.id === m.userId)?.name ?? "?",
        role: m.role,
        weekly: u?.weekly ?? 0,
        total: u?.total ?? 0, // 累計淨消耗——個人預算的分母
        weeklyOverride: m.weeklyPointsOverride ?? null, // null＝跟組
        budget: m.budgetPoints ?? null, // null＝不限（未分配個人預算）
      };
    });
    const allocated = rows.reduce((s, r) => s + (r.budget ?? 0), 0); // 已分配給組員的個人預算總和
    return {
      groupQuota: group?.weeklyPointsPerUser ?? null,
      /** 成本審核門檻（需求 2.1）：組長設定 UI 讀這裡 */
      approvalThreshold: group?.approvalThresholdPoints ?? null,
      /** 組預算（累計上限；null＝不限）＋組累計用量＋已分配給組員的總和——分配 UI 的「還剩多少可分」用 */
      groupBudget: group?.budgetPoints ?? null,
      groupUsed: await usedByGroup(input.groupId),
      allocated,
      rows,
    };
  }),

  /**
   * 點數消耗監控（盲點修補：無成本異常告警）——管理儀表資料源。
   * 口徑一律「毛消耗」＝只加總扣點列（delta<0 取絕對值），退點「不」抵銷：
   * 監控要看的是「實際發動了多少花費」；若讓退點沖銷扣點，大量失敗重試的異常日
   * （正是最該被看見的日子）在淨額口徑下反而近乎隱形。
   * （額度守門的 usedThisWeek 是淨額口徑且退點跟隨生成週，兩者用途不同，屬刻意差異。）
   * 日界採台北時區：比照 points.ts 的 TPE_OFFSET 平移法，(created_at + interval '8 hours')::date 即台北日期。
   */
  consumptionStats: adminProcedure
    .input(z.object({ days: z.number().int().min(7).max(30).optional() }).optional())
    .query(async ({ ctx, input }) => {
      const days = input?.days ?? 14;

      // 可見範圍比照 audit.list：開發者看全站；一般團隊管理員只看 admin 身分展開的組
      let adminGroupIds: string[] | null = null; // null＝不過濾（全站）
      if (!ctx.auth.user.isSuperAdmin) {
        adminGroupIds = ctx.auth.groups.filter((g) => g.role === "admin").map((g) => g.groupId);
        if (adminGroupIds.length === 0) {
          // 沒有可管的組：回空資料（不拋錯，讓 UI 顯示「沒有可監控的組」即可）
          return {
            perDay: [] as Array<{ date: string; points: number }>,
            todayPoints: 0,
            avg7: 0,
            alert: false,
            byGroup: [] as Array<{ groupId: string; groupName: string; weekPoints: number }>,
          };
        }
      }
      const groupCond = adminGroupIds ? [inArray(schema.costLedger.groupId, adminGroupIds)] : [];

      // 台北日界（同 points.ts dayStart 的平移法）：+8h 後用 UTC 欄位讀到的就是台北牆鐘時間
      const TPE_OFFSET_MS = 8 * 60 * 60 * 1000;
      const DAY_MS = 24 * 60 * 60 * 1000;
      const tpeToday = new Date(Date.now() + TPE_OFFSET_MS);
      tpeToday.setUTCHours(0, 0, 0, 0); // 平移座標系裡的「台北今日 00:00」
      // avg7 要「不含今天的前 7 個整天」——即使只畫 7 天圖也得撈滿 8 天才夠算
      const fetchDays = Math.max(days, 8);
      const sinceUtc = new Date(tpeToday.getTime() - (fetchDays - 1) * DAY_MS - TPE_OFFSET_MS); // 平移回真 UTC 時刻

      // 逐日毛消耗：SQL 一次聚合撈回（只回有紀錄的日子，缺日在下面補 0）
      const tpeDay = sql<string>`to_char((${schema.costLedger.createdAt} + interval '8 hours')::date, 'YYYY-MM-DD')`;
      const gross = sql<number>`sum(case when ${schema.costLedger.delta} < 0 then -${schema.costLedger.delta} else 0 end)`;
      const dailyRows = await db
        .select({ date: tpeDay, points: gross })
        .from(schema.costLedger)
        .where(and(gte(schema.costLedger.createdAt, sinceUtc), ...groupCond))
        .groupBy(tpeDay);
      const byDate = new Map(dailyRows.map((r) => [r.date, Number(r.points)]));

      // 補齊整段日期（含 0 消耗日），前端長條圖才不會缺格
      const series: Array<{ date: string; points: number }> = [];
      for (let i = fetchDays - 1; i >= 0; i--) {
        const key = new Date(tpeToday.getTime() - i * DAY_MS).toISOString().slice(0, 10); // 平移座標系直接讀＝台北日期
        series.push({ date: key, points: byDate.get(key) ?? 0 });
      }
      const todayPoints = series[series.length - 1]?.points ?? 0;
      const avg7Raw = series.slice(-8, -1).reduce((s, d) => s + d.points, 0) / 7; // 不含今天的前 7 天平均
      // 異常門檻：今日毛消耗 > max(50, 前 7 日均值 × 3)。50 點下限避免「均值趨近 0、今天才幾點」的假警報
      const alert = todayPoints > Math.max(50, avg7Raw * 3);

      // 各組近 7 天（含今天）毛消耗，高到低——告警時可快速定位是哪個組在燒
      const weekSinceUtc = new Date(tpeToday.getTime() - 6 * DAY_MS - TPE_OFFSET_MS);
      const groupRows = await db
        .select({ groupId: schema.costLedger.groupId, groupName: schema.groups.name, weekPoints: gross })
        .from(schema.costLedger)
        .leftJoin(schema.groups, eq(schema.groups.id, schema.costLedger.groupId))
        .where(and(gte(schema.costLedger.createdAt, weekSinceUtc), ...groupCond))
        .groupBy(schema.costLedger.groupId, schema.groups.name);
      const byGroup = groupRows
        .map((r) => ({ groupId: r.groupId, groupName: r.groupName ?? "（已不存在的組）", weekPoints: Number(r.weekPoints) }))
        .sort((a, b) => b.weekPoints - a.weekPoints);

      return {
        perDay: series.slice(-days),
        todayPoints,
        avg7: Math.round(avg7Raw * 10) / 10, // 顯示用取 1 位小數；alert 已用原始均值判定
        alert,
        byGroup,
      };
    }),
});
