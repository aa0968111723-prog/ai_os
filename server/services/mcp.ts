/**
 * MCP 伺服器介面（4-1 架構定案）：讓外部 AI 客戶端（如 Claude）直接操作系統。
 * - 極簡 Streamable HTTP（無狀態 JSON-RPC POST）；設 MCP_API_KEY 才啟用。
 * - 以超管身分執行（金鑰即權限）；工具：list_projects / get_project_context / submit_generation / post_message
 */
import type { Request, Response } from "express";
import { timingSafeEqual } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db, schema } from "../db";
import { worldviewSchema } from "../../shared/worldview";
import { getModel, endpointOf, MODELS, CATEGORIES, tierLabel, type ProjectFormat, type ModelCategory, type ModelTier } from "../../shared/models";
import { falSubmit } from "./fal";
import { reserveQuota, refund } from "./points";
import { sanitizeAuditInput } from "./audit";
// 重用網頁端的注入判斷（generation.ts 不 import 本檔，無循環相依）：
// TTS 會把注入文字唸進成品、轉錄/視覺工具會被污染輸入，不能無條件注入世界觀
import { effectivePrompt } from "../routers/generation";

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
];

/**
 * MCP 工具呼叫審計（需求 2.2）：MCP 是全站權限最高的介面（單一金鑰＝超管），過去完全繞過
 * trpc.ts 的 mutation 審計中介層——跨組花點、貼留言零軌跡。這裡比照 recordAudit：
 * fire-and-forget、輸入脫敏、成功失敗都記；groupId/projectId 盡力從 args.projectId 反查。
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

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const [admin] = await db.select().from(schema.users).where(eq(schema.users.isSuperAdmin, true)).limit(1);
  if (!admin) throw new Error("系統尚未初始化");
  // 每次工具呼叫（含失敗）都落審計——與 tRPC mutation 同一口徑；讀寫工具一律記（MCP 量小、
  // 但每筆都是超管級跨組操作，可追溯性優先於「query 不記」的省量取捨）
  try {
    const result = await runTool(admin, name, args);
    recordMcpAudit(admin.id, name, args, { ok: true });
    return result;
  } catch (err) {
    recordMcpAudit(admin.id, name, args, { ok: false, error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}

async function runTool(admin: typeof schema.users.$inferSelect, name: string, args: Record<string, unknown>): Promise<unknown> {
  if (name === "list_projects") {
    const rows = await db.select().from(schema.projects).orderBy(desc(schema.projects.updatedAt)).limit(50);
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

  const projectId = String(args.projectId ?? "");
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
  if (!project) throw new Error("找不到專案");
  // MCP 的專案 ACL（最小集）：MCP 以超管執行、無使用者級角色可查，但「寫入／扣點」不該落在
  // 已封存的專案上——外部 AI 客戶端拿舊 projectId 對封存案生成，會造成擁有者以為停用卻持續扣點
  if (project.status === "archived" && (name === "submit_generation" || name === "post_message")) {
    throw new Error("此專案已封存——請先在網頁端還原專案，或改用其他專案");
  }

  if (name === "get_project_context") {
    const wv = worldviewSchema.parse(project.worldview ?? {});
    const scenes = await db.select().from(schema.scenes).where(and(eq(schema.scenes.projectId, project.id), isNull(schema.scenes.deletedAt)));
    return { title: project.title, kind: project.kind, format: project.format, worldview: wv, scenes: scenes.map((s) => ({ title: s.title, status: s.status })) };
  }

  if (name === "submit_generation") {
    const model = getModel(String(args.modelId ?? ""));
    if (!model) throw new Error("未知模型(先用 find_model 查詢)");
    const sourceUrl = args.source_url ? String(args.source_url) : undefined;
    if (model.needs && !sourceUrl) throw new Error(`此模型需要 source_url:${model.sourceHint ?? model.needs}`);
    const wv = worldviewSchema.parse(project.worldview ?? {});
    const userPrompt = String(args.prompt ?? "").trim();
    if (!userPrompt) throw new Error("prompt 不可為空");
    // 與網頁端同一份判斷：僅適合的類別才注入世界觀（且注入內容含 styles/message，兩端一致）
    const prompt = effectivePrompt(model, userPrompt, wv);
    const falInput = model.input(prompt, project.format as ProjectFormat, sourceUrl);
    const [gen] = await db
      .insert(schema.generations)
      .values({ projectId: project.id, groupId: project.groupId, userId: admin.id, modelId: model.id, kind: model.kind, prompt: userPrompt, sourceUrl, params: falInput, pointsEst: model.points })
      .returning();
    // 與網頁端一致：原子守門＋扣點（舊版直接扣、完全不檢查額度，MCP 可無限刷爆總預算）
    // 拋例外也要刪孤兒列（否則被陳屍清掃憑空退點）——與網頁端同一防護
    let quotaError: string | null;
    try {
      quotaError = await reserveQuota(admin.id, project.groupId, model.points, `MCP 生成 ${model.label}`, gen.id);
    } catch (err) {
      await db.delete(schema.generations).where(eq(schema.generations.id, gen.id));
      throw new Error(`系統忙碌，請稍後再試（未扣點）：${err instanceof Error ? err.message : String(err)}`);
    }
    if (quotaError) {
      await db.delete(schema.generations).where(eq(schema.generations.id, gen.id));
      throw new Error(quotaError);
    }
    try {
      const { requestId } = await falSubmit(endpointOf(model), model.kind, falInput);
      await db.update(schema.generations).set({ requestId, status: "running" }).where(eq(schema.generations.id, gen.id));
      return { generationId: gen.id, status: "running", points: model.points };
    } catch (err) {
      // fal 送出失敗：退點＋標記失敗（舊版吞掉例外還回報 running，永遠卡在假的進行中）
      await refund(admin.id, project.groupId, model.points, "MCP 生成送出失敗退回", gen.id);
      await db.update(schema.generations).set({ status: "failed", error: String(err), pointsRefunded: model.points }).where(eq(schema.generations.id, gen.id));
      throw new Error(`生成送出失敗，點數已退回：${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (name === "post_message") {
    const [msg] = await db
      .insert(schema.messages)
      .values({ groupId: project.groupId, projectId: project.id, userId: admin.id, kind: "text", body: String(args.body ?? "") })
      .returning();
    return { messageId: msg.id };
  }

  throw new Error(`未知工具：${name}`);
}

/** 金鑰比對用固定時間演算法：先等長檢查（timingSafeEqual 要求等長），避免以耗時差回推金鑰（#10） */
function keyEquals(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
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
  const apiKey = process.env.MCP_API_KEY;
  if (!apiKey) {
    res.status(404).json({ error: "MCP 未啟用（設 MCP_API_KEY 環境變數即開）" });
    return;
  }
  const ip = mcpClientIp(req);
  if (mcpBlocked(ip)) {
    res.status(429).json({ error: "嘗試過於頻繁，請稍後再試" });
    return;
  }
  const provided = req.headers["x-api-key"];
  if (typeof provided !== "string" || !keyEquals(provided, apiKey)) {
    mcpRecordFailure(ip);
    res.status(401).json({ error: "MCP 金鑰不正確" });
    return;
  }
  mcpFails.delete(ip); // 驗證成功即清除該 IP 的失敗計數
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
        const result = await callTool(String(name), args ?? {});
        return reply({ content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
      }
      default:
        return fail(-32601, `不支援的方法：${body.method}`);
    }
  } catch (err) {
    return fail(-32000, err instanceof Error ? err.message : String(err));
  }
}
