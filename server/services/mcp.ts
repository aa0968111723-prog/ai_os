/**
 * MCP 伺服器介面（per-user 權限定案）：讓外部 AI 客戶端（如 Claude）直接操作系統。
 * - 極簡 Streamable HTTP（無狀態 JSON-RPC POST）。
 * - 身分＝金鑰擁有者：每位夥伴帶「自己的」個人金鑰連進來，工具一律以其真實身分與權限執行——
 *   組隔離（requireGroup）、專案 ACL（assertProjectEditable）、點數額度與成本核准門檻，
 *   全部沿用網頁端同一套守衛（submit_generation 直接重用 submitGenerationCore）。
 * - 舊有共用金鑰 env MCP_API_KEY 仍可用（對應開發者），僅為向後相容；見 services/mcpAuth。
 * - 工具：list_projects / get_project_context / find_model / submit_generation / post_message
 *        ＋自訂資料庫三件組 list_databases / query_database / add_database_row（權限走 databaseAcl）
 */
import type { Request, Response } from "express";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db, schema } from "../db";
import { worldviewSchema } from "../../shared/worldview";
import { MODELS, CATEGORIES, tierLabel, type ModelCategory, type ModelTier } from "../../shared/models";
import { sanitizeAuditInput } from "./audit";
import { submitGenerationCore } from "./generationCore";
import { assertProjectEditable } from "./projectAcl";
import { requireGroup } from "../trpc";
import { archivedWriteReason, isMcpEnabled, resolveMcpIdentity } from "./mcpAuth";
import { listVisibleTables, resolveAgentAccess } from "./databaseAcl";
import { validateRowData, type DataField } from "../../shared/databaseFields";
import type { AuthState } from "./auth";

const PROTOCOL_VERSION = "2024-11-05";

const TOOLS = [
  {
    name: "list_projects",
    description: "列出所有專案（標題、類型、格式、狀態）",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_project_context",
    description: "讀取專案的世界觀與分鏡進度（AI 生成前先讀這個）",
    inputSchema: { type: "object", properties: { projectId: { type: "string" } }, required: ["projectId"] },
  },
  {
    name: "find_model",
    description: `依需求快速找模型(11 類 × 旗艦/經濟/最低成本,共 ${MODELS.length} 個)。類別:${CATEGORIES.map((c) => `${c.id}=${c.label}`).join("、")}`,
    inputSchema: {
      type: "object",
      properties: {
        category: { type: "string", description: "類別 id(如 text-to-image)" },
        tier: { type: "string", enum: ["flagship", "economy", "budget"], description: "旗艦/經濟/最低成本" },
        keyword: { type: "string", description: "關鍵字(比對名稱/特性/擅長領域)" },
      },
    },
  },
  {
    name: "submit_generation",
    description: "提交生成(世界觀自動注入)。先用 find_model 找合適的 modelId;需要來源的模型請帶 source_url(圖/音訊/影片網址)。",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        modelId: { type: "string" },
        prompt: { type: "string" },
        source_url: { type: "string", description: "來源網址(圖生圖底圖/待轉錄音訊等,依模型而定)" },
      },
      required: ["projectId", "modelId", "prompt"],
    },
  },
  {
    name: "post_message",
    description: "在專案留言板發訊息",
    inputSchema: { type: "object", properties: { projectId: { type: "string" }, body: { type: "string" } }, required: ["projectId", "body"] },
  },
  {
    name: "list_databases",
    description: "列出你可存取的自訂資料庫（個人/組/團隊/全站 四層範圍），含欄位定義與列數",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "query_database",
    description: "查詢自訂資料庫的列資料（keyword 全文粗篩、limit 上限 200）；先用 list_databases 找 tableId 與欄位定義",
    inputSchema: {
      type: "object",
      properties: {
        tableId: { type: "string" },
        keyword: { type: "string", description: "關鍵字（比對整列資料）" },
        limit: { type: "number", description: "最多回幾列（預設 50，上限 200）" },
      },
      required: ["tableId"],
    },
  },
  {
    name: "add_database_row",
    description: "在自訂資料庫新增一列。data 的鍵＝欄位 key（見 list_databases 回的 fields）；型別與必填由伺服器驗證",
    inputSchema: {
      type: "object",
      properties: {
        tableId: { type: "string" },
        data: { type: "object", description: "{ 欄位key: 值 }" },
      },
      required: ["tableId", "data"],
    },
  },
];

/**
 * MCP 工具呼叫審計（需求 2.2）：MCP 繞過 trpc.ts 的 mutation 審計中介層，這裡自行比照 recordAudit：
 * fire-and-forget、輸入脫敏、成功失敗都記；actorId＝金鑰擁有者本人（per-user 後可追到是誰、非籠統開發者）；
 * groupId/projectId 盡力從 args.projectId 反查。
 */
function recordMcpAudit(
  actorId: string,
  name: string,
  args: Record<string, unknown>,
  outcome: { ok: boolean; error?: string },
): void {
  void (async () => {
    let groupId: string | null = null;
    let projectId: string | null = null;
    const pid = args.projectId;
    if (typeof pid === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pid)) {
      projectId = pid;
      const [proj] = await db.select({ groupId: schema.projects.groupId }).from(schema.projects).where(eq(schema.projects.id, pid));
      groupId = proj?.groupId ?? null;
    }
    await db.insert(schema.auditLog).values({
      actorId,
      action: `mcp.${name}`,
      groupId,
      projectId,
      input: sanitizeAuditInput(args) as Record<string, unknown>,
      ok: outcome.ok,
      error: outcome.error ? outcome.error.slice(0, 300) : null,
    });
  })().catch((err) => console.warn("[mcp] 審計寫入失敗（不影響主流程）：", err instanceof Error ? err.message : err));
}

async function callTool(auth: AuthState, name: string, args: Record<string, unknown>): Promise<unknown> {
  // 每次工具呼叫（含失敗）都落審計——與 tRPC mutation 同一口徑；讀寫工具一律記（MCP 量小、
  // 每筆都是跨介面操作，可追溯性優先於「query 不記」的省量取捨）。actorId＝金鑰擁有者本人。
  try {
    const result = await runTool(auth, name, args);
    recordMcpAudit(auth.user.id, name, args, { ok: true });
    return result;
  } catch (err) {
    recordMcpAudit(auth.user.id, name, args, { ok: false, error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}

async function runTool(auth: AuthState, name: string, args: Record<string, unknown>): Promise<unknown> {
  if (name === "list_projects") {
    // per-user 隔離：只列此人有權存取的組（直接組員＋團隊管理展開＋開發者展開全部，見 loadAuthState）。
    // 無任何組＝回空陣列（不外洩他組專案標題）。
    const groupIds = auth.groups.map((g) => g.groupId);
    if (groupIds.length === 0) return [];
    const rows = await db
      .select()
      .from(schema.projects)
      .where(inArray(schema.projects.groupId, groupIds))
      .orderBy(desc(schema.projects.updatedAt))
      .limit(50);
    return rows.map((p) => ({ id: p.id, title: p.title, kind: p.kind, format: p.format, status: p.status }));
  }

  if (name === "find_model") {
    const keyword = String(args.keyword ?? "").toLowerCase();
    const matches = MODELS.filter((m) => {
      if (args.category && m.category !== (args.category as ModelCategory)) return false;
      if (args.tier && m.tier !== (args.tier as ModelTier)) return false;
      if (keyword && ![m.id, m.label, m.strengths, m.bestFor].some((s) => s.toLowerCase().includes(keyword))) return false;
      return true;
    });
    return matches.slice(0, 20).map((m) => ({
      modelId: m.id,
      label: m.label,
      category: m.category,
      tier: tierLabel(m.tier),
      points: m.points,
      needsSource: m.needs ?? null,
      strengths: m.strengths,
      bestFor: m.bestFor,
      cost: m.cost,
    }));
  }

  // ── 自訂資料庫工具（不掛專案；權限與 tRPC 同一套 databaseAcl）──
  if (name === "list_databases") {
    // 以「AI 介面」的有效權限過濾：agentAccess=none 的庫連列表都不出現（MCP 權限由資料庫管理者控管）
    const tables = await listVisibleTables(auth);
    return tables.flatMap((t) => {
      const access = resolveAgentAccess(auth, t);
      if (!access.canRead) return [];
      return [{
        tableId: t.id,
        name: t.name,
        scope: t.scope,
        description: t.description,
        fields: t.fields,
        rowCount: t.rowCount,
        canWriteRows: access.canWriteRows,
      }];
    });
  }

  if (name === "query_database" || name === "add_database_row") {
    const tableId = String(args.tableId ?? "");
    const [table] = await db.select().from(schema.dataTables).where(and(eq(schema.dataTables.id, tableId), isNull(schema.dataTables.deletedAt)));
    if (!table) throw new Error("找不到這個資料庫");
    // AI 介面有效權限＝本人權限 ∩ agentAccess 等級（none 連讀都擋、read 擋寫）——
    // 與 tRPC 同語意：無讀取權當作不存在，不外洩個人庫/他組庫的存在性
    const access = resolveAgentAccess(auth, table);
    if (!access.canRead) throw new Error("找不到這個資料庫");

    if (name === "query_database") {
      const conds = [eq(schema.dataRows.tableId, table.id)];
      const keyword = String(args.keyword ?? "").trim();
      if (keyword) conds.push(sql`${schema.dataRows.data}::text ilike ${"%" + keyword + "%"}`);
      const limit = Math.min(Math.max(Number(args.limit) || 50, 1), 200);
      const rows = await db
        .select({ id: schema.dataRows.id, data: schema.dataRows.data, updatedAt: schema.dataRows.updatedAt })
        .from(schema.dataRows)
        .where(and(...conds))
        .orderBy(desc(schema.dataRows.createdAt))
        .limit(limit);
      return { table: table.name, fields: table.fields, rows };
    }

    // add_database_row
    if (!access.canWriteRows) throw new Error("這個資料庫不開放 AI 寫入（管理者可在工作台「資料庫」頁調整 AI 存取等級）");
    const checked = validateRowData(table.fields as DataField[], args.data ?? {});
    if (!checked.ok) throw new Error(checked.error);
    const [row] = await db.insert(schema.dataRows).values({ tableId: table.id, data: checked.data, createdBy: auth.user.id }).returning();
    await db.update(schema.dataTables).set({ updatedAt: new Date() }).where(eq(schema.dataTables.id, table.id));
    return { rowId: row.id, data: checked.data };
  }

  const projectId = String(args.projectId ?? "");
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
  if (!project) throw new Error("找不到專案");
  // per-user 組隔離：不屬於此專案的組直接擋（requireGroup 拋 FORBIDDEN，被 callTool 落審計後回 JSON-RPC error）
  requireGroup(auth, project.groupId);
  // 封存專案守衛（寫入類工具才擋，讀取放行）——見 archivedWriteReason
  const archived = archivedWriteReason(name, project.status);
  if (archived) throw new Error(archived);

  if (name === "get_project_context") {
    const wv = worldviewSchema.parse(project.worldview ?? {});
    const scenes = await db.select().from(schema.scenes).where(and(eq(schema.scenes.projectId, project.id), isNull(schema.scenes.deletedAt)));
    return { title: project.title, kind: project.kind, format: project.format, worldview: wv, scenes: scenes.map((s) => ({ title: s.title, status: s.status })) };
  }

  if (name === "submit_generation") {
    const userPrompt = String(args.prompt ?? "").trim();
    if (!userPrompt) throw new Error("prompt 不可為空");
    const sourceUrl = args.source_url ? String(args.source_url) : undefined;
    // 重用網頁端同一條核心：世界觀注入、原子守門扣點、fal 送出/失敗退點，且透過 assertAccess
    // 疊上「專案級 ACL（檢視者不能生成）」與「成本核准門檻（組員達門檻先送審）」——與網頁端行為一致。
    // userId＝金鑰擁有者本人：扣他的額度、走他的核准門檻、審計記他，真正做到「依自己權限」。
    const gen = await submitGenerationCore({
      userId: auth.user.id,
      projectId: project.id,
      modelId: String(args.modelId ?? ""),
      prompt: userPrompt,
      sourceUrl,
      reasonPrefix: "MCP 生成",
      assertAccess: async (proj) => {
        const role = requireGroup(auth, proj.groupId);
        await assertProjectEditable(auth, proj); // 檢視者（唯讀）不能生成
        return role; // 回角色供成本核准門檻判斷組員
      },
    });
    // 待核准（達門檻的組員）與已送出兩種終局都據實回報，讓外部客戶端知道要等組長核准
    if (gen.status === "awaiting_approval") {
      return { generationId: gen.id, status: "awaiting_approval", points: gen.pointsEst, note: "已達成本門檻，等組長核准後才會送出扣點" };
    }
    return { generationId: gen.id, status: gen.status, points: gen.pointsEst };
  }

  if (name === "post_message") {
    // 留言不受專案級 ACL 限制（檢視者也可留言，與網頁端一致）——組隔離已於上方 requireGroup 把關。
    const body = String(args.body ?? "").trim();
    if (!body) throw new Error("body 不可為空");
    const [msg] = await db
      .insert(schema.messages)
      .values({ groupId: project.groupId, projectId: project.id, userId: auth.user.id, kind: "text", body })
      .returning();
    return { messageId: msg.id };
  }

  throw new Error(`未知工具：${name}`);
}

// 金鑰失敗速率限制（記憶體計數，比照系統其他記憶體防線）：每 IP 每分鐘失敗達門檻即封鎖一段時間，
// 擋暴力猜金鑰。成功即清除該 IP 計數，正常客戶端不受影響（#24）。
const MCP_FAIL_WINDOW_MS = 60_000;
const MCP_FAIL_MAX = 10;
const MCP_BLOCK_MS = 5 * 60_000;
const mcpFails = new Map<string, { count: number; windowStart: number; blockedUntil: number }>();

function mcpClientIp(req: Request): string {
  // index.ts 已設 trust proxy=1，req.ip 即真實 client IP
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
}

function mcpBlocked(ip: string): boolean {
  const rec = mcpFails.get(ip);
  return rec != null && rec.blockedUntil > Date.now();
}

function mcpRecordFailure(ip: string): void {
  const now = Date.now();
  // 順手清掉過期且未封鎖的陳舊項，避免 Map 無限膨脹被當成記憶體耗盡面
  if (mcpFails.size > 1024) {
    for (const [k, v] of mcpFails) {
      if (v.blockedUntil <= now && now - v.windowStart > MCP_FAIL_WINDOW_MS) mcpFails.delete(k);
    }
  }
  let rec = mcpFails.get(ip);
  if (!rec || now - rec.windowStart > MCP_FAIL_WINDOW_MS) rec = { count: 0, windowStart: now, blockedUntil: 0 };
  rec.count += 1;
  if (rec.count >= MCP_FAIL_MAX) rec.blockedUntil = now + MCP_BLOCK_MS;
  mcpFails.set(ip, rec);
}

/** JSON-RPC 處理器（掛在 POST /api/mcp） */
export async function handleMcp(req: Request, res: Response): Promise<void> {
  // 未啟用＝沒設 env 共用金鑰、也沒任何個人金鑰：回 404 不對外張揚端點（行為同舊版）
  if (!(await isMcpEnabled())) {
    res.status(404).json({ error: "MCP 未啟用（在「怎麼用」頁建立個人連線金鑰，或設 MCP_API_KEY 環境變數）" });
    return;
  }
  const ip = mcpClientIp(req);
  if (mcpBlocked(ip)) {
    res.status(429).json({ error: "嘗試過於頻繁，請稍後再試" });
    return;
  }
  // 身分解析：個人金鑰→該使用者；env 共用金鑰→開發者；皆不符→401（記一次失敗，擋暴力猜）
  const provided = req.headers["x-api-key"];
  const identity = typeof provided === "string" && provided.length > 0 ? await resolveMcpIdentity(provided) : null;
  if (!identity) {
    mcpRecordFailure(ip);
    res.status(401).json({ error: "MCP 金鑰不正確或已撤銷" });
    return;
  }
  mcpFails.delete(ip); // 驗證成功即清除該 IP 的失敗計數
  const auth = identity.auth;
  const body = req.body as { jsonrpc?: string; id?: number | string | null; method?: string; params?: Record<string, unknown> };
  const reply = (result: unknown): void => void res.json({ jsonrpc: "2.0", id: body.id ?? null, result });
  const fail = (code: number, message: string): void => void res.json({ jsonrpc: "2.0", id: body.id ?? null, error: { code, message } });

  try {
    switch (body.method) {
      case "initialize":
        return reply({ protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: { name: "ai-director-os", version: "0.1.0" } });
      case "notifications/initialized":
        res.status(202).end();
        return;
      case "ping":
        return reply({});
      case "tools/list":
        return reply({ tools: TOOLS });
      case "tools/call": {
        const { name, arguments: args } = (body.params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
        const result = await callTool(auth, String(name), args ?? {});
        return reply({ content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
      }
      default:
        return fail(-32601, `不支援的方法：${body.method}`);
    }
  } catch (err) {
    // requireGroup/assertProjectEditable 拋的是 TRPCError；對外一律折成 JSON-RPC error 的人話訊息
    if (err instanceof TRPCError) return fail(-32000, err.message);
    return fail(-32000, err instanceof Error ? err.message : String(err));
  }
}
