import { z } from "zod";
import { and, desc, eq, getTableColumns, ilike, inArray, lt, or, sql, type SQL } from "drizzle-orm";
import { router, authedProcedure } from "../trpc";
import { db, schema } from "../db";
import { auditPrefixesForCategory } from "../../shared/auditWording";

/**
 * 審計日誌查詢（需求 2.2）：組長以上皆可查（組長看得到自己組的操作流水）。
 * 可見範圍：開發者（超管）看全部；團隊管理員看自己管的團隊底下各組；
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
        /** 操作分類 key（見 shared/auditWording 的 AUDIT_CATEGORIES）——比關鍵字更白話的過濾 */
        category: z.string().max(40).optional(),
        groupId: z.string().uuid().optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const pageSize = input.limit ?? 30;
      const conds: SQL[] = [];
      if (!ctx.auth.user.isSuperAdmin) {
        // 組長以上可見界：在該組是 admin 或 leader 的組（loadAuthState 已把管理的團隊展開成 admin 組員資格）。
        // 純 member 不算——組員看不到操作紀錄（與「組長們都可以看到」的需求一致）。
        const visibleGroupIds = ctx.auth.groups.filter((g) => g.role !== "member").map((g) => g.groupId);
        if (visibleGroupIds.length === 0) return { items: [], nextCursor: null };
        conds.push(inArray(schema.auditLog.groupId, visibleGroupIds));
      }
      if (input.groupId) conds.push(eq(schema.auditLog.groupId, input.groupId));
      const q = input.action?.trim();
      if (q) {
        const escaped = q.replace(/[\\%_]/g, (m) => `\\${m}`);
        conds.push(ilike(schema.auditLog.action, `%${escaped}%`));
      }
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
          // 歸屬名稱（「更加細節」）：讓讀者知道這筆動到哪個組／哪個專案,不必去對 uuid
          groupName: schema.groups.name,
          projectTitle: schema.projects.title,
        })
        .from(schema.auditLog)
        .leftJoin(schema.users, eq(schema.users.id, schema.auditLog.actorId))
        .leftJoin(schema.groups, eq(schema.groups.id, schema.auditLog.groupId))
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
      const items = rows.map(({ cursorAt: _c, actorName, groupName, projectTitle, ...r }) => ({
        ...r,
        actorName: actorName ?? "?",
        groupName: groupName ?? null,
        projectTitle: projectTitle ?? null,
      }));
      return { items, nextCursor };
    }),
});
