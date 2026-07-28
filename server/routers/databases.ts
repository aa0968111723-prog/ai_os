import { z } from "zod";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure, requireGroup } from "../trpc";
import { db, schema } from "../db";
import { MAX_FILE_CATEGORY, normalizeFileCategory, validateFields, validateRowData, type DataField, type DataRowData } from "../../shared/databaseFields";
import { canCreateIn, listVisibleTables, resolveTableAccess, type DataTableRow } from "../services/databaseAcl";
import { addDataRowValidated } from "../services/databaseCore";
import {
  executeIdempotentDatabaseBatch,
  IDEMPOTENCY_KEY_MAX_LENGTH,
  IDEMPOTENCY_KEY_MIN_LENGTH,
  IDEMPOTENCY_KEY_PATTERN,
  IdempotencyConflictError,
} from "../services/databaseBatchIdempotency";
import {
  escapeLikeLiteral,
  normalizeDatabaseSearchKeyword,
} from "../services/databaseRowSearch";
import { classifyDatabaseFile, mediaKindOf, tableStats } from "../services/databaseMedia";
import { assertProjectEditable, assertProjectNotArchived } from "../services/projectAcl";
import { tabularToRowObjects, TABULAR_FORMATS, type TabularFormat } from "../../shared/tabular";
import { findProjectLinkedRows } from "../services/databaseProjectLinks";
import {
  buildBoundTableFields,
  getProjectDataTemplate,
  PROJECT_DATA_TEMPLATE_IDS,
  type ProjectDataTemplateId,
} from "../../shared/projectDataTemplates";
import {
  extractTextFromBuffer,
  fetchImport,
  fetchNotionText,
  fileQuotaBytes,
  htmlToText,
  MAX_TEXT_CHARS,
  normalizeImportUrl,
  notionPageIdFromUrl,
  quotaGuardError,
  ssrfGuardError,
  userFileUsage,
} from "../services/databaseFiles";
import { checkDiskSpace, copyStoredFile, kindFromMime, removeStoredFile, saveBuffer } from "../services/storage";
import { fetchDriveFile, getNotionToken } from "../services/integrations";

/**
 * 自訂資料庫（個人→組→團隊→全站）：表結構 CRUD＋列資料 CRUD＋文件層＋連接（CSV/專案/排程）。
 * - 權限單一真相：services/databaseAcl（MCP 也走同一套）。
 * - 列寫入單一路徑：services/databaseCore.addDataRowValidated（tRPC/MCP/代理/REST 共用）。
 * - 審計：mutation 由 trpc.ts 的 authedProcedure 中介層自動落 audit_log，這裡不必重複。
 * - 欄位語意驗證集中在 shared/databaseFields（前後端零漂移）。
 */

const LIST_LIMIT_DEFAULT = 200;

/** zod 外形（語意驗證交給 validateFields）：unknown 進來、伺服器端把關 */
const fieldsShape = z.array(z.object({
  key: z.string(),
  label: z.string(),
  type: z.enum(["text", "number", "select", "date", "checkbox", "url", "file", "user", "project", "schedule"]),
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

/**
 * 文件存取檢查：檔案與其資料庫兩層都查。任何一層不存在或無讀取權，一律回同一句
 * 「找不到這份文件」——不讓「檔案存在但你無權」與「根本沒這檔」的訊息差異洩漏存在性。
 */
async function getFileChecked(auth: Parameters<typeof resolveTableAccess>[0], fileId: string) {
  const [file] = await db.select().from(schema.dataFiles).where(eq(schema.dataFiles.id, fileId));
  if (!file) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這份文件" });
  try {
    const { table, access } = await getTableChecked(auth, file.tableId);
    return { file, table, access };
  } catch {
    throw new TRPCError({ code: "NOT_FOUND", message: "找不到這份文件" });
  }
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
      agentAccess: t.agentAccess,
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
      /** AI／MCP 存取等級（none/read/write）——見 databaseAcl.resolveAgentAccess */
      agentAccess: z.enum(["none", "read", "write"]).optional(),
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
          agentAccess: input.agentAccess ?? "write",
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
      agentAccess: z.enum(["none", "read", "write"]).optional(),
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
          agentAccess: input.agentAccess ?? table.agentAccess,
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
      const keyword = normalizeDatabaseSearchKeyword(input.q);
      if (keyword) {
        conds.push(sql`${schema.dataRows.data}::text ilike ${`%${escapeLikeLiteral(keyword)}%`} escape ${"\\"}`);
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
      // total 要套用與列查詢相同的條件（含 q 全文粗篩），否則搜尋時分頁器會依全表列數
      // 算出一堆空白頁（顯示「1-3 of 10000」）。
      const [{ n }] = await db
        .select({ n: sql<number>`count(*)` })
        .from(schema.dataRows)
        .where(and(...conds));
      return { rows, total: Number(n) };
    }),

  addRow: authedProcedure
    .input(z.object({ tableId: z.string().uuid(), data: z.record(z.unknown()) }))
    .mutation(async ({ ctx, input }) => {
      const { table, access } = await getTableChecked(ctx.auth, input.tableId);
      if (!access.canWriteRows) throw new TRPCError({ code: "FORBIDDEN", message: "這個資料庫目前只開放管理者寫入" });
      try {
        return await addDataRowValidated(table, ctx.auth.user.id, input.data);
      } catch (err) {
        throw new TRPCError({ code: "BAD_REQUEST", message: err instanceof Error ? err.message : "新增失敗" });
      }
    }),

  /**
   * 連結到某專案的資料列（專案 × 資料庫細部連結）：掃「這個專案所屬組」可見的資料庫中，
   * 任一 project 型別欄位的值等於此 projectId 的列——讓專案頁一眼看到「哪些資料表提到我」
   * （例：任務表裡本專案的待辦、借用表裡指派給本專案的項目）。
   * 權限：需是專案所屬組成員（requireGroup）；只掃該組可見範圍的庫（不外洩他組庫）。
   */
  linkedToProject: authedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, input.projectId));
      if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "找不到專案" });
      requireGroup(ctx.auth, project.groupId);
      const tables = await listVisibleTables(ctx.auth);
      // 只看「有 project 型別欄位」的可見庫
      const relevant = tables
        .map((t) => ({ table: t, projectFields: (t.fields as DataField[]).filter((f) => f.type === "project") }))
        .filter((x) => x.projectFields.length > 0);
      if (relevant.length === 0) return [];
      // 每個庫的 project 欄 key 不同；在 PostgreSQL 組成「tableId + JSON 欄位值」條件，只把命中列
      // 傳回 Node。舊版先載入全部可見列再過濾，庫一多時可一次吃進數十萬列與大量 JSON。
      const allRows = await findProjectLinkedRows(
        input.projectId,
        relevant.map(({ table, projectFields }) => ({
          tableId: table.id,
          fieldKeys: projectFields.map((field) => field.key),
        })),
      );
      const rowsByTable = new Map<string, Array<{ id: string; data: DataRowData }>>();
      for (const row of allRows) {
        const bucket = rowsByTable.get(row.tableId) ?? [];
        bucket.push({ id: row.id, data: row.data as DataRowData });
        rowsByTable.set(row.tableId, bucket);
      }
      const out: Array<{
        tableId: string;
        tableName: string;
        fields: DataField[];
        rows: Array<{ id: string; data: DataRowData }>;
        /** AI 對此庫的存取（與 databaseAcl.agentAccess 同字） */
        agentAccess: "none" | "read" | "write";
      }> = [];
      for (const { table } of relevant) {
        const matched = rowsByTable.get(table.id) ?? [];
        if (matched.length) {
          out.push({
            tableId: table.id,
            tableName: table.name,
            fields: table.fields as DataField[],
            rows: matched,
            agentAccess: (table.agentAccess as "none" | "read" | "write") ?? "write",
          });
        }
      }
      return out;
    }),

  /**
   * 一鍵：為本專案建立已關聯的組資料表——預設組範圍、含專案連結欄、一筆範例列指向本專案。
   * 不碰 #133 plan/notes；只走 databaseAcl + databaseCore。
   */
  createBoundToProject: authedProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      template: z.enum(PROJECT_DATA_TEMPLATE_IDS),
      /** 可覆寫預設表名 */
      name: z.string().min(1).max(80).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, input.projectId));
      if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "找不到專案" });
      requireGroup(ctx.auth, project.groupId);
      assertProjectNotArchived(project);
      // 組員可建組庫；canCreateIn 會擋無權者
      const denied = canCreateIn(ctx.auth, "group", project.groupId, undefined);
      if (denied) throw new TRPCError({ code: "FORBIDDEN", message: denied });

      const tpl = getProjectDataTemplate(input.template as ProjectDataTemplateId);
      const { fields, sampleData } = buildBoundTableFields(input.template as ProjectDataTemplateId);
      const fieldError = validateFields(fields);
      if (fieldError) throw new TRPCError({ code: "BAD_REQUEST", message: fieldError });

      const tableName = (input.name?.trim() || `${tpl.defaultName}`).slice(0, 80);
      const [table] = await db
        .insert(schema.dataTables)
        .values({
          scope: "group",
          ownerId: null,
          groupId: project.groupId,
          teamId: null,
          name: tableName,
          description: `由專案「${project.title}」一鍵建立 · ${tpl.hint}`,
          fields,
          memberWritable: true,
          // 預設：AI 可讀可寫回此表（仍受本人 ACL 限制）；敏感表可事後在資料庫頁改
          agentAccess: "write",
          createdBy: ctx.auth.user.id,
        })
        .returning();

      try {
        await addDataRowValidated(table, ctx.auth.user.id, sampleData(input.projectId));
      } catch (err) {
        // 表已建、範例列失敗仍回表——使用者可手動加列
        console.warn("[databases.createBoundToProject] sample row failed:", err instanceof Error ? err.message : err);
      }
      return { tableId: table.id, tableName: table.name, template: input.template };
    }),

  /**
   * 多格式資料匯入（連接 Excel／Google 試算表／其他資料庫或 API 的匯出檔）：
   * 支援 CSV／TSV（另存分隔值）與 JSON（物件陣列）；headerMap 把來源表頭／key 對應到欄位 key，
   * 逐列走與手動新增同一套驗證與保險絲。部分列驗證失敗不整批中止——回「成功幾列、失敗哪幾列為什麼」，
   * 讓使用者修完再補匯入。（原 importCsv 已併入此路徑，format 預設 csv 相容舊呼叫。）
   */
  importData: authedProcedure
    .input(z.object({
      tableId: z.string().uuid(),
      content: z.string().min(1).max(1_500_000), // 留餘裕給 JSON 包裝，不撞 express.json 的 2MB 上限
      format: z.enum(["csv", "tsv", "json"]).default("csv"),
      headerMap: z.record(z.string()), // 來源表頭（CSV/TSV）或 JSON key → 欄位 key
      idempotencyKey: z.string()
        .min(IDEMPOTENCY_KEY_MIN_LENGTH)
        .max(IDEMPOTENCY_KEY_MAX_LENGTH)
        .regex(
          IDEMPOTENCY_KEY_PATTERN,
          "冪等鍵格式無效：僅可使用英數字、點、底線、冒號與連字號",
        ),
    }))
    .mutation(async ({ ctx, input }) => {
      const { table, access } = await getTableChecked(ctx.auth, input.tableId);
      if (!access.canWriteRows) throw new TRPCError({ code: "FORBIDDEN", message: "這個資料庫目前只開放管理者寫入" });
      let objs: Array<{ data: Record<string, string>; line: number }>;
      try {
        objs = tabularToRowObjects(input.content, input.format as TabularFormat, input.headerMap);
      } catch (err) {
        // JSON 解析失敗等：以人話回報而非 500
        throw new TRPCError({ code: "BAD_REQUEST", message: err instanceof Error ? err.message : "資料解析失敗" });
      }
      if (objs.length === 0) {
        const fmtLabel = TABULAR_FORMATS.find((f) => f.id === input.format)?.label ?? "資料";
        throw new TRPCError({ code: "BAD_REQUEST", message: `沒有可匯入的資料列（確認 ${fmtLabel} 有表頭／欄位＋至少一列資料，且已對應欄位）` });
      }
      const MAX_IMPORT = 5000;
      const slice = objs.slice(0, MAX_IMPORT); // 只嘗試前 MAX_IMPORT 列
      let batch;
      try {
        batch = await executeIdempotentDatabaseBatch({
          table,
          actorId: ctx.auth.user.id,
          rawRows: slice.map((item) => item.data),
          idempotencyKey: input.idempotencyKey,
          requestPayload: {
            operation: "databases.importData",
            tableId: input.tableId,
            content: input.content,
            format: input.format,
            headerMap: input.headerMap,
          },
        });
      } catch (err) {
        if (err instanceof IdempotencyConflictError) {
          throw new TRPCError({ code: "CONFLICT", message: err.message });
        }
        throw err;
      }
      const errors = batch.errors.map((error) => ({
        line: slice[error.index]?.line ?? error.index + 1,
        error: error.error,
      }));
      // failed 只算「嘗試過但失敗」的列；被 MAX_IMPORT 截斷、從未嘗試的列另以 skipped 標示（不混入 failed 誤導）
      return {
        imported: batch.insertedCount,
        failed: batch.failed,
        skipped: (objs.length - slice.length) + batch.skipped,
        truncated: objs.length > MAX_IMPORT,
        errors,
        replayed: batch.replayed,
      };
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

  /* ── 文件層（AI 可讀的檔案）───────────────────── */

  /** 文件清單（不回全文省流量：字數與 300 字摘錄都在 SQL 端算，200 份長文不整批進記憶體）＋我的配額用量 */
  listFiles: authedProcedure.input(z.object({ tableId: z.string().uuid() })).query(async ({ ctx, input }) => {
    const { table } = await getTableChecked(ctx.auth, input.tableId);
    const rows = await db
      .select({
        id: schema.dataFiles.id,
        name: schema.dataFiles.name,
        mime: schema.dataFiles.mime,
        sizeBytes: schema.dataFiles.sizeBytes,
        storagePath: schema.dataFiles.storagePath,
        sourceUrl: schema.dataFiles.sourceUrl,
        readableChars: sql<number>`coalesce(length(${schema.dataFiles.textContent}), 0)`,
        excerpt: sql<string | null>`left(${schema.dataFiles.textContent}, 300)`,
        category: schema.dataFiles.category,
        aiDescription: schema.dataFiles.aiDescription,
        uploadedBy: schema.dataFiles.uploadedBy,
        uploaderName: schema.users.name,
        createdAt: schema.dataFiles.createdAt,
      })
      .from(schema.dataFiles)
      .leftJoin(schema.users, eq(schema.users.id, schema.dataFiles.uploadedBy))
      .where(eq(schema.dataFiles.tableId, table.id))
      .orderBy(desc(schema.dataFiles.createdAt))
      .limit(200);
    const [usedBytes, quotaBytes] = await Promise.all([userFileUsage(ctx.auth.user.id), fileQuotaBytes()]);
    return {
      files: rows.map((f) => ({
        id: f.id,
        name: f.name,
        mime: f.mime,
        kind: mediaKindOf(f.mime),
        sizeBytes: f.sizeBytes,
        hasFile: !!f.storagePath,
        sourceUrl: f.sourceUrl,
        readableChars: Number(f.readableChars),
        excerpt: f.excerpt,
        category: f.category,
        aiDescription: f.aiDescription,
        uploadedBy: f.uploadedBy,
        uploaderName: f.uploaderName ?? "?",
        createdAt: f.createdAt,
      })),
      quota: { usedBytes, quotaBytes }, // quotaBytes null＝不限
    };
  }),

  /** 全文讀取（前端預覽與複製用；AI 走 MCP read_database_file） */
  getFileText: authedProcedure
    .input(z.object({ id: z.string().uuid(), offset: z.number().int().min(0).optional() }))
    .query(async ({ ctx, input }) => {
      const { file } = await getFileChecked(ctx.auth, input.id); // 讀取權即可
      const text = file.textContent ?? "";
      const offset = input.offset ?? 0;
      const CHUNK = 20_000;
      return { name: file.name, totalChars: text.length, offset, text: text.slice(offset, offset + CHUNK) };
    }),

  /**
   * 網址匯入：Google 文件/試算表/簡報/雲端硬碟公開連結、Notion（官方 API）、一般網頁。
   * 內容抓回伺服器抽純文字（HTML 轉純文字；二進位如 PDF 落地 Volume 再抽）——AI 之後讀 textContent。
   */
  importUrl: authedProcedure
    .input(z.object({
      tableId: z.string().uuid(),
      url: z.string().min(1).max(2000),
      name: z.string().max(120).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { table, access } = await getTableChecked(ctx.auth, input.tableId);
      if (!access.canWriteRows) throw new TRPCError({ code: "FORBIDDEN", message: "這個資料庫目前只開放管理者寫入" });
      const ssrf = ssrfGuardError(input.url);
      if (ssrf) throw new TRPCError({ code: "BAD_REQUEST", message: ssrf });
      const normalized = normalizeImportUrl(input.url);

      // Notion：官方 API 抽文字（不落地原檔）。token 優先用「操作者自己的」（整合連接頁設定）→ 站方 NOTION_TOKEN
      if (normalized.kind === "notion") {
        const pageId = notionPageIdFromUrl(input.url);
        if (!pageId) throw new TRPCError({ code: "BAD_REQUEST", message: "看不出這個 Notion 網址的頁面 id——請貼「複製連結」取得的完整頁面網址" });
        let text: string;
        try {
          text = await fetchNotionText(pageId, await getNotionToken(ctx.auth.user.id));
        } catch (err) {
          throw new TRPCError({ code: "BAD_REQUEST", message: err instanceof Error ? err.message : "Notion 匯入失敗" });
        }
        const sizeBytes = Buffer.byteLength(text, "utf8");
        const quotaErr = await quotaGuardError(ctx.auth.user.id, sizeBytes);
        if (quotaErr) throw new TRPCError({ code: "PRECONDITION_FAILED", message: quotaErr });
        const [row] = await db.insert(schema.dataFiles).values({
          tableId: table.id,
          name: (input.name?.trim() || "Notion 頁面").slice(0, 120),
          mime: "text/plain",
          sizeBytes,
          sourceUrl: input.url,
          textContent: text,
          uploadedBy: ctx.auth.user.id,
        }).returning();
        return { id: row.id, readableChars: text.length };
      }

      // Google／一般網址：Google 連結先試「操作者自己的 Google 授權」抓私有檔（整合連接頁連結後生效），
      // 沒連結或抓不到再退回原本的公開連結路徑——兩邊都失敗才報錯，且錯誤訊息帶清楚的下一步。
      let fetched: { buf: Buffer; mime: string };
      let driveNoAccess: string | null = null; // 已連結 Google 但該帳戶無此檔權限（給更準的人話）
      let driveName: string | null = null;
      const privateTried = normalized.kind !== "web" && !!normalized.fileId; // fileId 只在 google-* 有值
      const priv = privateTried
        ? await fetchDriveFile(ctx.auth.user.id, normalized.kind as "google-doc" | "google-sheet" | "google-slides" | "google-drive", normalized.fileId!)
        : null;
      if (priv?.ok) {
        fetched = { buf: priv.buf, mime: priv.mime };
        driveName = priv.name;
      } else {
        if (priv && !priv.ok && priv.reason === "no-access") driveNoAccess = priv.message;
        try {
          fetched = await fetchImport(normalized.fetchUrl);
        } catch (err) {
          throw new TRPCError({ code: "BAD_REQUEST", message: err instanceof Error ? err.message : "抓取失敗" });
        }
      }
      // 期望匯出文字（Google 文件/試算表/簡報）卻拿到 HTML＝多半是私有檔轉跳登入頁——給人話與下一步。
      // 只在「公開退回路徑」檢查（個人授權成功抓到的內容不可能是登入頁——雲端裡真正的 HTML 檔要照常匯入）；
      // google-drive 一般檔維持舊行為（HTML 檔轉純文字匯入），不誤殺。
      const expectsExport = normalized.kind === "google-doc" || normalized.kind === "google-sheet" || normalized.kind === "google-slides";
      if (expectsExport && !priv?.ok && fetched.mime === "text/html") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: driveNoAccess
            ? `${driveNoAccess}，且檔案未開放公開存取——請在 Google 端把檔案共用給該帳戶，或把共用設成「任何人知道連結都能檢視」`
            : "Google 回了登入頁——把該文件的共用設成「任何人知道連結都能檢視」，或到「整合連接」頁連結你的 Google 帳戶後即可匯入私有檔",
        });
      }
      const quotaErr = await quotaGuardError(ctx.auth.user.id, fetched.buf.length);
      if (quotaErr) throw new TRPCError({ code: "PRECONDITION_FAILED", message: quotaErr });

      const rawLastSegment = new URL(normalized.fetchUrl).pathname.split("/").filter(Boolean).pop() ?? "匯入文件";
      // decodeURIComponent 對含裸 % 的路徑會拋 URIError——解不開就用原字串，不讓匯入整個 500
      let fallbackName: string;
      try {
        fallbackName = decodeURIComponent(rawLastSegment);
      } catch {
        fallbackName = rawLastSegment;
      }
      // Drive API 路徑抓得到真實檔名——比網址片段（uc、export…）好得多
      if (driveName) fallbackName = driveName;
      const name = (input.name?.trim() || fallbackName || "匯入文件").slice(0, 120) + (normalized.suggestedExt && !/\.[a-z0-9]+$/i.test(input.name?.trim() || fallbackName) ? normalized.suggestedExt : "");

      // 純網頁：不落地原檔，直接抽文字（HTML 存起來沒有重看價值）
      if (fetched.mime === "text/html") {
        const text = htmlToText(fetched.buf.toString("utf8")).slice(0, MAX_TEXT_CHARS);
        if (!text) throw new TRPCError({ code: "BAD_REQUEST", message: "這個網頁抓不到可讀文字（可能是純前端渲染的頁面）——試試該平台的匯出功能後上傳" });
        const sizeBytes = Buffer.byteLength(text, "utf8");
        const [row] = await db.insert(schema.dataFiles).values({
          tableId: table.id, name, mime: "text/plain", sizeBytes,
          sourceUrl: input.url, textContent: text, uploadedBy: ctx.auth.user.id,
        }).returning();
        return { id: row.id, readableChars: text.length };
      }

      // 其他格式（txt/csv/pdf/docx…）：原檔落地＋抽文字
      const disk = await checkDiskSpace(fetched.buf.length);
      if (disk) throw new TRPCError({ code: "PRECONDITION_FAILED", message: disk });
      const text = await extractTextFromBuffer(fetched.mime, name, fetched.buf);
      const saved = await saveBuffer(fetched.buf, fetched.mime);
      try {
        const [row] = await db.insert(schema.dataFiles).values({
          tableId: table.id, name, mime: fetched.mime, sizeBytes: saved.sizeBytes,
          storagePath: saved.storagePath, sourceUrl: input.url, textContent: text, uploadedBy: ctx.auth.user.id,
        }).returning();
        return { id: row.id, readableChars: text?.length ?? 0 };
      } catch (dbErr) {
        await removeStoredFile(saved.storagePath); // DB 失敗清孤兒檔
        throw dbErr;
      }
    }),

  /**
   * 重新整理：網址匯入的文件重抓來源、更新 textContent（來源文件改了就按這顆）。
   * sizeBytes 語意與 importUrl 完全一致：Notion/網頁＝文字位元數、二進位＝原檔大小；
   * 二進位來源會重新落地新檔並刪舊檔（原檔與抽出文字同步更新，不再各說各話）。
   */
  refreshFile: authedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const { file, access } = await getFileChecked(ctx.auth, input.id);
    if (!file.sourceUrl) throw new TRPCError({ code: "BAD_REQUEST", message: "這份文件是上傳檔，沒有可重抓的來源網址" });
    if (!access.canWriteRows) throw new TRPCError({ code: "FORBIDDEN", message: "這個資料庫目前只開放管理者寫入" });
    const ssrf = ssrfGuardError(file.sourceUrl);
    if (ssrf) throw new TRPCError({ code: "BAD_REQUEST", message: ssrf });
    const normalized = normalizeImportUrl(file.sourceUrl);
    try {
      let text: string | null;
      let sizeBytes: number;
      let newStoragePath: string | null | undefined; // undefined＝不動、null/字串＝覆寫
      if (normalized.kind === "notion") {
        const pageId = notionPageIdFromUrl(file.sourceUrl);
        if (!pageId) throw new Error("Notion 頁面 id 解析失敗");
        // token 按「重抓者」查（與配額同口徑）——不是原匯入者
        text = await fetchNotionText(pageId, await getNotionToken(ctx.auth.user.id));
        sizeBytes = Buffer.byteLength(text, "utf8");
      } else {
        // Google 來源先試重抓者自己的 Google 授權（可重抓私有檔），失敗退回公開路徑
        let fetched: { buf: Buffer; mime: string };
        const priv = normalized.kind !== "web" && normalized.fileId
          ? await fetchDriveFile(ctx.auth.user.id, normalized.kind as "google-doc" | "google-sheet" | "google-slides" | "google-drive", normalized.fileId)
          : null;
        if (priv?.ok) {
          fetched = { buf: priv.buf, mime: priv.mime };
        } else {
          fetched = await fetchImport(normalized.fetchUrl);
        }
        // Google 文件/試算表/簡報在「公開退回路徑」拿到 HTML＝登入頁（來源被改成私有）——
        // 報錯而非把登入頁當內容「覆蓋掉」既有文字。個人授權成功（priv.ok）與 google-drive
        // 一般檔（HTML 檔轉純文字是既有行為）都不在此判定內，不誤殺。
        const expectsExport = normalized.kind === "google-doc" || normalized.kind === "google-sheet" || normalized.kind === "google-slides";
        if (expectsExport && !priv?.ok && fetched.mime === "text/html") {
          throw new Error(
            priv && !priv.ok && priv.reason === "no-access"
              ? `${priv.message}，且檔案未開放公開存取——請調整 Google 端共用設定後再重新整理`
              : "Google 回了登入頁（來源可能已改為私有）——調整共用設定，或到「整合連接」頁連結你的 Google 帳戶後再重新整理",
          );
        }
        if (fetched.mime === "text/html") {
          text = htmlToText(fetched.buf.toString("utf8")).slice(0, MAX_TEXT_CHARS);
          sizeBytes = Buffer.byteLength(text, "utf8"); // 與 importUrl 同口徑：網頁只算文字，不算原始 HTML
          newStoragePath = null; // 網頁匯入不留原檔
        } else {
          text = await extractTextFromBuffer(fetched.mime, file.name, fetched.buf);
          sizeBytes = fetched.buf.length;
          const disk = await checkDiskSpace(fetched.buf.length);
          if (disk) throw new Error(disk);
          const saved = await saveBuffer(fetched.buf, fetched.mime);
          newStoragePath = saved.storagePath;
        }
      }
      // 配額以「增量」把關：重抓變大才需要空間
      const delta = Math.max(0, sizeBytes - file.sizeBytes);
      const quotaErr = delta > 0 ? await quotaGuardError(ctx.auth.user.id, delta) : null;
      if (quotaErr) {
        if (typeof newStoragePath === "string") await removeStoredFile(newStoragePath); // 新檔已落地就清掉
        throw new Error(quotaErr);
      }
      await db.update(schema.dataFiles)
        .set({ textContent: text, sizeBytes, ...(newStoragePath !== undefined ? { storagePath: newStoragePath } : {}) })
        .where(eq(schema.dataFiles.id, file.id));
      // 換了新檔才刪舊檔（DB 已指向新檔，舊檔成孤兒）
      if (newStoragePath !== undefined && file.storagePath && file.storagePath !== newStoragePath) {
        await removeStoredFile(file.storagePath);
      }
      return { ok: true, readableChars: text?.length ?? 0 };
    } catch (err) {
      throw new TRPCError({ code: "BAD_REQUEST", message: err instanceof Error ? err.message : "重新整理失敗" });
    }
  }),

  /** 刪文件：上傳者本人或資料庫管理者；連 Volume 原檔一併刪（配額即時釋放） */
  removeFile: authedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const { file, access } = await getFileChecked(ctx.auth, input.id);
    if (!access.canManage && file.uploadedBy !== ctx.auth.user.id) {
      throw new TRPCError({ code: "FORBIDDEN", message: "只有上傳者本人或資料庫管理者可以刪除文件" });
    }
    await db.delete(schema.dataFiles).where(eq(schema.dataFiles.id, file.id));
    if (file.storagePath) await removeStoredFile(file.storagePath);
    return { ok: true };
  }),

  /* ── 圖影分類與資訊量 ───────────────────────── */

  /** 手動分類／描述編輯（圖影與一般文件皆可）：category 空字串＝清除分類 */
  setFileMeta: authedProcedure
    .input(z.object({
      id: z.string().uuid(),
      category: z.string().max(MAX_FILE_CATEGORY).nullable().optional(),
      aiDescription: z.string().max(2000).nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { file, access } = await getFileChecked(ctx.auth, input.id);
      if (!access.canWriteRows) throw new TRPCError({ code: "FORBIDDEN", message: "這個資料庫目前只開放管理者寫入" });
      const patch: Partial<{ category: string | null; aiDescription: string | null }> = {};
      if (input.category !== undefined) patch.category = normalizeFileCategory(input.category);
      if (input.aiDescription !== undefined) patch.aiDescription = input.aiDescription?.trim() || null;
      if (Object.keys(patch).length === 0) return { ok: true, category: file.category, aiDescription: file.aiDescription };
      const [updated] = await db.update(schema.dataFiles).set(patch).where(eq(schema.dataFiles.id, file.id)).returning();
      return { ok: true, category: updated.category, aiDescription: updated.aiDescription };
    }),

  /**
   * AI 看圖分類（圖片限定）：視覺模型產生繁中描述＋自動歸類——圖影從「僅存檔」變 AI 可讀可答。
   * 計費走點數守門（預設 1 點；E2E_MOCK 不扣點回確定性結果）。
   */
  classifyFile: authedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const { file, table, access } = await getFileChecked(ctx.auth, input.id);
    if (!access.canWriteRows) throw new TRPCError({ code: "FORBIDDEN", message: "這個資料庫目前只開放管理者寫入" });
    try {
      return await classifyDatabaseFile(ctx.auth, file, table);
    } catch (err) {
      throw new TRPCError({ code: "BAD_REQUEST", message: err instanceof Error ? err.message : "看圖分類失敗" });
    }
  }),

  /** 資訊量統計：列數／文件數／圖影音文分佈／容量／AI 可讀字數／分類分佈（讀取權即可） */
  stats: authedProcedure.input(z.object({ tableId: z.string().uuid() })).query(async ({ ctx, input }) => {
    const { table } = await getTableChecked(ctx.auth, input.tableId);
    return tableStats(table);
  }),

  /**
   * 把資料庫文件送進專案素材庫（資料庫 × 專案系統的檔案級串接）：
   * 實體複製一份到素材儲存（兩邊生命週期獨立，任一邊刪除不影響另一邊），
   * 分類帶進素材 tags、來源記在 meta 供回溯。權限＝文件讀取權 ＋ 專案可編輯（組隔離＋2.3 檢視者擋）。
   */
  sendFileToProject: authedProcedure
    .input(z.object({ fileId: z.string().uuid(), projectId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { file } = await getFileChecked(ctx.auth, input.fileId);
      if (!file.storagePath) throw new TRPCError({ code: "BAD_REQUEST", message: "這份文件沒有原始檔案（純文字匯入）——素材庫收的是實體檔" });
      const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, input.projectId));
      if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "找不到專案" });
      requireGroup(ctx.auth, project.groupId);
      assertProjectNotArchived(project);
      await assertProjectEditable(ctx.auth, project);
      const disk = await checkDiskSpace(file.sizeBytes);
      if (disk) throw new TRPCError({ code: "PRECONDITION_FAILED", message: disk });
      const copied = await copyStoredFile(file.storagePath, file.mime);
      try {
        const [asset] = await db
          .insert(schema.assets)
          .values({
            projectId: project.id,
            groupId: project.groupId,
            kind: kindFromMime(file.mime),
            title: file.name.slice(0, 80),
            url: "", // 佔位，下一步以 id 回填服務網址（與 /api/upload 同手法）
            tags: file.category ? [file.category] : [],
            isAiGenerated: false,
            storagePath: copied.storagePath,
            mime: file.mime,
            sizeBytes: copied.sizeBytes,
            uploadedBy: ctx.auth.user.id,
            meta: { fromDatabaseFileId: file.id, ...(file.aiDescription ? { aiDescription: file.aiDescription } : {}) },
          })
          .returning();
        const [updated] = await db
          .update(schema.assets)
          .set({ url: `/api/assets/${asset.id}/file` })
          .where(eq(schema.assets.id, asset.id))
          .returning();
        return { assetId: updated.id, title: updated.title, projectTitle: project.title };
      } catch (dbErr) {
        await removeStoredFile(copied.storagePath); // DB 失敗清孤兒複本
        throw dbErr;
      }
    }),
});
