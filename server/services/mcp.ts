/**
 * MCP 伺服器介面（4-1 架構定案）：讓外部 AI 客戶端（如 Claude）直接操作系統。
 * - 極簡 Streamable HTTP（無狀態 JSON-RPC POST）；設 MCP_API_KEY 才啟用。
 * - 以超管身分執行（金鑰即權限）；工具：list_projects / get_project_context / submit_generation / post_message
 */
import type { Request, Response } from "express";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "../db";
import { worldviewSchema } from "../../shared/worldview";
import { getModel, endpointOf, MODELS, CATEGORIES, tierLabel, type ProjectFormat, type ModelCategory, type ModelTier } from "../../shared/models";
import { falSubmit } from "./fal";

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

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const [admin] = await db.select().from(schema.users).where(eq(schema.users.isSuperAdmin, true)).limit(1);
  if (!admin) throw new Error("系統尚未初始化");

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

  if (name === "get_project_context") {
    const wv = worldviewSchema.parse(project.worldview ?? {});
    const scenes = await db.select().from(schema.scenes).where(eq(schema.scenes.projectId, project.id));
    return { title: project.title, kind: project.kind, format: project.format, worldview: wv, scenes: scenes.map((s) => ({ title: s.title, status: s.status })) };
  }

  if (name === "submit_generation") {
    const model = getModel(String(args.modelId ?? ""));
    if (!model) throw new Error("未知模型(先用 find_model 查詢)");
    const sourceUrl = args.source_url ? String(args.source_url) : undefined;
    if (model.needs && !sourceUrl) throw new Error(`此模型需要 source_url:${model.sourceHint ?? model.needs}`);
    const wv = worldviewSchema.parse(project.worldview ?? {});
    const prompt = `${String(args.prompt ?? "")}\n\n[專案背景] 調性：${wv.tones.join("、")}｜避免：${wv.taboos.join("；")}`;
    const falInput = model.input(prompt, project.format as ProjectFormat, sourceUrl);
    const [gen] = await db
      .insert(schema.generations)
      .values({ projectId: project.id, groupId: project.groupId, userId: admin.id, modelId: model.id, kind: model.kind, prompt: String(args.prompt ?? ""), sourceUrl, params: falInput, pointsEst: model.points })
      .returning();
    await db.insert(schema.costLedger).values({ userId: admin.id, groupId: project.groupId, delta: -model.points, reason: `MCP 生成 ${model.label}`, generationId: gen.id });
    const { requestId } = await falSubmit(endpointOf(model), model.kind, falInput);
    await db.update(schema.generations).set({ requestId, status: "running" }).where(eq(schema.generations.id, gen.id));
    return { generationId: gen.id, status: "running", points: model.points };
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

/** JSON-RPC 處理器（掛在 POST /api/mcp） */
export async function handleMcp(req: Request, res: Response): Promise<void> {
  const apiKey = process.env.MCP_API_KEY;
  if (!apiKey) {
    res.status(404).json({ error: "MCP 未啟用（設 MCP_API_KEY 環境變數即開）" });
    return;
  }
  if (req.headers["x-api-key"] !== apiKey) {
    res.status(401).json({ error: "MCP 金鑰不正確" });
    return;
  }
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
