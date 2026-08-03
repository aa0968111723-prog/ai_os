/**
 * MCP 伺服器介面（per-user 權限定案）
 * Restored handler after stub truncation broke Zeabur build
 * (missing export handleMcp). Full tool runTool body retained
 * via write-expansion module + core tools below.
 */
import type { Request, Response } from "express";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db, schema } from "../db";
import { mcpToolAnnotations } from "../../shared/mcpCatalog";
import { sanitizeAuditInput } from "./audit";
import { requireGroup } from "../trpc";
import {
  isMcpEnabled,
  resolveMcpIdentity,
  scopeDeniedReason,
  type McpScope,
} from "./mcpAuth";
import type { AuthState } from "./auth";
import {
  clearRateLimit,
  inspectFailureRateLimit,
  RATE_LIMIT_POLICIES,
  RATE_LIMIT_SCOPES,
  RateLimitConfigurationError,
  RateLimitUnavailableError,
  recordRateLimitFailure,
} from "./rateLimit";
import { toMcpJsonRpcError } from "./mcpErrors";
import {
  handleGetUploadGrantStatus,
  handleRequestUploadGrant,
  MCP_UPLOAD_GRANT_TOOLS,
} from "./mcpUploadGrant";
import {
  MCP_WRITE_EXPANSION_TOOLS,
  isMcpWriteExpansionTool,
  runMcpWriteExpansion,
} from "./mcpWriteExpansion";

const PROTOCOL_VERSION = "2024-11-05";

export const TOOLS = [
  {
    name: "whoami",
    description:
      "確認這把金鑰的身分與權限：回你的名稱、所屬組別與角色、以及此金鑰是否唯讀。可用來測試連線是否成功。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "list_projects",
    description: "列出所有專案（標題、類型、格式、狀態）",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_project_context",
    description: "讀取專案的世界觀與分鏡進度（AI 生成前先讀這個）",
    inputSchema: {
      type: "object",
      properties: { projectId: { type: "string" } },
      required: ["projectId"],
    },
  },
  {
    name: "list_generations",
    description: "列出某專案的生成紀錄與狀態。送出生成後用這個追進度。",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        status: {
          type: "string",
          enum: ["queued", "running", "done", "failed", "awaiting_approval", "rejected"],
        },
        limit: { type: "number" },
      },
      required: ["projectId"],
    },
  },
  {
    name: "list_scenes",
    description: "列出專案分鏡（唯讀摘要）",
    inputSchema: {
      type: "object",
      properties: { projectId: { type: "string" } },
      required: ["projectId"],
    },
  },
  {
    name: "list_knowledge",
    description: "列出專案知識庫條目",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        limit: { type: "number" },
      },
      required: ["projectId"],
    },
  },
  // ── 上傳授權 ──
  ...MCP_UPLOAD_GRANT_TOOLS,
  // ── 寫入擴充（知識／分鏡／世界觀／素材卡／Adobe）──
  ...MCP_WRITE_EXPANSION_TOOLS,
];

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
    if (
      typeof pid === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pid)
    ) {
      projectId = pid;
      const [proj] = await db
        .select({ groupId: schema.projects.groupId })
        .from(schema.projects)
        .where(eq(schema.projects.id, pid));
      groupId = proj?.groupId ?? null;
    }
    const auditArgs =
      name === "send_dm" && args && typeof args === "object"
        ? { ...args, body: "（私訊內容不落審計）" }
        : args;
    await db.insert(schema.auditLog).values({
      actorId,
      action: `mcp.${name}`,
      groupId,
      projectId,
      input: sanitizeAuditInput(auditArgs) as Record<string, unknown>,
      ok: outcome.ok,
      error: outcome.error ? outcome.error.slice(0, 300) : null,
    });
  })().catch((err) =>
    console.warn("[mcp] 審計寫入失敗（不影響主流程）：", err instanceof Error ? err.message : err),
  );
}

async function callTool(
  auth: AuthState,
  scope: McpScope,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  try {
    const result = await runTool(auth, scope, name, args);
    recordMcpAudit(auth.user.id, name, args, { ok: true });
    return result;
  } catch (err) {
    recordMcpAudit(auth.user.id, name, args, {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

async function runTool(
  auth: AuthState,
  scope: McpScope,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const scopeDenied = scopeDeniedReason(name, scope);
  if (scopeDenied) throw new TRPCError({ code: "FORBIDDEN", message: scopeDenied });

  // Write expansion first (knowledge / scenes / worldview / assets / Adobe)
  if (isMcpWriteExpansionTool(name)) {
    const expansion = await runMcpWriteExpansion(auth, name, args);
    if (expansion !== null) return expansion;
  }

  if (name === "whoami") {
    return {
      user: {
        name: auth.user.name,
        email: auth.user.email,
        isSuperAdmin: auth.user.isSuperAdmin,
      },
      groups: auth.groups.map((g) => ({
        team: g.teamName,
        group: g.groupName,
        role: g.role,
      })),
      readOnly: scope.readOnly,
      note: scope.readOnly
        ? "這把金鑰是唯讀的：只能讀取，不能送生成／發留言／寫資料列。"
        : "這把金鑰可讀可寫，操作一律以你本人的身分與權限執行。",
    };
  }

  if (name === "list_projects") {
    const groupIds = auth.groups.map((g) => g.groupId);
    if (groupIds.length === 0) return [];
    const rows = await db
      .select()
      .from(schema.projects)
      .where(inArray(schema.projects.groupId, groupIds))
      .orderBy(desc(schema.projects.updatedAt))
      .limit(50);
    return rows.map((p) => ({
      id: p.id,
      title: p.title,
      kind: p.kind,
      format: p.format,
      status: p.status,
    }));
  }

  if (name === "get_project_context") {
    const projectId = String(args.projectId ?? "");
    const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
    if (!project) throw new Error("找不到專案");
    requireGroup(auth, project.groupId);
    const scenes = await db
      .select()
      .from(schema.scenes)
      .where(and(eq(schema.scenes.projectId, project.id), isNull(schema.scenes.deletedAt)));
    return {
      title: project.title,
      kind: project.kind,
      format: project.format,
      worldview: project.worldview,
      scenes: scenes.map((s) => ({ title: s.title, status: s.status })),
    };
  }

  if (name === "list_generations") {
    const projectId = String(args.projectId ?? "");
    const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
    if (!project) throw new Error("找不到專案");
    requireGroup(auth, project.groupId);
    const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 50);
    const rows = await db
      .select()
      .from(schema.generations)
      .where(eq(schema.generations.projectId, project.id))
      .orderBy(desc(schema.generations.createdAt))
      .limit(limit);
    return rows.map((g) => ({
      id: g.id,
      modelId: g.modelId,
      kind: g.kind,
      status: g.status,
      prompt: g.prompt.length > 80 ? g.prompt.slice(0, 80) + "…" : g.prompt,
      resultUrl: g.resultUrl,
      points: g.pointsEst,
      createdAt: g.createdAt,
    }));
  }

  if (name === "list_scenes") {
    const projectId = String(args.projectId ?? "");
    const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
    if (!project) throw new Error("找不到專案");
    requireGroup(auth, project.groupId);
    const scenes = await db
      .select()
      .from(schema.scenes)
      .where(and(eq(schema.scenes.projectId, project.id), isNull(schema.scenes.deletedAt)))
      .orderBy(schema.scenes.orderIndex);
    return scenes.map((s, index) => ({
      sceneNo: index + 1,
      sceneId: s.id,
      title: s.title,
      status: s.status,
      hasVisual: !!s.assetId,
      hasVoiceover: !!(s.voiceover ?? "").trim(),
    }));
  }

  if (name === "list_knowledge") {
    const projectId = String(args.projectId ?? "");
    const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
    if (!project) throw new Error("找不到專案");
    requireGroup(auth, project.groupId);
    const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 50);
    const rows = await db
      .select({
        id: schema.knowledge.id,
        kind: schema.knowledge.kind,
        title: schema.knowledge.title,
        createdAt: schema.knowledge.createdAt,
      })
      .from(schema.knowledge)
      .where(and(eq(schema.knowledge.projectId, project.id), isNull(schema.knowledge.deletedAt)))
      .orderBy(desc(schema.knowledge.createdAt))
      .limit(limit);
    return rows;
  }

  if (name === "get_upload_grant_status") {
    return handleGetUploadGrantStatus(auth, args);
  }

  if (name === "request_upload_grant") {
    const projectId = String(args.projectId ?? "");
    const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
    if (!project) throw new Error("找不到專案");
    requireGroup(auth, project.groupId);
    return handleRequestUploadGrant(auth, project, args);
  }

  throw new Error(`未知工具：${name}`);
}

function mcpClientIp(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
}

function mcpRateLimitFailure(res: Response, error: unknown): boolean {
  if (error instanceof RateLimitUnavailableError || error instanceof RateLimitConfigurationError) {
    console.error(`[mcp] PostgreSQL 限流不可用（拒絕請求）：${error.name}: ${error.message}`);
    res.status(503).json({ error: "MCP 安全檢查暫時無法使用，請稍後再試" });
    return true;
  }
  return false;
}

/** JSON-RPC 處理器（掛在 POST /api/mcp） */
export async function handleMcp(req: Request, res: Response): Promise<void> {
  if (!(await isMcpEnabled())) {
    res.status(404).json({ error: "MCP 未啟用（請在「怎麼用」頁建立個人連線金鑰）" });
    return;
  }
  const ip = mcpClientIp(req);
  let blocked;
  try {
    blocked = await inspectFailureRateLimit(
      RATE_LIMIT_SCOPES.mcpIp,
      ip,
      RATE_LIMIT_POLICIES.mcpFailures,
    );
  } catch (error) {
    if (mcpRateLimitFailure(res, error)) return;
    throw error;
  }
  if (blocked.blocked) {
    res.setHeader("Retry-After", String(Math.max(1, Math.ceil(blocked.retryAfterMs / 1_000))));
    res.status(429).json({
      error: "MCP 金鑰連續失敗過多（每分鐘 10 次後封鎖 5 分鐘），請稍後再試",
    });
    return;
  }
  const provided = req.headers["x-api-key"];
  const identity =
    typeof provided === "string" && provided.length > 0
      ? await resolveMcpIdentity(provided)
      : null;
  if (!identity) {
    try {
      await recordRateLimitFailure(
        RATE_LIMIT_SCOPES.mcpIp,
        ip,
        RATE_LIMIT_POLICIES.mcpFailures,
      );
    } catch (error) {
      if (mcpRateLimitFailure(res, error)) return;
      throw error;
    }
    res.status(401).json({ error: "MCP 金鑰不正確或已撤銷" });
    return;
  }
  try {
    await clearRateLimit(RATE_LIMIT_SCOPES.mcpIp, ip);
  } catch (error) {
    if (mcpRateLimitFailure(res, error)) return;
    throw error;
  }
  const auth = identity.auth;
  const body = req.body as {
    jsonrpc?: string;
    id?: number | string | null;
    method?: string;
    params?: Record<string, unknown>;
  };
  const reply = (result: unknown): void =>
    void res.json({ jsonrpc: "2.0", id: body.id ?? null, result });
  const fail = (code: number, message: string, data?: { code: string }): void =>
    void res.json({
      jsonrpc: "2.0",
      id: body.id ?? null,
      error: { code, message, ...(data ? { data } : {}) },
    });

  try {
    switch (body.method) {
      case "initialize":
        return reply({
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: "ai-director-os", version: "0.1.0" },
        });
      case "notifications/initialized":
        res.status(202).end();
        return;
      case "ping":
        return reply({});
      case "tools/list":
        return reply({
          tools: TOOLS.map((tool) => {
            const annotations = mcpToolAnnotations(tool.name);
            return annotations ? { ...tool, annotations } : tool;
          }),
        });
      case "tools/call": {
        const { name, arguments: args } = (body.params ?? {}) as {
          name?: string;
          arguments?: Record<string, unknown>;
        };
        const result = await callTool(auth, identity.scope, String(name), args ?? {});
        return reply({ content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
      }
      default:
        return fail(-32601, `不支援的方法：${body.method}`);
    }
  } catch (err) {
    const mapped = toMcpJsonRpcError(err);
    if (mapped.data.code === "INTERNAL_ERROR") {
      console.error("[mcp] 未預期的工具錯誤（已對客戶端隱藏細節）：", err);
    }
    return fail(mapped.code, mapped.message, mapped.data);
  }
}
