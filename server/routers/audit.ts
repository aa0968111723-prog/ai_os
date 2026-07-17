import { z } from "zod";
import { and, desc, eq, getTableColumns, ilike, inArray, lt, or, sql, type SQL } from "drizzle-orm";
import { router, adminProcedure } from "../trpc";
import { db, schema } from "../db";

/**
 * 審計日誌查詢（需求 2.2）：管理層專用。
 * 可見範圍：開發者看全部；一般團隊管理員只看「自己管的團隊底下各組」的紀錄
 * ——與 feedback.list 的組隔離原則一致（無 groupId 歸屬的全域動作只有開發者看得到）。
 * keyset 分頁比照 generation.listByProjectPaged（createdAt desc, id desc＋::text 保微秒）。
 */
export const auditRouter = router({
  list: adminProcedure
    .input(
      z.object({
        cursor: z.object({ createdAt: z.string(), id: z.string().uuid() }).nullish(),
        /** action 關鍵字（如 "generation"、"scenes.update"）——ilike 模糊比對 */
        action: z.string().max(80).optional(),
        groupId: z.string().uuid().optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const pageSize = input.limit ?? 30;
      const conds: SQL[] = [];
      if (!ctx.auth.user.isSuperAdmin) {
        // 團隊管理員：以「admin 身分展開的組」為可見界（loadAuthState 已把管理的團隊展開成組員資格）
        const adminGroupIds = ctx.auth.groups.filter((g) => g.role === "admin").map((g) => g.groupId);
        if (adminGroupIds.length === 0) return { items: [], nextCursor: null };
        conds.push(inArray(schema.auditLog.groupId, adminGroupIds));
      }
      if (input.groupId) conds.push(eq(schema.auditLog.groupId, input.groupId));
      const q = input.action?.trim();
      if (q) {
        const escaped = q.replace(/[\\%_]/g, (m) => `\\${m}`);
        conds.push(ilike(schema.auditLog.action, `%${escaped}%`));
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
        })
        .from(schema.auditLog)
        .leftJoin(schema.users, eq(schema.users.id, schema.auditLog.actorId))
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(schema.auditLog.createdAt), desc(schema.auditLog.id))
        .limit(pageSize + 1);
      let nextCursor: { createdAt: string; id: string } | null = null;
      if (rows.length > pageSize) {
        const last = rows[pageSize - 1];
        nextCursor = { createdAt: last.cursorAt, id: last.id };
        rows.splice(pageSize);
      }
      const items = rows.map(({ cursorAt: _c, actorName, ...r }) => ({ ...r, actorName: actorName ?? "?" }));
      return { items, nextCursor };
    }),
});
