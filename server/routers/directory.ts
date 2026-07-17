import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { router, authedProcedure } from "../trpc";
import { db, schema } from "../db";
import { groupUsageMany } from "../services/points";
import { humanizeAuditAction } from "../../shared/auditWording";
import type { AuthState } from "../services/auth";

/**
 * 成員通訊錄（需求：團隊/組別/人員的細節）。
 * 可見範圍與操作紀錄一致：開發者看全部；團隊管理員看自己管的團隊各組；組長看自己帶的組。
 * 純組員無可見組——通訊錄含全體成員的點數/活動屬管理資訊，不對純組員開放（擋下）。
 * 一個人可跨多組，因此以「人」為單位聚合各段組籍（memberships）、各組點數與最近活動。
 */

type VisGroup = { groupId: string; groupName: string; teamId: string; teamName: string };

/** 目前使用者能看到的組（含團隊名）——組長/管理員用 ctx.auth.groups 現成展開，開發者查全表 */
async function visibleGroups(auth: AuthState): Promise<VisGroup[]> {
  if (auth.user.isSuperAdmin) {
    const rows = await db
      .select({
        groupId: schema.groups.id,
        groupName: schema.groups.name,
        teamId: schema.groups.teamId,
        teamName: schema.teams.name,
      })
      .from(schema.groups)
      .leftJoin(schema.teams, eq(schema.teams.id, schema.groups.teamId));
    return rows.map((r) => ({ ...r, teamName: r.teamName ?? "?" }));
  }
  // admin 身分展開的組（loadAuthState 已把管理團隊攤成 admin）＋自己帶的組（leader）；純 member 不算
  return auth.groups
    .filter((g) => g.role !== "member")
    .map((g) => ({ groupId: g.groupId, groupName: g.groupName, teamId: g.teamId, teamName: g.teamName }));
}

export const directoryRouter = router({
  /** 可見組清單（給通訊錄與操作紀錄當「依組別過濾」的下拉；純組員回空陣列，不擋——只是沒得選） */
  scope: authedProcedure.query(async ({ ctx }) => {
    const groups = await visibleGroups(ctx.auth);
    // 依團隊、組名排序，下拉才穩定好找
    groups.sort((a, b) => a.teamName.localeCompare(b.teamName, "zh-Hant") || a.groupName.localeCompare(b.groupName, "zh-Hant"));
    return { groups };
  }),

  /**
   * 通訊錄：可見範圍內的全體成員，逐人聚合
   * ——所屬團隊/組別與角色、各組點數用量（本週/累計/個人預算）、最近登入與最近操作。
   */
  list: authedProcedure
    .input(z.object({ q: z.string().max(80).optional(), groupId: z.string().uuid().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const vgroups = await visibleGroups(ctx.auth);
      if (vgroups.length === 0) throw new TRPCError({ code: "FORBIDDEN", message: "需要組長或管理權限" });
      const gmeta = new Map(vgroups.map((g) => [g.groupId, g]));
      // 指定組別過濾：只看該組（且必須在可見範圍內）
      const scopeGroupIds = input?.groupId && gmeta.has(input.groupId) ? [input.groupId] : vgroups.map((g) => g.groupId);

      const memberships = await db
        .select({ groupId: schema.groupMembers.groupId, userId: schema.groupMembers.userId, role: schema.groupMembers.role, budget: schema.groupMembers.budgetPoints })
        .from(schema.groupMembers)
        .where(inArray(schema.groupMembers.groupId, scopeGroupIds));
      const userIds = [...new Set(memberships.map((m) => m.userId))];
      if (userIds.length === 0) return { members: [] as MemberEntry[] };

      const [users, usageRows, activity, logins] = await Promise.all([
        db
          .select({ id: schema.users.id, name: schema.users.name, email: schema.users.email, isSuperAdmin: schema.users.isSuperAdmin, status: schema.users.status })
          .from(schema.users)
          .where(inArray(schema.users.id, userIds)),
        // 各組逐人本週/累計淨消耗——一次查（groupUsageMany）避免逐組 N+1；只回有帳本者，無用量者稍後補 0
        groupUsageMany(scopeGroupIds),
        // 最近操作：一次 group by 抓「最後操作時間＋當時 action」，避免逐人查。
        // 非開發者只計「可見組別」內的動作——不可把使用者在別組/全域(null group)的操作洩漏給只帶某組的組長，
        // 與 audit.list 的組隔離界一致；開發者看全部（含 null group 的生成等動作）才看得到真正的最後動態。
        // （auth.login/acceptInvite 是 public procedure、不落審計，故登入時間改由 sessions 取）
        db
          .select({
            actorId: schema.auditLog.actorId,
            lastActionAt: sql<string | null>`max(${schema.auditLog.createdAt})::text`,
            lastAction: sql<string | null>`(array_agg(${schema.auditLog.action} order by ${schema.auditLog.createdAt} desc))[1]`,
          })
          .from(schema.auditLog)
          .where(
            ctx.auth.user.isSuperAdmin
              ? inArray(schema.auditLog.actorId, userIds)
              : and(inArray(schema.auditLog.actorId, userIds), inArray(schema.auditLog.groupId, scopeGroupIds)),
          )
          .groupBy(schema.auditLog.actorId),
        // 最近登入：現有 session 的最後建立時間（登入即建 session）——登出/過期清掉就沒有，屬合理的「近況」
        db
          .select({ userId: schema.sessions.userId, lastLoginAt: sql<string | null>`max(${schema.sessions.createdAt})::text` })
          .from(schema.sessions)
          .where(inArray(schema.sessions.userId, userIds))
          .groupBy(schema.sessions.userId),
      ]);

      const userById = new Map(users.map((u) => [u.id, u]));
      const activityById = new Map(activity.map((a) => [a.actorId, a]));
      const loginById = new Map(logins.map((l) => [l.userId, l.lastLoginAt]));
      // key `${groupId}:${userId}` → {weekly,total}
      const usageMap = new Map<string, { weekly: number; total: number }>();
      for (const r of usageRows) usageMap.set(`${r.groupId}:${r.userId}`, { weekly: r.weekly, total: r.total });

      // 逐人聚合組籍
      const byUser = new Map<string, MemberEntry>();
      for (const m of memberships) {
        const g = gmeta.get(m.groupId);
        const u = userById.get(m.userId);
        if (!g || !u) continue;
        let entry = byUser.get(m.userId);
        if (!entry) {
          const act = activityById.get(m.userId);
          entry = {
            userId: m.userId,
            name: u.name,
            email: u.email,
            isSuperAdmin: u.isSuperAdmin,
            disabled: u.status === "disabled",
            memberships: [],
            lastLoginAt: loginById.get(m.userId) ?? null,
            lastActionAt: act?.lastActionAt ?? null,
            lastActionLabel: act?.lastAction ? humanizeAuditAction(act.lastAction) : null,
          };
          byUser.set(m.userId, entry);
        }
        const usage = usageMap.get(`${m.groupId}:${m.userId}`);
        entry.memberships.push({
          groupId: g.groupId,
          groupName: g.groupName,
          teamId: g.teamId,
          teamName: g.teamName,
          role: m.role,
          weeklyUsed: usage?.weekly ?? 0,
          totalUsed: usage?.total ?? 0,
          budget: m.budget ?? null,
        });
      }

      let members = [...byUser.values()];
      // 關鍵字（姓名/Email）——伺服器端過濾，前端只管顯示
      const q = input?.q?.trim().toLowerCase();
      if (q) members = members.filter((m) => m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q));
      // 排序：開發者 → 有帶組（組長）→ 其餘，其次姓名，讓「誰是負責人」浮在前面
      const rank = (m: MemberEntry) => (m.isSuperAdmin ? 0 : m.memberships.some((x) => x.role === "leader") ? 1 : 2);
      members.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, "zh-Hant"));
      return { members };
    }),
});

type MemberEntry = {
  userId: string;
  name: string;
  email: string;
  isSuperAdmin: boolean;
  disabled: boolean;
  memberships: Array<{
    groupId: string;
    groupName: string;
    teamId: string;
    teamName: string;
    role: "leader" | "member";
    weeklyUsed: number;
    totalUsed: number;
    budget: number | null;
  }>;
  lastLoginAt: string | null;
  lastActionAt: string | null;
  lastActionLabel: string | null;
};
