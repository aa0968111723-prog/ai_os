/**
 * 資料庫對外連接層（本機腳本／手機 App／其他系統）：
 *  1) REST API v1（/api/v1/databases…）：以個人 MCP 金鑰（x-api-key）認證的 JSON HTTP 介面，
 *     任何能發 HTTP 的客戶端（curl、行動 App、試算表 Apps Script、其他資料庫的 ETL）都能連。
 *  2) CSV 匯出（/api/databases/:id/rows.csv）：接 Excel／Google 試算表／匯進其他資料庫。
 *  3) 行事曆訂閱（/api/databases/:id/calendar.ics）：把有日期欄位的資料庫訂到手機/桌面日曆。
 *
 * 權限一律沿用既有單一真相：
 *  - 認證：session cookie（網頁）或個人 MCP 金鑰（外部），都解析成同一個 AuthState。
 *  - 授權：resolveTableAccess / resolveAgentAccess（金鑰＝AI 介面，套 agentAccess 收斂）。
 * 無讀取權一律回 404（不洩漏存在性），與 tRPC/MCP 同口徑。
 */
import type { Request, Response } from "express";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { resolveSession, type AuthState } from "./auth";
import { resolveMcpIdentity } from "./mcpAuth";
import { listVisibleTables, resolveAgentAccess, resolveTableAccess } from "./databaseAcl";
import { addDataRowValidated } from "./databaseCore";
import {
  databaseBatchWriteDenied,
  parseDatabaseBatchRows,
} from "./databaseBatchApi";
import {
  executeIdempotentDatabaseBatch,
  IdempotencyConflictError,
  InvalidIdempotencyKeyError,
  parseIdempotencyKey,
} from "./databaseBatchIdempotency";
import {
  escapeLikeLiteral,
  normalizeDatabaseSearchKeyword,
} from "./databaseRowSearch";
import { toCsv } from "../../shared/csv";
import { buildIcs } from "../routers/schedule";
import type { DataField, DataRowData } from "../../shared/databaseFields";

/**
 * 解析請求身分：優先個人 MCP 金鑰（x-api-key 標頭或 ?key= 查詢字串），再退回 session cookie。
 * viaToken=true 表示「AI／程式介面」——授權時套 agentAccess 收斂（金鑰不該比網頁看到更多）。
 */
async function resolveRequester(req: Request): Promise<{ auth: AuthState; viaToken: boolean; readOnly: boolean } | null> {
  const headerKey = req.headers["x-api-key"];
  // ?key= 只在 GET 放行：手機日曆訂閱（.ics）／CSV 匯出等唯讀端點無法帶自訂標頭，才需查詢字串金鑰。
  // 「寫入」端點（POST /rows）一律要走 x-api-key 標頭——否則具寫入權的個人金鑰會被寫進反代存取記錄／
  // 瀏覽器歷史／Referer，任何讀得到那些記錄的人都能重放它以受害者身分寫資料。
  const queryKey = req.method === "GET" && typeof req.query.key === "string" ? req.query.key : undefined;
  const fromQuery = !headerKey && !!queryKey; // 純由 ?key= 帶入（非標頭）
  const provided = (typeof headerKey === "string" && headerKey) || queryKey;
  if (provided) {
    const identity = await resolveMcpIdentity(provided);
    if (!identity) return null;
    // 經 ?key= 網址呈現的金鑰一律降為唯讀（緩解 query-key-not-readonly-scoped）：訂閱網址（.ics/.csv）會被
    // 日曆 App／反代存取記錄／瀏覽器歷史保存並反覆重送——即使金鑰本身可寫，從網址帶入時也只授予唯讀，
    // 確保 ?key= 這條路徑永遠碰不到寫入（現有訂閱／匯出端點皆為 GET 唯讀，故不影響功能）。
    // 註：這無法阻止「金鑰外洩後被改用 x-api-key 標頭重放為寫入」——徹底根治需為訂閱／匯出另發「天生唯讀」
    //     的作用域金鑰並在 UI 引導使用（後續 UX 工作），此處先做不破壞現況的縱深防禦。
    // readOnly 金鑰範圍必須一路帶到寫入端點——否則唯讀金鑰能繞過 MCP 的 scopeDeniedReason
    // 守衛，改走 REST POST /rows 寫入資料（MCP 擋、REST 卻放行的不一致提權）。
    return { auth: identity.auth, viaToken: true, readOnly: identity.scope.readOnly || fromQuery };
  }
  const auth = await resolveSession(req);
  if (!auth) return null;
  // 強制改密碼閘門（修 rest-session-skips-mustchangepassword）：與 tRPC authedProcedure、MCP 金鑰路徑同口徑——
  // 管理員重設密碼後帳號帶 mustChangePassword，未改密碼前不得經 REST/CSV/ICS 讀寫，否則臨時密碼窗口=完整讀寫窗口。
  if (auth.user.mustChangePassword) return null;
  // session（純網頁登入）沒有唯讀概念，一律非唯讀
  return { auth, viaToken: false, readOnly: false };
}

/** 依 viaToken 選對的授權函式（程式介面套 agentAccess；網頁走純人權限） */
function accessFor(auth: AuthState, viaToken: boolean, table: Parameters<typeof resolveAgentAccess>[1]) {
  return viaToken ? resolveAgentAccess(auth, table) : resolveTableAccess(auth, table);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 取一張讀得到的表（無讀取權回 null＝呼叫端一律回 404 不洩漏存在性） */
async function readableTable(auth: AuthState, viaToken: boolean, tableId: string) {
  if (!UUID_RE.test(tableId)) return null;
  const [table] = await db.select().from(schema.dataTables).where(and(eq(schema.dataTables.id, tableId), isNull(schema.dataTables.deletedAt)));
  if (!table) return null;
  const access = accessFor(auth, viaToken, table);
  if (!access.canRead) return null;
  return { table, access };
}

/* ── REST API v1（JSON） ─────────────────────────── */

/** GET /api/v1/databases — 列出可存取的資料庫（含欄位定義與列數） */
export async function handleV1ListDatabases(req: Request, res: Response): Promise<void> {
  const who = await resolveRequester(req);
  if (!who) return void res.status(401).json({ error: "需要認證：帶 x-api-key（個人 MCP 金鑰）或先登入" });
  const tables = await listVisibleTables(who.auth);
  const out = tables.flatMap((t) => {
    const access = accessFor(who.auth, who.viaToken, t);
    if (!access.canRead) return [];
    return [{
      id: t.id, name: t.name, scope: t.scope, description: t.description,
      fields: t.fields, rowCount: t.rowCount, canWrite: !who.readOnly && access.canWriteRows,
    }];
  });
  res.json({ databases: out });
}

/** GET /api/v1/databases/:id/rows — 查列（?q= 全文粗篩、?limit=、?offset=） */
export async function handleV1ListRows(req: Request, res: Response): Promise<void> {
  const who = await resolveRequester(req);
  if (!who) return void res.status(401).json({ error: "需要認證：帶 x-api-key（個人 MCP 金鑰）或先登入" });
  const hit = await readableTable(who.auth, who.viaToken, req.params.id);
  if (!hit) return void res.status(404).json({ error: "找不到這個資料庫" });
  const q = normalizeDatabaseSearchKeyword(
    typeof req.query.q === "string" ? req.query.q : "",
  );
  const rawLimit = Number(req.query.limit);
  const rawOffset = Number(req.query.offset);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(Math.trunc(rawLimit), 1), 1000)
    : 200;
  const offset = Number.isFinite(rawOffset)
    ? Math.min(Math.max(Math.trunc(rawOffset), 0), 20_000)
    : 0;
  const conds = [eq(schema.dataRows.tableId, hit.table.id)];
  if (q) conds.push(sql`${schema.dataRows.data}::text ilike ${`%${escapeLikeLiteral(q)}%`} escape ${"\\"}`);
  const rows = await db
    .select({ id: schema.dataRows.id, data: schema.dataRows.data, createdAt: schema.dataRows.createdAt, updatedAt: schema.dataRows.updatedAt })
    .from(schema.dataRows)
    .where(and(...conds))
    .orderBy(desc(schema.dataRows.createdAt))
    .limit(limit).offset(offset);
  res.json({ table: hit.table.name, fields: hit.table.fields, rows });
}

/** POST /api/v1/databases/:id/rows — 新增一列（JSON body: { data: {...} }） */
export async function handleV1AddRow(req: Request, res: Response): Promise<void> {
  const who = await resolveRequester(req);
  if (!who) return void res.status(401).json({ error: "需要認證：帶 x-api-key（個人 MCP 金鑰）或先登入" });
  const hit = await readableTable(who.auth, who.viaToken, req.params.id);
  if (!hit) return void res.status(404).json({ error: "找不到這個資料庫" });
  // 唯讀金鑰一律擋寫入（與 MCP 工具端 scopeDeniedReason 同口徑）
  if (who.readOnly) return void res.status(403).json({ error: "這把金鑰是「唯讀」的——不能新增資料列，請改用可寫入的金鑰" });
  if (!hit.access.canWriteRows) return void res.status(403).json({ error: "沒有寫入權（或此庫的 AI 存取設為唯讀）" });
  const body = req.body as { data?: unknown };
  try {
    const row = await addDataRowValidated(hit.table, who.auth.user.id, body?.data ?? {});
    // REST 寫入補審計（比照 MCP／REST 上傳）：actorId＝金鑰擁有者本人
    void db.insert(schema.auditLog).values({
      actorId: who.auth.user.id, action: "rest.add_database_row", groupId: hit.table.groupId,
      input: { tableId: hit.table.id } as Record<string, unknown>, ok: true,
    }).catch(() => {});
    res.json({ id: row.id, data: row.data });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "新增失敗" });
  }
}

/**
 * POST /api/v1/databases/:id/rows/batch
 * JSON body: { rows: [{ data: {...} }, ...] }（每次 1–500 筆）
 * Header: Idempotency-Key（必填；同一批重試必須沿用）
 *
 * 欄位驗證錯誤以 errors[index] 逐列回報，合法列仍會寫入；資料列與冪等結果在
 * 同一 transaction 提交，資料庫錯誤時整批回滾，不留下半批或 commit gap。
 */
export async function handleV1AddRowsBatch(req: Request, res: Response): Promise<void> {
  const who = await resolveRequester(req);
  if (!who) return void res.status(401).json({ error: "需要認證：帶 x-api-key（個人 MCP 金鑰）或先登入" });
  const hit = await readableTable(who.auth, who.viaToken, req.params.id);
  if (!hit) return void res.status(404).json({ error: "找不到這個資料庫" });

  const denied = databaseBatchWriteDenied(who.readOnly, hit.access.canWriteRows);
  if (denied) return void res.status(403).json({ error: denied });

  let idempotencyKey: string;
  try {
    idempotencyKey = parseIdempotencyKey(req.headers["idempotency-key"]);
  } catch (err) {
    if (err instanceof InvalidIdempotencyKeyError) {
      return void res.status(400).json({ code: err.code, error: err.message });
    }
    throw err;
  }

  let rawRows: unknown[];
  try {
    rawRows = parseDatabaseBatchRows(req.body);
  } catch (err) {
    return void res.status(400).json({
      error: err instanceof Error ? err.message : "批次資料格式不正確",
    });
  }

  try {
    const response = await executeIdempotentDatabaseBatch({
      table: hit.table,
      actorId: who.auth.user.id,
      rawRows,
      idempotencyKey,
    });
    void db.insert(schema.auditLog).values({
      actorId: who.auth.user.id,
      action: "rest.add_database_rows",
      groupId: hit.table.groupId,
      input: {
        tableId: hit.table.id,
        requested: rawRows.length,
        insertedCount: response.insertedCount,
        failed: response.failed,
        replayed: response.replayed,
      } as Record<string, unknown>,
      ok: true,
    }).catch(() => {});
    res.setHeader("Idempotency-Replayed", response.replayed ? "true" : "false");
    res.json(response);
  } catch (err) {
    if (err instanceof IdempotencyConflictError) {
      return void res.status(409).json({ code: err.code, error: err.message });
    }
    res.status(500).json({ error: "批次新增失敗，整批未寫入，請稍後再試" });
  }
}

/* ── CSV 匯出（Excel／其他資料庫） ─────────────────── */

/** 把列資料依欄位定義攤平成 CSV 二維陣列（表頭＝欄位 label） */
function rowsToCsvGrid(fields: DataField[], rows: Array<{ data: DataRowData }>): Array<Array<unknown>> {
  const header = fields.map((f) => f.label);
  const body = rows.map((r) => fields.map((f) => {
    const v = r.data?.[f.key];
    if (v === null || v === undefined) return "";
    if (f.type === "checkbox") return v ? "是" : "否";
    return v;
  }));
  return [header, ...body];
}

/** GET /api/databases/:id/rows.csv — 匯出整表 CSV（session 或金鑰皆可） */
export async function handleCsvExport(req: Request, res: Response): Promise<void> {
  const who = await resolveRequester(req);
  if (!who) return void res.status(401).json({ error: "請先登入或帶 x-api-key" });
  const hit = await readableTable(who.auth, who.viaToken, req.params.id);
  if (!hit) return void res.status(404).json({ error: "找不到這個資料庫" });
  const rows = await db
    .select({ data: schema.dataRows.data })
    .from(schema.dataRows)
    .where(eq(schema.dataRows.tableId, hit.table.id))
    .orderBy(desc(schema.dataRows.createdAt))
    .limit(50_000);
  const csv = toCsv(rowsToCsvGrid(hit.table.fields as DataField[], rows.map((r) => ({ data: r.data as DataRowData }))));
  const filename = encodeURIComponent(hit.table.name.replace(/[/\\?%*:|"<>]/g, "_")) + ".csv";
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${filename}`);
  res.send(csv);
}

/* ── 行事曆訂閱（手機/桌面日曆） ───────────────────── */

/**
 * GET /api/databases/:id/calendar.ics — 把「有日期欄位」的資料庫變成可訂閱行事曆。
 * 每一列＝一個事件：DTSTART 取第一個 date 欄位、SUMMARY 取第一個 text 欄位（否則用日期），
 * DESCRIPTION 彙整其餘欄位。手機日曆訂閱不能帶標頭，故金鑰走 ?key= 查詢字串（個人可撤銷金鑰）。
 */
export async function handleDatabaseIcs(req: Request, res: Response): Promise<void> {
  const who = await resolveRequester(req);
  if (!who) return void res.status(401).json({ error: "需要認證：網址帶 ?key=<個人 MCP 金鑰>" });
  const hit = await readableTable(who.auth, who.viaToken, req.params.id);
  if (!hit) return void res.status(404).json({ error: "找不到這個資料庫" });
  const fields = hit.table.fields as DataField[];
  const dateField = fields.find((f) => f.type === "date");
  if (!dateField) return void res.status(400).json({ error: "這個資料庫沒有日期欄位，無法產生行事曆（請先加一個日期型別欄位）" });
  const titleField = fields.find((f) => f.type === "text") ?? null;
  // orderBy 讓 2000 列上限的取樣「確定」（否則 Postgres 回列順序未定義，超量表每次訂閱看到的事件會漂移）。
  // 註：上限套在日期過濾「之前」，含日期的列若多於 2000 仍可能被截；行事曆訂閱屬概覽用途，可接受，
  //     要完整請用 CSV 匯出或 REST 分頁。
  const rows = await db
    .select({ id: schema.dataRows.id, data: schema.dataRows.data })
    .from(schema.dataRows)
    .where(eq(schema.dataRows.tableId, hit.table.id))
    .orderBy(desc(schema.dataRows.createdAt))
    .limit(2000);

  const items = rows.flatMap((r) => {
    const data = r.data as DataRowData;
    const dateStr = data?.[dateField.key];
    if (typeof dateStr !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return [];
    const startsAt = new Date(dateStr + "T09:00:00Z"); // 全日事件簡化為當日 09:00（UTC）起 1 小時
    if (Number.isNaN(startsAt.getTime())) return [];
    const title = (titleField && typeof data[titleField.key] === "string" && data[titleField.key]) || `${hit.table.name}`;
    const note = fields
      // 附件欄的值是文件 uuid——日曆描述裡是純噪音，略過
      .filter((f) => f.key !== dateField.key && f.key !== titleField?.key && f.type !== "file")
      .map((f) => { const v = data[f.key]; return v !== null && v !== undefined && v !== "" ? `${f.label}: ${f.type === "checkbox" ? (v ? "是" : "否") : v}` : null; })
      .filter(Boolean)
      .join("\n");
    return [{ id: r.id, title: String(title).slice(0, 200), startsAt, endsAt: null as Date | null, note: note || null }];
  });

  const ics = buildIcs(hit.table.name, items);
  res.setHeader("Content-Type", "text/calendar; charset=utf-8");
  res.setHeader("Content-Disposition", `inline; filename="database-${hit.table.id}.ics"`);
  res.send(ics);
}
