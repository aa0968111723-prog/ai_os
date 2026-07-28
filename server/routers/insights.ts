import { z } from "zod";
import { and, desc, eq, gte, inArray, sql, type SQL } from "drizzle-orm";
import { router, authedProcedure } from "../trpc";
import { db, schema } from "../db";
import { auditCategoryOf } from "../../shared/auditWording";
import type { AuthState } from "../services/auth";

/**
 * 操作紀錄洞察（回饋：人員的分類細節、模型操作與比較、生成精準度、提示詞）。
 * 三支查詢都是唯讀聚合，可見界一律比照 audit.list／quota.consumptionStats：
 * 開發者看全站；組長／團隊管理員看自己「非純組員」（leader／admin）身分的組。
 * 純組員回空資料（不拋錯——與 consumptionStats 同款，讓 UI 顯示空狀態即可）。
 */

/** null＝全站不過濾（僅開發者）；[]＝一個可見組都沒有（純組員），呼叫端直接回空 */
function visibleGroupIds(auth: AuthState): string[] | null {
  if (auth.user.isSuperAdmin) return null;
  return auth.groups.filter((g) => g.role !== "member").map((g) => g.groupId);
}

const daysInput = z.number().int().min(1).max(90).optional();

/** days（預設 30）→ 起算的 UTC 時刻 */
function sinceOf(days: number | undefined): Date {
  return new Date(Date.now() - (days ?? 30) * 24 * 60 * 60 * 1000);
}

export const insightsRouter = router({
  /**
   * 人員的分類細節：期間內每位夥伴做了幾筆操作、失敗幾筆、最近何時活動，
   * 並依操作分類（帳號／生成／分鏡…）攤開次數——組長一眼看出各人都在忙哪一塊。
   * SQL 只 group by（操作者×action），分類歸戶在 JS 用 auditCategoryOf 摺疊（與前端同一字典）。
   */
  actorBreakdown: authedProcedure
    .input(z.object({ teamId: z.string().uuid().optional(), groupId: z.string().uuid().optional(), days: daysInput }).optional())
    .query(async ({ ctx, input }) => {
      const visible = visibleGroupIds(ctx.auth);
      if (visible && visible.length === 0) return { members: [] as ActorBreakdownEntry[] };
      const conds: SQL[] = [gte(schema.auditLog.createdAt, sinceOf(input?.days))];
      if (visible) conds.push(inArray(schema.auditLog.groupId, visible));
      if (input?.teamId) conds.push(eq(schema.groups.teamId, input.teamId));
      if (input?.groupId) conds.push(eq(schema.auditLog.groupId, input.groupId));
      const rows = await db
        .select({
          actorId: schema.auditLog.actorId,
          name: schema.users.name,
          action: schema.auditLog.action,
          count: sql<number>`count(*)::int`,
          fails: sql<number>`sum(case when ${schema.auditLog.ok} then 0 else 1 end)::int`,
          lastAt: sql<string>`max(${schema.auditLog.createdAt})::text`,
        })
        .from(schema.auditLog)
        .leftJoin(schema.users, eq(schema.users.id, schema.auditLog.actorId))
        .leftJoin(schema.groups, eq(schema.groups.id, schema.auditLog.groupId))
        .where(and(...conds))
        .groupBy(schema.auditLog.actorId, schema.users.name, schema.auditLog.action);
      // JS 摺疊：actor×action → actor×分類。action 種類至多百餘個，資料量小、放 JS 才能共用前端同一套分類字典
      const byActor = new Map<string, ActorBreakdownEntry & { catMap: Map<string, { label: string; count: number }> }>();
      for (const r of rows) {
        let entry = byActor.get(r.actorId);
        if (!entry) {
          entry = { userId: r.actorId, name: r.name ?? "?", total: 0, fails: 0, lastAt: r.lastAt, categories: [], catMap: new Map() };
          byActor.set(r.actorId, entry);
        }
        entry.total += r.count;
        entry.fails += r.fails;
        if (r.lastAt > entry.lastAt) entry.lastAt = r.lastAt;
        const cat = auditCategoryOf(r.action);
        const c = entry.catMap.get(cat.key);
        if (c) c.count += r.count;
        else entry.catMap.set(cat.key, { label: cat.label, count: r.count });
      }
      const members: ActorBreakdownEntry[] = [...byActor.values()]
        .map(({ catMap, ...e }) => ({
          ...e,
          categories: [...catMap.entries()]
            .map(([key, v]) => ({ key, label: v.label, count: v.count }))
            .sort((a, b) => b.count - a.count),
        }))
        .sort((a, b) => b.total - a.total);
      return { members };
    }),

  /**
   * 模型使用與比較：期間內各模型被送了幾次生成、完成／失敗幾次（成功率＝生成精準度的量化）、
   * 花了多少點、幾位夥伴在用、最近何時用——挑模型時有數據可比，不再憑感覺。
   * 點數口徑：只計「完成」的實花（points_actual，缺值退回 points_est）；失敗會退點故不計。
   */
  modelStats: authedProcedure
    .input(
      z
        .object({
          teamId: z.string().uuid().optional(),
          groupId: z.string().uuid().optional(),
          projectId: z.string().uuid().optional(),
          days: daysInput,
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const visible = visibleGroupIds(ctx.auth);
      if (visible && visible.length === 0) return { models: [] as ModelStatEntry[] };
      const conds: SQL[] = [gte(schema.generations.createdAt, sinceOf(input?.days))];
      if (visible) conds.push(inArray(schema.generations.groupId, visible));
      if (input?.teamId) conds.push(eq(schema.groups.teamId, input.teamId));
      if (input?.groupId) conds.push(eq(schema.generations.groupId, input.groupId));
      if (input?.projectId) conds.push(eq(schema.generations.projectId, input.projectId));
      const rows = await db
        .select({
          modelId: schema.generations.modelId,
          kind: schema.generations.kind,
          submits: sql<number>`count(*)::int`,
          done: sql<number>`sum(case when ${schema.generations.status} = 'done' then 1 else 0 end)::int`,
          failed: sql<number>`sum(case when ${schema.generations.status} = 'failed' then 1 else 0 end)::int`,
          rejected: sql<number>`sum(case when ${schema.generations.status} = 'rejected' then 1 else 0 end)::int`,
          pending: sql<number>`sum(case when ${schema.generations.status} in ('queued','running','awaiting_approval') then 1 else 0 end)::int`,
          points: sql<number>`sum(case when ${schema.generations.status} = 'done' then coalesce(${schema.generations.pointsActual}, ${schema.generations.pointsEst}) else 0 end)::int`,
          users: sql<number>`count(distinct ${schema.generations.userId})::int`,
          lastUsedAt: sql<string>`max(${schema.generations.createdAt})::text`,
        })
        .from(schema.generations)
        .leftJoin(schema.groups, eq(schema.groups.id, schema.generations.groupId))
        .where(and(...conds))
        .groupBy(schema.generations.modelId, schema.generations.kind)
        .orderBy(desc(sql`count(*)`))
        .limit(200);
      return { models: rows as ModelStatEntry[] };
    }),

  /**
   * 提示詞流水：期間內的生成一筆筆列出——誰、用哪個模型、寫了什麼提示詞、結果如何、花幾點。
   * 供「同一畫面為什麼他生得出來我生不出來」的提示詞比較與教學；可依模型／夥伴縮小範圍。
   * 提示詞截 300 字（列表夠讀；全文在生成紀錄本身）。
   */
  recentPrompts: authedProcedure
    .input(
      z
        .object({
          teamId: z.string().uuid().optional(),
          groupId: z.string().uuid().optional(),
          projectId: z.string().uuid().optional(),
          modelId: z.string().max(200).optional(),
          actorId: z.string().uuid().optional(),
          days: daysInput,
          limit: z.number().int().min(1).max(50).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const visible = visibleGroupIds(ctx.auth);
      if (visible && visible.length === 0) return { items: [] as RecentPromptEntry[] };
      const conds: SQL[] = [gte(schema.generations.createdAt, sinceOf(input?.days))];
      if (visible) conds.push(inArray(schema.generations.groupId, visible));
      if (input?.teamId) conds.push(eq(schema.groups.teamId, input.teamId));
      if (input?.groupId) conds.push(eq(schema.generations.groupId, input.groupId));
      if (input?.projectId) conds.push(eq(schema.generations.projectId, input.projectId));
      if (input?.modelId) conds.push(eq(schema.generations.modelId, input.modelId));
      if (input?.actorId) conds.push(eq(schema.generations.userId, input.actorId));
      const rows = await db
        .select({
          id: schema.generations.id,
          prompt: sql<string>`left(${schema.generations.prompt}, 300)`,
          modelId: schema.generations.modelId,
          kind: schema.generations.kind,
          status: schema.generations.status,
          points: sql<number>`coalesce(${schema.generations.pointsActual}, ${schema.generations.pointsEst})::int`,
          error: schema.generations.error,
          // 原欄位直出（superjson 會還原成 Date）——不用 ::text，前端 new Date() 不吃 pg 文字格式的相容性風險
          createdAt: schema.generations.createdAt,
          userId: schema.generations.userId,
          userName: schema.users.name,
          projectId: schema.generations.projectId,
          projectTitle: schema.projects.title,
        })
        .from(schema.generations)
        .leftJoin(schema.users, eq(schema.users.id, schema.generations.userId))
        .leftJoin(schema.projects, eq(schema.projects.id, schema.generations.projectId))
        .leftJoin(schema.groups, eq(schema.groups.id, schema.generations.groupId))
        .where(and(...conds))
        .orderBy(desc(schema.generations.createdAt), desc(schema.generations.id))
        .limit(input?.limit ?? 20);
      return {
        items: rows.map((r) => ({ ...r, userName: r.userName ?? "?", projectTitle: r.projectTitle ?? null })) as RecentPromptEntry[],
      };
    }),

  /**
   * 人 × 模型用量矩陣：期間內每位夥伴對各模型送了幾次、完成／失敗幾次、完成實花幾點。
   * 精密成本盤點的主資料源——可 filter 組／人；前端估 NT$（1 點 ≈ NT$1）並匯出 CSV。
   * 點數口徑同 modelStats：只計 done 的 coalesce(points_actual, points_est)。
   */
  userModelStats: authedProcedure
    .input(
      z
        .object({
          teamId: z.string().uuid().optional(),
          groupId: z.string().uuid().optional(),
          actorId: z.string().uuid().optional(),
          modelId: z.string().max(200).optional(),
          days: daysInput,
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const visible = visibleGroupIds(ctx.auth);
      if (visible && visible.length === 0) {
        return { rows: [] as UserModelStatEntry[], totals: emptyUserModelTotals() };
      }
      const conds: SQL[] = [gte(schema.generations.createdAt, sinceOf(input?.days))];
      if (visible) conds.push(inArray(schema.generations.groupId, visible));
      if (input?.teamId) conds.push(eq(schema.groups.teamId, input.teamId));
      if (input?.groupId) conds.push(eq(schema.generations.groupId, input.groupId));
      if (input?.actorId) conds.push(eq(schema.generations.userId, input.actorId));
      if (input?.modelId) conds.push(eq(schema.generations.modelId, input.modelId));

      const rows = await db
        .select({
          userId: schema.generations.userId,
          userName: schema.users.name,
          modelId: schema.generations.modelId,
          kind: schema.generations.kind,
          submits: sql<number>`count(*)::int`,
          done: sql<number>`sum(case when ${schema.generations.status} = 'done' then 1 else 0 end)::int`,
          failed: sql<number>`sum(case when ${schema.generations.status} = 'failed' then 1 else 0 end)::int`,
          rejected: sql<number>`sum(case when ${schema.generations.status} = 'rejected' then 1 else 0 end)::int`,
          pending: sql<number>`sum(case when ${schema.generations.status} in ('queued','running','awaiting_approval') then 1 else 0 end)::int`,
          points: sql<number>`sum(case when ${schema.generations.status} = 'done' then coalesce(${schema.generations.pointsActual}, ${schema.generations.pointsEst}) else 0 end)::int`,
          lastUsedAt: sql<string>`max(${schema.generations.createdAt})::text`,
        })
        .from(schema.generations)
        .leftJoin(schema.users, eq(schema.users.id, schema.generations.userId))
        .leftJoin(schema.groups, eq(schema.groups.id, schema.generations.groupId))
        .where(and(...conds))
        .groupBy(schema.generations.userId, schema.users.name, schema.generations.modelId, schema.generations.kind)
        .orderBy(
          desc(sql`sum(case when ${schema.generations.status} = 'done' then coalesce(${schema.generations.pointsActual}, ${schema.generations.pointsEst}) else 0 end)`),
          desc(sql`count(*)`),
        )
        .limit(500);

      const mapped: UserModelStatEntry[] = rows.map((r) => ({
        userId: r.userId,
        userName: r.userName ?? "?",
        modelId: r.modelId,
        kind: r.kind,
        submits: r.submits,
        done: r.done,
        failed: r.failed,
        rejected: r.rejected,
        pending: r.pending,
        points: r.points,
        lastUsedAt: r.lastUsedAt,
      }));

      const totals = mapped.reduce(
        (acc, r) => {
          acc.submits += r.submits;
          acc.done += r.done;
          acc.failed += r.failed;
          acc.points += r.points;
          acc.users.add(r.userId);
          acc.models.add(r.modelId);
          return acc;
        },
        { submits: 0, done: 0, failed: 0, points: 0, users: new Set<string>(), models: new Set<string>() },
      );

      return {
        rows: mapped,
        totals: {
          submits: totals.submits,
          done: totals.done,
          failed: totals.failed,
          points: totals.points,
          /** 帳面估 NT$：1 點 ≈ NT$1（與 shared/models 定案一致；真實 Fal 帳單以 USD×結匯為準） */
          estTwd: totals.points,
          userCount: totals.users.size,
          modelCount: totals.models.size,
        },
      };
    }),
});

function emptyUserModelTotals() {
  return { submits: 0, done: 0, failed: 0, points: 0, estTwd: 0, userCount: 0, modelCount: 0 };
}

type ActorBreakdownEntry = {
  userId: string;
  name: string;
  total: number;
  fails: number;
  lastAt: string;
  categories: Array<{ key: string; label: string; count: number }>;
};

type ModelStatEntry = {
  modelId: string;
  kind: string;
  submits: number;
  done: number;
  failed: number;
  rejected: number;
  pending: number;
  points: number;
  users: number;
  lastUsedAt: string;
};

type RecentPromptEntry = {
  id: string;
  prompt: string;
  modelId: string;
  kind: string;
  status: "queued" | "running" | "done" | "failed" | "awaiting_approval" | "rejected";
  points: number;
  error: string | null;
  createdAt: Date;
  userId: string;
  userName: string;
  projectId: string;
  projectTitle: string | null;
};

type UserModelStatEntry = {
  userId: string;
  userName: string;
  modelId: string;
  kind: string;
  submits: number;
  done: number;
  failed: number;
  rejected: number;
  pending: number;
  points: number;
  lastUsedAt: string;
};
