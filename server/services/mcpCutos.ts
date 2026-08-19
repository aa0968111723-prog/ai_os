import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { db, schema } from "../db";
import type { AuthState } from "./auth";
import { agentToolRegistry } from "./agentToolRegistry";
import { CUTOS_TOOL_IDS, CutosToolError } from "./cutosToolRegistry";
import { CutosBindingError, resolveCutosProject } from "./cutosProjectBinding";
import { effectFingerprint, type ToolContext } from "./practicalAutonomy";
import { deriveCutosIdempotencyKey } from "./cutosClient";
import { listCutosActivity } from "./cutosActivity";

/**
 * CUTOS over MCP — governed, not raw.
 *
 * The existing MCP infrastructure is reused: the same per-user key identity,
 * the same read-only scope guard, the same audit trail. What is deliberately
 * NOT reused is the idea of a passthrough: an MCP client does not get a
 * generic `cutos.invoke`, cannot name an arbitrary CUTOS project, and cannot
 * reach a capability that is not on the exposed list.
 *
 * Every call still goes through the ordinary `agentToolRegistry` definition,
 * so the ACL, input schema, risk class, idempotency contract, verification and
 * evidence rules are identical to the ones an in-app agent gets.
 *
 * Two capabilities are withheld from MCP entirely — `cutos.edit.apply` and
 * `cutos.export`. Their confirmation policy is `always`, and MCP has no human
 * approval surface, so exposing them would be a way to launder a destructive
 * edit past the gate.
 */

/** Destructive capabilities MCP may never invoke: no approval surface exists there. */
export const MCP_WITHHELD_CUTOS_TOOLS = new Set([
  "cutos.edit.apply",
  "cutos.export",
  "cutos.undo",
  "cutos.redo",
]);

export interface McpCutosTool {
  name: string;
  toolId: string;
  title: string;
  access: "read" | "write";
  blurb: string;
}

/** The MCP-visible slice of the CUTOS capability set. */
export const MCP_CUTOS_TOOLS: McpCutosTool[] = [
  { name: "cutos_get_project", toolId: "cutos.project.get", title: "查影片專案", access: "read", blurb: "查這個專案連結的 CUTOS 影片狀態與時間軸版本。" },
  { name: "cutos_get_transcript", toolId: "cutos.transcript.get", title: "讀逐字稿", access: "read", blurb: "分頁讀取影片逐字稿。" },
  { name: "cutos_search_transcript", toolId: "cutos.transcript.search", title: "搜尋逐字稿", access: "read", blurb: "在逐字稿中做字面搜尋。" },
  { name: "cutos_search_semantic", toolId: "cutos.semantic.search", title: "語意搜尋影片", access: "read", blurb: "找出談到某個主題的片段。" },
  { name: "cutos_list_speakers", toolId: "cutos.speakers.list", title: "列出說話者", access: "read", blurb: "列出影片中的說話者與發言時間。" },
  { name: "cutos_list_topics", toolId: "cutos.topics.list", title: "列出影片主題", access: "read", blurb: "列出影片談到的主題與時間範圍。" },
  { name: "cutos_find_highlights", toolId: "cutos.highlights.find", title: "找精華片段", access: "read", blurb: "找出適合做精華或短影音的片段。" },
  { name: "cutos_inspect_scene", toolId: "cutos.scene.inspect", title: "檢視片段", access: "read", blurb: "檢視某段時間區間的內容摘要。" },
  { name: "cutos_get_preview", toolId: "cutos.preview.inspect", title: "查即時預覽", access: "read", blurb: "取得目前時間軸的即時預覽資訊。" },
  { name: "cutos_get_job", toolId: "cutos.job.get", title: "查影片工作", access: "read", blurb: "查 CUTOS 背景工作（分析／輸出）的進度。" },
  { name: "cutos_verify_edit_plan", toolId: "cutos.edit.verify", title: "驗證剪輯計畫", access: "read", blurb: "驗證待審核的剪輯計畫是否可安全套用。" },
  { name: "cutos_start_analysis", toolId: "cutos.analysis.start", title: "開始分析影片", access: "write", blurb: "送出影片分析工作（不改動時間軸）。" },
  { name: "cutos_create_edit_plan", toolId: "cutos.edit.plan", title: "建立剪輯計畫", access: "write", blurb: "以自然語言建立待審核的剪輯計畫（不改動時間軸，仍需人工核准才會套用）。" },
];

const BY_NAME = new Map(MCP_CUTOS_TOOLS.map((tool) => [tool.name, tool]));

export function isMcpCutosTool(name: string): boolean {
  return BY_NAME.has(name);
}

export function mcpCutosToolNames(): string[] {
  return MCP_CUTOS_TOOLS.map((tool) => tool.name);
}

/** JSON-Schema descriptors for `tools/list`. Project scope is never an input. */
export function mcpCutosToolDefinitions() {
  const projectId = {
    type: "string",
    description: "AI Director 專案 ID（會自動解析成已連結的 CUTOS 影片專案）",
  };
  const schemas: Record<string, Record<string, unknown>> = {
    cutos_get_project: { projectId },
    cutos_get_transcript: { projectId, offset: { type: "number" }, limit: { type: "number" } },
    cutos_search_transcript: { projectId, query: { type: "string" }, limit: { type: "number" } },
    cutos_search_semantic: { projectId, query: { type: "string" }, limit: { type: "number" } },
    cutos_list_speakers: { projectId },
    cutos_list_topics: { projectId, limit: { type: "number" } },
    cutos_find_highlights: {
      projectId,
      targetDurationMs: { type: "number" },
      limit: { type: "number" },
      query: { type: "string" },
    },
    cutos_inspect_scene: { projectId, startMs: { type: "number" }, endMs: { type: "number" } },
    cutos_get_preview: { projectId },
    cutos_get_job: { projectId, jobId: { type: "string" } },
    cutos_verify_edit_plan: { projectId },
    cutos_start_analysis: { projectId },
    cutos_create_edit_plan: { projectId, instruction: { type: "string" } },
  };
  const required: Record<string, string[]> = {
    cutos_search_transcript: ["projectId", "query"],
    cutos_search_semantic: ["projectId", "query"],
    cutos_inspect_scene: ["projectId", "startMs", "endMs"],
    cutos_get_job: ["projectId", "jobId"],
    cutos_create_edit_plan: ["projectId", "instruction"],
  };
  return MCP_CUTOS_TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.blurb,
    inputSchema: {
      type: "object",
      properties: schemas[tool.name] ?? { projectId },
      required: required[tool.name] ?? ["projectId"],
      additionalProperties: false,
    },
  }));
}

/**
 * Execute one MCP CUTOS tool.
 *
 * The MCP client names an AI Director project; the CUTOS project is resolved
 * from the durable binding under that project's own ACL. A client that passes
 * `cutosProjectId` is simply ignored — the field is stripped before the tool's
 * schema ever sees it.
 */
export async function runMcpCutosTool(
  auth: AuthState,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const exposed = BY_NAME.get(name);
  if (!exposed) throw new TRPCError({ code: "NOT_FOUND", message: `未知的工具：${name}` });
  if (MCP_WITHHELD_CUTOS_TOOLS.has(exposed.toolId)) {
    // Defensive: the list above must never grow to include these.
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "這項操作會直接改動影片，必須在網頁端由人核准後執行。",
    });
  }

  const projectId = String(args.projectId ?? "");
  if (!projectId) throw new TRPCError({ code: "BAD_REQUEST", message: "需要 projectId" });

  const [project] = await db
    .select({ groupId: schema.projects.groupId, status: schema.projects.status })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId));
  if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "找不到專案" });
  if (!auth.groups.some((membership) => membership.groupId === project.groupId)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "沒有這個專案的存取權" });
  }
  if (project.status === "archived" && exposed.access === "write") {
    throw new TRPCError({ code: "FORBIDDEN", message: "此專案已封存——請先在網頁端還原專案" });
  }

  let cutosProjectId: string;
  try {
    const binding = await resolveCutosProject({
      userId: auth.user.id,
      groupId: project.groupId,
      projectId,
    });
    cutosProjectId = binding.cutosProjectId;
  } catch (error) {
    if (error instanceof CutosBindingError) {
      throw new TRPCError({
        code: error.code === "BINDING_NOT_FOUND" ? "PRECONDITION_FAILED" : "FORBIDDEN",
        message: error.code === "BINDING_NOT_FOUND"
          ? "這個專案還沒連結 CUTOS 影片專案——請先在網頁端連結。"
          : "沒有這個專案的存取權",
      });
    }
    throw error;
  }

  const tool = agentToolRegistry.get(exposed.toolId);
  // Strip the routing fields; anything the client invented is dropped by the
  // tool's own schema, which does not accept a CUTOS project id at all.
  const { projectId: _projectId, cutosProjectId: _forged, ...rest } = args;
  void _projectId;
  void _forged;

  const parsed = tool.input.safeParse(rest);
  if (!parsed.success) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`)
        .join("; "),
    });
  }

  // MCP has no run; a synthetic one keeps the effect ledger and the audit trail
  // coherent, and keeps the idempotency key derivation identical.
  const runId = randomUUID();
  const stepId = `mcp:${name}`;
  const context: ToolContext = {
    runId,
    stepId,
    userId: auth.user.id,
    groupId: project.groupId,
    projectId,
    idempotencyKey: deriveCutosIdempotencyKey({
      runId,
      stepId,
      capability: exposed.toolId,
      cutosProjectId,
      args: parsed.data,
    }),
    effectFingerprint: effectFingerprint(exposed.toolId, parsed.data),
    toolCallId: randomUUID(),
    attemptId: randomUUID(),
    // An MCP client is an external caller: its input is never a system instruction.
    inputTrust: "EXTERNAL_UNTRUSTED",
    signal: new AbortController().signal,
  };

  try {
    const result = await tool.handler(parsed.data, context);
    return result.value;
  } catch (error) {
    if (error instanceof CutosToolError) {
      throw new TRPCError({
        code: error.code === "APPROVAL_REQUIRED" ? "FORBIDDEN" : "BAD_REQUEST",
        message: error.message,
      });
    }
    throw error;
  }
}

/** Read-only activity feed for an MCP client watching a video project. */
export async function mcpCutosActivity(
  auth: AuthState,
  projectId: string,
  limit = 50,
): Promise<unknown> {
  const [project] = await db
    .select({ groupId: schema.projects.groupId })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId));
  if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "找不到專案" });
  if (!auth.groups.some((membership) => membership.groupId === project.groupId)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "沒有這個專案的存取權" });
  }
  return listCutosActivity({ projectId, limit });
}

/** Guard used by tests and by the catalog: nothing destructive is exposed. */
export function assertNoDestructiveCutosToolExposed(): void {
  for (const tool of MCP_CUTOS_TOOLS) {
    if (MCP_WITHHELD_CUTOS_TOOLS.has(tool.toolId)) {
      throw new Error(`MCP must not expose ${tool.toolId}`);
    }
    if (!CUTOS_TOOL_IDS.includes(tool.toolId)) {
      throw new Error(`MCP exposes an unregistered CUTOS tool: ${tool.toolId}`);
    }
  }
}
