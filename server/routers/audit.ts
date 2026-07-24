import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, getTableColumns, ilike, inArray, lt, or, sql, type SQL } from "drizzle-orm";
import { router, authedProcedure } from "../trpc";
import { db, schema } from "../db";
import { auditPrefixesForCategory } from "../../shared/auditWording";

/**
 * 審計日誌查詢（需求 2.2）：組長以上皆可查（組長看得到自己組的操作流水）。
 * 可見範圍：開發者看全部；團隊管理員看自己管的團隊底下各組；
 * 組長看自己帶的組——凡在該組是 admin／leader（非純 member）都算可見。
 * 與 feedback.list 的組隔離原則一致（無 groupId 歸屬的全域動作只有開發者看得到）。
 * keyset 分頁比照 generation.listByProjectPaged（createdAt desc, id desc＋::text 保微秒）。
 */
export const auditRouter = router({
  list: authedProcedure
    .input(
      z.object({
        cursor: z.object({ createdAt: z.string(), id: z.string().uuid() }).nullish(),
        /** action 關鍵字（如 "generation"、"scenes.update"）——ilike 模糊比對 */
        action: z.string().max(80).optional(),
        /** action 代碼清單（精確比對）：前端把中文關鍵字翻成命中的代碼後帶入，讓夥伴能用中文搜尋 */
        actions: z.array(z.string().max(80)).max(80).optional(),
        /** 操作分類 key（見 shared/auditWording 的 AUDIT_CATEGORIES）——比關鍵字更白話的過濾 */
        category: z.string().max(40).optional(),
        /** 依團隊過濾：看整個團隊底下各組的操作流水（分團隊） */
        teamId: z.string().uuid().optional(),
        /** 依組別過濾：切到單一組別（分組別） */
        groupId: z.string().uuid().optional(),
        /** 依操作者過濾：只看某位夥伴做的事（分組員） */
        actorId: z.string().uuid().optional(),
        /** 依專案過濾：只看某個專案上發生的操作（分專案） */
        projectId: z.string().uuid().optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const pageSize = input.limit ?? 30;
      const conds: SQL[] = [];
      if (!ctx.auth.user.isSuperAdmin) {
        // 組長以上可見界：在該組是 admin 或 leader 的組（loadAuthState 已把管理的團隊展開成 admin 組員資格）。
        // 純 member 不算——組員看不到操作紀錄；一個可見組都沒有就直接擋（維持「組員不能看審計」的界線）。
        const visibleGroupIds = ctx.auth.groups.filter((g) => g.role !== "member").map((g) => g.groupId);
        if (visibleGroupIds.length === 0) throw new TRPCError({ code: "FORBIDDEN", message: "需要組長或管理權限" });
        conds.push(inArray(schema.auditLog.groupId, visibleGroupIds));
      }
      // 團隊過濾靠 join 的 groups.teamId（非 auditLog 直屬欄位）；非開發者上面已先鎖 visibleGroupIds，
      // 這裡只是在可見範圍內再縮，不會擴權。分團隊／組別／組員／專案四維度彼此獨立、可疊加。
      if (input.teamId) conds.push(eq(schema.groups.teamId, input.teamId));
      if (input.groupId) conds.push(eq(schema.auditLog.groupId, input.groupId));
      if (input.actorId) conds.push(eq(schema.auditLog.actorId, input.actorId));
      if (input.projectId) conds.push(eq(schema.auditLog.projectId, input.projectId));
      const q = input.action?.trim();
      if (q) {
        const escaped = q.replace(/[\\%_]/g, (m) => `\\${m}`);
        conds.push(ilike(schema.auditLog.action, `%${escaped}%`));
      }
      // 中文搜尋走這條：前端用 AUDIT_ACTION_LABELS 把「邀請」翻成 ["admin.invite", "auth.acceptInvite"] 帶入
      if (input.actions?.length) conds.push(inArray(schema.auditLog.action, input.actions));
      // 分類過濾：把該類的路由前綴展開成 OR 的「action LIKE 'prefix.%'」——未知 key 不套用
      if (input.category) {
        const prefixes = auditPrefixesForCategory(input.category);
        if (prefixes.length) {
          const catConds = prefixes.map((p) => sql`${schema.auditLog.action} LIKE ${`${p}.%`}`);
          conds.push(or(...catConds)!);
        }
      }
      if (input.cursor) {
        const cAt = input.cursor.createdAt;
        const cId = input.cursor.id;
        conds.push(
          or(
            sql`${schema.auditLog.createdAt} < ${cAt}::timestamptz`,
            and(sql`${schema.auditLog.createdAt} = ${cAt}::timestamptz`, lt(schema.auditLog.id, cId)),
          )!,
        );
      }
      const rows = await db
        .select({
          ...getTableColumns(schema.auditLog),
          cursorAt: sql<string>`${schema.auditLog.createdAt}::text`,
          actorName: schema.users.name,
          // 歸屬名稱（「更加細節」／分團隊組別）：這筆動到哪個團隊・組別・專案,不必去對 uuid
          teamName: schema.teams.name,
          groupName: schema.groups.name,
          projectTitle: schema.projects.title,
          // 操作者在該組的角色（組長／組員）——「分組員」的層級標示；歸屬非組內動作時為 null。
          // 用純量子查詢（limit 1）而非 join：group_members 沒有 (group_id,user_id) 唯一鍵，
          // 萬一有重複列，join 會把該筆審計 fan-out 成多列；子查詢只取一列，絕不重複。
          actorRole: sql<
            "leader" | "member" | null
          >`(select role from group_members where group_members.user_id = ${schema.auditLog.actorId} and group_members.group_id = ${schema.auditLog.groupId} limit 1)`,
        })
        .from(schema.auditLog)
        .leftJoin(schema.users, eq(schema.users.id, schema.auditLog.actorId))
        .leftJoin(schema.groups, eq(schema.groups.id, schema.auditLog.groupId))
        .leftJoin(schema.teams, eq(schema.teams.id, schema.groups.teamId))
        .leftJoin(schema.projects, eq(schema.projects.id, schema.auditLog.projectId))
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(schema.auditLog.createdAt), desc(schema.auditLog.id))
        .limit(pageSize + 1);
      let nextCursor: { createdAt: string; id: string } | null = null;
      if (rows.length > pageSize) {
        const last = rows[pageSize - 1];
        nextCursor = { createdAt: last.cursorAt, id: last.id };
        rows.splice(pageSize);
      }
      const items = rows.map(({ cursorAt: _c, actorName, teamName, groupName, projectTitle, actorRole, ...r }) => ({
        ...r,
        actorName: actorName ?? "?",
        teamName: teamName ?? null,
        groupName: groupName ?? null,
        projectTitle: projectTitle ?? null,
        actorRole: actorRole ?? null,
      }));
      return { items, nextCursor };
    }),
});
