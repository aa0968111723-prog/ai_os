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
    recordMcpAudit(auth.userId, name, args, { ok: true });
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    recordMcpAudit(auth.userId, name, args, { ok: false, error: msg });
    throw err;
  }
}

async function runTool(
  auth: AuthState,
  scope: McpScope,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  // 唯讀金鑰：擋寫入類工具（寫入擴充已在 isMcpWriteExpansionTool 內分類）
  // 被擋也會被 callTool 落審計（ok=false），可追溯「唯讀金鑰嘗試寫入」。
  const denied = scopeDeniedReason(scope, name);
  if (denied) {
    throw new TRPCError({ code: "FORBIDDEN", message: denied });
  }

  if (isMcpWriteExpansionTool(name)) {
    const expansion = await runMcpWriteExpansion(auth, name, args);
    return expansion;
  }

  switch (name) {
    case "whoami": {
      return {
        userId: auth.userId,
        name: auth.userName ?? null,
        groupId: auth.groupId ?? null,
        role: auth.role ?? null,
        scope,
        readOnly: scope === "read",
      };
    }
    case "list_projects": {
      const rows = await db
        .select({
          id: schema.projects.id,
          title: schema.projects.title,
          type: schema.projects.type,
          format: schema.projects.format,
          status: schema.projects.status,
          groupId: schema.projects.groupId,
          updatedAt: schema.projects.updatedAt,
        })
        .from(schema.projects)
        .where(eq(schema.projects.groupId, auth.groupId!))
        .orderBy(desc(schema.projects.updatedAt))
        .limit(100);
      return { projects: rows };
    }
    case "get_project_context": {
      const projectId = String(args.projectId ?? "");
      requireGroup(auth, projectId);
      const [proj] = await db
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.id, projectId));
      if (!proj) throw new TRPCError({ code: "NOT_FOUND", message: "專案不存在" });
      const scenes = await db
        .select({
          id: schema.scenes.id,
          title: schema.scenes.title,
          status: schema.scenes.status,
          sortOrder: schema.scenes.sortOrder,
        })
        .from(schema.scenes)
        .where(eq(schema.scenes.projectId, projectId))
        .orderBy(schema.scenes.sortOrder)
        .limit(50);
      return {
        project: {
          id: proj.id,
          title: proj.title,
          type: proj.type,
          format: proj.format,
          status: proj.status,
          worldview: proj.worldview,
        },
        scenes,
      };
    }
    case "list_generations": {
      const projectId = String(args.projectId ?? "");
      requireGroup(auth, projectId);
      const limit = Math.min(Number(args.limit) || 20, 50);
      const status = args.status ? String(args.status) : undefined;
      const rows = await db
        .select({
          id: schema.generations.id,
          status: schema.generations.status,
          modelId: schema.generations.modelId,
          createdAt: schema.generations.createdAt,
          updatedAt: schema.generations.updatedAt,
        })
        .from(schema.generations)
        .where(
          and(
            eq(schema.generations.projectId, projectId),
            status ? eq(schema.generations.status, status as any) : undefined,
          ),
        )
        .orderBy(desc(schema.generations.createdAt))
        .limit(limit);
      return { generations: rows };
    }
    case "list_scenes": {
      const projectId = String(args.projectId ?? "");
      requireGroup(auth, projectId);
      const rows = await db
        .select({
          id: schema.scenes.id,
          title: schema.scenes.title,
          status: schema.scenes.status,
          sortOrder: schema.scenes.sortOrder,
          prompt: schema.scenes.prompt,
        })
        .from(schema.scenes)
        .where(eq(schema.scenes.projectId, projectId))
        .orderBy(schema.scenes.sortOrder)
        .limit(100);
      return { scenes: rows };
    }
    case "list_knowledge": {
      const projectId = String(args.projectId ?? "");
      requireGroup(auth, projectId);
      const limit = Math.min(Number(args.limit) || 30, 100);
      const rows = await db
        .select({
          id: schema.knowledge.id,
          title: schema.knowledge.title,
          kind: schema.knowledge.kind,
          pinned: schema.knowledge.pinned,
          updatedAt: schema.knowledge.updatedAt,
        })
        .from(schema.knowledge)
        .where(eq(schema.knowledge.projectId, projectId))
        .orderBy(desc(schema.knowledge.updatedAt))
        .limit(limit);
      return { knowledge: rows };
    }
    case "request_upload_grant":
      return handleRequestUploadGrant(auth, args);
    case "get_upload_grant_status":
      return handleGetUploadGrantStatus(auth, args);
    default:
      throw new TRPCError({ code: "NOT_FOUND", message: `未知工具：${name}` });
  }
}

export async function handleMcp(req: Request, res: Response): Promise<void> {
  if (!isMcpEnabled()) {
    res.status(503).json({ error: "MCP 未啟用" });
    return;
  }

  // Rate limit（失敗計數）
  try {
    const identity = await resolveMcpIdentity(req);
    if (!identity) {
      res.status(401).json({ error: "無效或過期的 MCP 金鑰" });
      return;
    }
    const auth = identity.auth;

    // 簡單失敗率限流
    try {
      await inspectFailureRateLimit(RATE_LIMIT_SCOPES.mcp, auth.userId, RATE_LIMIT_POLICIES.mcp);
    } catch (e) {
      if (e instanceof RateLimitUnavailableError || e instanceof RateLimitConfigurationError) {
        // 限流服務不可用時放行，但記錄
        console.warn("[mcp] rate limit unavailable, allowing", e.message);
      } else {
        throw e;
      }
    }

    const body = req.body as {
      jsonrpc?: string;
      id?: string | number | null;
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
  } catch (outer) {
    console.error("[mcp] outer error", outer);
    res.status(500).json({ error: "MCP 內部錯誤" });
  }
}
