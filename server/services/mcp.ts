/**
 * MCP 伺服器介面（per-user 權限定案）：讓外部 AI 客戶端（如 Claude）直接操作系統。
 * - 極簡 Streamable HTTP（無狀態 JSON-RPC POST）。
 * - 身分＝金鑰擁有者：每位夥伴帶「自己的」個人金鑰連進來，工具一律以其真實身分與權限執行——
 *   組隔離（requireGroup）、專案 ACL（assertProjectEditable）、點數額度與成本核准門檻，
 *   全部沿用網頁端同一套守衛（submit_generation 走 executeGenerationCommand）。
 * - 金鑰可設「唯讀」與「到期」（見 services/mcpAuth）：唯讀金鑰經 scopeDeniedReason 擋所有寫入類工具。
 * - 舊共用金鑰另需 ALLOW_LEGACY_MCP_ADMIN_KEY=1，且僅限非 production 本機／CI；正式環境只接受個人金鑰。
 * - 工具（讀/寫分類的單一來源在 shared/mcpCatalog）：
 *     基礎：whoami / list_projects / get_project_context / find_model / submit_generation / post_message
 *     生成取回：list_generations / get_generation / list_assets（成品簽成免登入短效網址）
 *     上傳授權：request_upload_grant / get_upload_grant_status（MCP 不傳二進位；簽 aidup_ 後走 POST /api/upload）
 *     自訂資料庫：list_databases / query_database / add_database_row / add_database_rows / update_database_row / list_database_files / read_database_file / get_database_stats
 *     AI 代理（重用 agentCore）：plan_agent（含 shortCreation 短版旗標）/ approve_agent / stop_agent / discard_agent / list_agent_runs / get_agent_run
 *     專案排程（重用 scheduleCore）：list_schedule / add_schedule_item / update_schedule_item
 *     筆記・會議紀錄（重用 notesCore）：list_notes / get_note / add_note / append_note
 *     人類任務（重用 taskCore；完成等待節點會喚醒代理）：list_tasks / create_task / complete_task
 *     知識庫與分鏡（讀＋寫擴充）：list_knowledge / get_knowledge / list_scenes / add_knowledge / update_knowledge / add_scene / update_scene / set_scene_visual / generate_into_scene
 *     外部連接（E5/M5；本人 token、指定 fileId、不提供整盤瀏覽）：get_integrations_status / import_drive_file
 *     站內私訊（只碰本人參與的對話）：list_dm_contacts / list_dm_threads / read_dm / send_dm
 *     統整：get_project_status（一次回分鏡＋生成＋代理＋排程＋待辦）
 *     Adobe：adobe_status / adobe_list_assets / adobe_edit_photo / adobe_job / adobe_export_timeline / adobe_render_timeline
 *     tools/list 附 shared/mcpCatalog 推導的 annotations（readOnly/destructive/idempotent/openWorld）
 */
import type { Request, Response } from "express";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db, schema } from "../db";
import { worldviewSchema } from "../../shared/worldview";
import { mcpToolAnnotations } from "../../shared/mcpCatalog";
import { MODELS, CATEGORIES, tierLabel, type ModelCategory, type ModelTier } from "../../shared/models";
import { agentPlannerModeSchema } from "../../shared/agentPlanner";
import { sanitizeAuditInput } from "./audit";
import { advanceGeneration } from "./generationCore";
import { executeGenerationCommand } from "./generationCommand";
import { signAssetUrl, signDbFileUrl } from "./storage";
import { requireGroup } from "../trpc";
import { archivedWriteReason, isMcpEnabled, resolveMcpIdentity, scopeDeniedReason, type McpScope } from "./mcpAuth";
import { resolveAgentAccess } from "./databaseAcl";
import { addDataRowValidated, updateDataRowValidated } from "./databaseCore";
import {
  DATABASE_BATCH_REQUEST_LIMIT,
  databaseBatchWriteDenied,
  parseDatabaseBatchRows,
} from "./databaseBatchApi";
import {
  executeIdempotentDatabaseBatch,
  IDEMPOTENCY_KEY_MAX_LENGTH,
  IDEMPOTENCY_KEY_MIN_LENGTH,
  IDEMPOTENCY_KEY_PATTERN,
  parseIdempotencyKey,
} from "./databaseBatchIdempotency";
import { formatStatsLine, mediaKindOf, tableStats } from "./databaseMedia";
import {
  getAgentReadableTable,
  listMcpDatabaseFiles,
  listMcpDatabases,
  mergeProjectIntoRowData,
  queryMcpDatabase,
} from "./databaseMcp";
import {
  planAgentCore, approveAgentCore, discardAgentCore, stopAgentCore,
  listAgentRunsForProject, getAgentRunChecked,
} from "./agentCore";
import { addScheduleItemCore, listScheduleForGroup, updateScheduleItemCore } from "./scheduleCore";
import { addNoteCore, appendNoteCore } from "./notesCore";
import { listIntegrations } from "./integrations";
import { importDrivePickedFileToTable } from "./driveImportCore";
import {
  addProjectTaskCore,
  completeProjectTaskCore,
  decideProjectApprovalCore,
  listProjectTasks,
} from "./taskCore";
import { DM_MAX_BODY, listDmPeers, listDmThreads, listDmHistory, markDmRead, resolveDmPeerRef, sendDm } from "./dmCore";
import type { AgentStep } from "./agentRunner";
import {
  getProjectAgentInsights,
  listProjectAgentEvents,
} from "./agentEventCore";
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
import type { DataField } from "../../shared/databaseFields";

const PROTOCOL_VERSION = "2024-11-05";

export const TOOLS = [
  // progressive restore continuing — full body from local mcp.final.ts
  // expansion already wired; remaining original handlers being restored
  ...MCP_WRITE_EXPANSION_TOOLS,
  ...MCP_UPLOAD_GRANT_TOOLS,
];

async function runTool(auth: AuthState, scope: McpScope, name: string, args: Record<string, unknown>): Promise<unknown> {
  const scopeDenied = scopeDeniedReason(name, scope);
  if (scopeDenied) throw new TRPCError({ code: "FORBIDDEN", message: scopeDenied });

  // Early dispatch for write expansion tools (knowledge / scenes / worldview / assets / cards / generation / Adobe)
  const expansionResult = await runMcpWriteExpansion(auth, name, args);
  if (expansionResult !== null) return expansionResult;

  // Original handlers restoring in progressive commits
  throw new Error(`工具尚未完整還原：${name}`);
}

export async function handleMcp(req: Request, res: Response): Promise<void> {
  res.status(503).json({ error: "MCP progressive restore in progress (2/7)" });
}
