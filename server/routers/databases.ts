import { z } from "zod";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure, requireGroup } from "../trpc";
import { db, schema } from "../db";
import { validateFields, validateRowData, type DataField, type DataRowData } from "../../shared/databaseFields";
import { canCreateIn, listVisibleTables, resolveTableAccess, type DataTableRow } from "../services/databaseAcl";
import { addDataRowValidated } from "../services/databaseCore";
import { csvToRowObjects } from "../../shared/csv";
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
import { checkDiskSpace, removeStoredFile, saveBuffer } from "../services/storage";

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
  type: z.enum(["text", "number", "select", "date", "checkbox", "url", "user", "project", "schedule"]),
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
      try {
        return await addDataRowValidated(table, ctx.auth.user.id, input.data);
      } catch (err) {
        throw new TRPCError({ code: "BAD_REQUEST", message: err instanceof Error ? err.message : "新增失敗" });
      }
    }),

  /**
   * 連結到某專案的資料列（專案 × 資料庫細部連結）：掃「這個專案所屬組」可見的資料庫中，
   * 任一 project 型別欄位的值等於此 projectId 的列——讓專案頁一眼看到「哪些資料表提到我」
   * （例：器材借用表裡指派給本片的器材、任務表裡本片的待辦）。
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
      const tableIds = relevant.map((x) => x.table.id);
      // 一次撈這些庫的全部列，JS 端過濾「任一 project 欄 === projectId」（列量受 20k/庫 保險絲約束）
      const allRows = await db
        .select({ id: schema.dataRows.id, tableId: schema.dataRows.tableId, data: schema.dataRows.data })
        .from(schema.dataRows)
        .where(inArray(schema.dataRows.tableId, tableIds));
      const out: Array<{ tableId: string; tableName: string; fields: DataField[]; rows: Array<{ id: string; data: DataRowData }> }> = [];
      for (const { table, projectFields } of relevant) {
        const matched = allRows
          .filter((r) => r.tableId === table.id)
          .filter((r) => projectFields.some((f) => (r.data as DataRowData)?.[f.key] === input.projectId))
          .map((r) => ({ id: r.id, data: r.data as DataRowData }));
        if (matched.length) out.push({ tableId: table.id, tableName: table.name, fields: table.fields as DataField[], rows: matched });
      }
      return out;
    }),

  /**
   * CSV 匯入（連接 Excel／Google 試算表／其他資料庫的匯出檔）：
   * headerMap 把 CSV 表頭對應到欄位 key，逐列走與手動新增同一套驗證與保險絲。
   * 部分列驗證失敗不整批中止——回「成功幾列、失敗哪幾列為什麼」，讓使用者修完再補匯入。
   */
  importCsv: authedProcedure
    .input(z.object({
      tableId: z.string().uuid(),
      csv: z.string().min(1).max(1_500_000), // 留餘裕給 JSON 包裝，不撞 express.json 的 2MB 上限
      headerMap: z.record(z.string()), // CSV 表頭 → 欄位 key
    }))
    .mutation(async ({ ctx, input }) => {
      const { table, access } = await getTableChecked(ctx.auth, input.tableId);
      if (!access.canWriteRows) throw new TRPCError({ code: "FORBIDDEN", message: "這個資料庫目前只開放管理者寫入" });
      const objs = csvToRowObjects(input.csv, input.headerMap);
      if (objs.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "沒有可匯入的資料列（確認 CSV 有表頭列＋至少一列資料，且已對應欄位）" });
      const MAX_IMPORT = 5000;
      const slice = objs.slice(0, MAX_IMPORT); // 只嘗試前 MAX_IMPORT 列
      let imported = 0;
      let attempted = 0;
      const errors: Array<{ line: number; error: string }> = [];
      for (const { data, line } of slice) {
        attempted++;
        try {
          await addDataRowValidated(table, ctx.auth.user.id, data);
          imported++;
        } catch (err) {
          if (errors.length < 50) errors.push({ line, error: err instanceof Error ? err.message : "未知錯誤" }); // line＝CSV 實體行號
          // 達列數上限即停（addDataRowValidated 會拋保險絲訊息）
          if (err instanceof Error && err.message.includes("列上限")) break;
        }
      }
      // failed 只算「嘗試過但失敗」的列；被 MAX_IMPORT 截斷、從未嘗試的列另以 skipped 標示（不混入 failed 誤導）
      return { imported, failed: attempted - imported, skipped: objs.length - attempted, truncated: objs.length > MAX_IMPORT, errors };
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
        sizeBytes: f.sizeBytes,
        hasFile: !!f.storagePath,
        sourceUrl: f.sourceUrl,
        readableChars: Number(f.readableChars),
        excerpt: f.excerpt,
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

      // Notion：官方 API 抽文字（不落地原檔）
      if (normalized.kind === "notion") {
        const pageId = notionPageIdFromUrl(input.url);
        if (!pageId) throw new TRPCError({ code: "BAD_REQUEST", message: "看不出這個 Notion 網址的頁面 id——請貼「複製連結」取得的完整頁面網址" });
        let text: string;
        try {
          text = await fetchNotionText(pageId);
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

      // Google／一般網址：抓回內容
      let fetched: Awaited<ReturnType<typeof fetchImport>>;
      try {
        fetched = await fetchImport(normalized.fetchUrl);
      } catch (err) {
        throw new TRPCError({ code: "BAD_REQUEST", message: err instanceof Error ? err.message : "抓取失敗" });
      }
      // 期望匯出文字（Google 文件/試算表/簡報）卻拿到 HTML＝多半是私有檔轉跳登入頁——給人話
      if (normalized.kind.startsWith("google-") && normalized.kind !== "google-drive" && fetched.mime === "text/html") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Google 回了登入頁——請把該文件的共用設成「任何人知道連結都能檢視」再匯入",
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
        text = await fetchNotionText(pageId);
        sizeBytes = Buffer.byteLength(text, "utf8");
      } else {
        const fetched = await fetchImport(normalized.fetchUrl);
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
});
