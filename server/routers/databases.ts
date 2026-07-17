import { z } from "zod";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure } from "../trpc";
import { db, schema } from "../db";
import { validateFields, validateRowData, type DataField } from "../../shared/databaseFields";
import { canCreateIn, listVisibleTables, resolveTableAccess, type DataTableRow } from "../services/databaseAcl";

/**
 * 自訂資料庫（個人→組→團隊→全站）：表結構 CRUD＋列資料 CRUD。
 * - 權限單一真相：services/databaseAcl（MCP 也走同一套）。
 * - 審計：mutation 由 trpc.ts 的 authedProcedure 中介層自動落 audit_log，這裡不必重複。
 * - 欄位語意驗證集中在 shared/databaseFields（前後端零漂移）。
 */

const MAX_ROWS_PER_TABLE = 20_000;
const LIST_LIMIT_DEFAULT = 200;

/** zod 外形（語意驗證交給 validateFields）：unknown 進來、伺服器端把關 */
const fieldsShape = z.array(z.object({
  key: z.string(),
  label: z.string(),
  type: z.enum(["text", "number", "select", "date", "checkbox", "url", "user"]),
  options: z.array(z.string()).optional(),
  required: z.boolean().optional(),
})).max(60);

async function getTableChecked(auth: Parameters<typeof resolveTableAccess>[0], id: string): Promise<{ table: DataTableRow; access: ReturnType<typeof resolveTableAccess> }> {
  const [table] = await db.select().from(schema.dataTables).where(and(eq(schema.dataTables.id, id), isNull(schema.dataTables.deletedAt)));
  if (!table) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這個資料庫" });
  const access = resolveTableAccess(auth, table);
  // 無讀取權回 NOT_FOUND 而非 FORBIDDEN：不向外洩漏「存在但你看不到」的資訊（個人庫尤其重要）
  if (!access.canRead) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這個資料庫" });
  return { table, access };
}

export const databasesRouter = router({
  /** 我可見的全部資料庫（四層範圍一次回，前端按 scope 分區）＋每庫列數與我的權限 */
  list: authedProcedure.query(async ({ ctx }) => {
    const tables = await listVisibleTables(ctx.auth);
    return tables.map((t) => ({
      id: t.id,
      scope: t.scope,
      groupId: t.groupId,
      teamId: t.teamId,
      name: t.name,
      description: t.description,
      fields: t.fields as DataField[],
      memberWritable: t.memberWritable,
      rowCount: t.rowCount,
      updatedAt: t.updatedAt,
      access: resolveTableAccess(ctx.auth, t),
    }));
  }),

  get: authedProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ ctx, input }) => {
    const { table, access } = await getTableChecked(ctx.auth, input.id);
    return { ...table, fields: table.fields as DataField[], access };
  }),

  create: authedProcedure
    .input(z.object({
      scope: z.enum(["personal", "group", "team", "global"]),
      groupId: z.string().uuid().optional(),
      teamId: z.string().uuid().optional(),
      name: z.string().min(1, "請幫資料庫取個名字").max(80),
      description: z.string().max(500).optional(),
      fields: fieldsShape,
      memberWritable: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const denied = canCreateIn(ctx.auth, input.scope, input.groupId, input.teamId);
      if (denied) throw new TRPCError({ code: "FORBIDDEN", message: denied });
      const fieldError = validateFields(input.fields);
      if (fieldError) throw new TRPCError({ code: "BAD_REQUEST", message: fieldError });
      const [row] = await db
        .insert(schema.dataTables)
        .values({
          scope: input.scope,
          ownerId: input.scope === "personal" ? ctx.auth.user.id : null,
          groupId: input.scope === "group" ? input.groupId : null,
          teamId: input.scope === "team" ? input.teamId : null,
          name: input.name.trim(),
          description: input.description?.trim() || null,
          fields: input.fields,
          memberWritable: input.memberWritable ?? true,
          createdBy: ctx.auth.user.id,
        })
        .returning();
      return row;
    }),

  /** 改名／描述／欄位結構／寫入權開關（管理者限定）。改欄位不動既有列資料：移除欄位只是不再顯示。 */
  update: authedProcedure
    .input(z.object({
      id: z.string().uuid(),
      name: z.string().min(1).max(80).optional(),
      description: z.string().max(500).nullable().optional(),
      fields: fieldsShape.optional(),
      memberWritable: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { table, access } = await getTableChecked(ctx.auth, input.id);
      if (!access.canManage) throw new TRPCError({ code: "FORBIDDEN", message: "需要這個資料庫的管理權限（組長／團隊管理員／建立者）" });
      if (input.fields) {
        const fieldError = validateFields(input.fields);
        if (fieldError) throw new TRPCError({ code: "BAD_REQUEST", message: fieldError });
      }
      const [updated] = await db
        .update(schema.dataTables)
        .set({
          name: input.name?.trim() ?? table.name,
          description: input.description === undefined ? table.description : input.description?.trim() || null,
          fields: input.fields ?? (table.fields as DataField[]),
          memberWritable: input.memberWritable ?? table.memberWritable,
          updatedAt: new Date(),
        })
        .where(eq(schema.dataTables.id, table.id))
        .returning();
      return updated;
    }),

  /** 刪庫＝軟刪除（列資料原地保留，可救回）；管理者限定 */
  remove: authedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const { table, access } = await getTableChecked(ctx.auth, input.id);
    if (!access.canManage) throw new TRPCError({ code: "FORBIDDEN", message: "需要這個資料庫的管理權限（組長／團隊管理員／建立者）" });
    await db.update(schema.dataTables).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(schema.dataTables.id, table.id));
    return { ok: true };
  }),

  /** 列清單：keyword 以資料 JSON 全文粗篩（jsonb::text ilike）；offset 分頁 */
  listRows: authedProcedure
    .input(z.object({
      tableId: z.string().uuid(),
      q: z.string().max(200).optional(),
      limit: z.number().int().min(1).max(500).optional(),
      offset: z.number().int().min(0).optional(),
    }))
    .query(async ({ ctx, input }) => {
      const { table } = await getTableChecked(ctx.auth, input.tableId);
      const conds = [eq(schema.dataRows.tableId, table.id)];
      if (input.q?.trim()) {
        conds.push(sql`${schema.dataRows.data}::text ilike ${"%" + input.q.trim() + "%"}`);
      }
      const rows = await db
        .select({
          id: schema.dataRows.id,
          data: schema.dataRows.data,
          createdBy: schema.dataRows.createdBy,
          creatorName: schema.users.name,
          updatedAt: schema.dataRows.updatedAt,
        })
        .from(schema.dataRows)
        .leftJoin(schema.users, eq(schema.users.id, schema.dataRows.createdBy))
        .where(and(...conds))
        .orderBy(desc(schema.dataRows.createdAt))
        .limit(input.limit ?? LIST_LIMIT_DEFAULT)
        .offset(input.offset ?? 0);
      const [{ n }] = await db
        .select({ n: sql<number>`count(*)` })
        .from(schema.dataRows)
        .where(eq(schema.dataRows.tableId, table.id));
      return { rows, total: Number(n) };
    }),

  addRow: authedProcedure
    .input(z.object({ tableId: z.string().uuid(), data: z.record(z.unknown()) }))
    .mutation(async ({ ctx, input }) => {
      const { table, access } = await getTableChecked(ctx.auth, input.tableId);
      if (!access.canWriteRows) throw new TRPCError({ code: "FORBIDDEN", message: "這個資料庫目前只開放管理者寫入" });
      const checked = validateRowData(table.fields as DataField[], input.data);
      if (!checked.ok) throw new TRPCError({ code: "BAD_REQUEST", message: checked.error });
      // 量級保險絲：單庫列數上限——超過代表用法已超出這套輕量儲存的設計目標
      const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(schema.dataRows).where(eq(schema.dataRows.tableId, table.id));
      if (Number(n) >= MAX_ROWS_PER_TABLE) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: `這個資料庫已達 ${MAX_ROWS_PER_TABLE.toLocaleString()} 列上限，請分庫或清理舊資料` });
      }
      const [row] = await db
        .insert(schema.dataRows)
        .values({ tableId: table.id, data: checked.data, createdBy: ctx.auth.user.id })
        .returning();
      await db.update(schema.dataTables).set({ updatedAt: new Date() }).where(eq(schema.dataTables.id, table.id));
      return row;
    }),

  /** 更新列：整列覆寫語意（前端送完整 data）；寫入權即可（協作表格，不限本人的列） */
  updateRow: authedProcedure
    .input(z.object({ id: z.string().uuid(), data: z.record(z.unknown()) }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await db.select().from(schema.dataRows).where(eq(schema.dataRows.id, input.id));
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這一列" });
      const { table, access } = await getTableChecked(ctx.auth, row.tableId);
      if (!access.canWriteRows) throw new TRPCError({ code: "FORBIDDEN", message: "這個資料庫目前只開放管理者寫入" });
      const checked = validateRowData(table.fields as DataField[], input.data);
      if (!checked.ok) throw new TRPCError({ code: "BAD_REQUEST", message: checked.error });
      const [updated] = await db
        .update(schema.dataRows)
        .set({ data: checked.data, updatedBy: ctx.auth.user.id, updatedAt: new Date() })
        .where(eq(schema.dataRows.id, row.id))
        .returning();
      return updated;
    }),

  /** 刪列：列建立者本人或資料庫管理者（硬刪除；量小、有審計可回溯） */
  removeRow: authedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const [row] = await db.select().from(schema.dataRows).where(eq(schema.dataRows.id, input.id));
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這一列" });
    const { access } = await getTableChecked(ctx.auth, row.tableId);
    if (!access.canManage && row.createdBy !== ctx.auth.user.id) {
      throw new TRPCError({ code: "FORBIDDEN", message: "只有這一列的建立者或資料庫管理者可以刪除" });
    }
    await db.delete(schema.dataRows).where(eq(schema.dataRows.id, row.id));
    return { ok: true };
  }),
});
