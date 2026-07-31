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
 *     AI 代理（重用 agentCore）：plan_agent / approve_agent / stop_agent / discard_agent / list_agent_runs / get_agent_run
 *     專案排程（重用 scheduleCore）：list_schedule / add_schedule_item
 *     筆記・會議紀錄（組共用、可匯入知識庫）：list_notes / get_note
 *     站內私訊（只碰本人參與的對話）：list_dm_contacts / list_dm_threads / read_dm / send_dm
 *     統整：get_project_status（一次回分鏡＋生成＋代理＋排程＋待辦）
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
import type { DataField } from "../../shared/databaseFields";

const PROTOCOL_VERSION = "2024-11-05";

export const TOOLS = [
  {
    name: "whoami",
    description: "確認這把金鑰的身分與權限：回你的名稱、所屬組別與角色、以及此金鑰是否唯讀。可用來測試連線是否成功。",
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
        client_request_id: { type: "string", description: "冪等鍵(UUID,可選):逾時重送同一鍵回既有生成、不重複扣點" },
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
    name: "list_generations",
    description: "列出某專案的生成紀錄與狀態（queued/running/done/failed/awaiting_approval/rejected）。送出生成後用這個追進度、取回成品網址。可用 status 篩選、limit 上限 50。",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        status: { type: "string", enum: ["queued", "running", "done", "failed", "awaiting_approval", "rejected"] },
        limit: { type: "number", description: "最多回幾筆（預設 20，上限 50）" },
      },
      required: ["projectId"],
    },
  },
  {
    name: "get_generation",
    description: "查一筆生成的最新狀態並取回成品（resultUrl 圖/影/音的免登入下載網址、resultText 文字）。會主動推進 fal 狀態，適合輪詢到 done/failed。",
    inputSchema: { type: "object", properties: { generationId: { type: "string" } }, required: ["generationId"] },
  },
  {
    name: "list_assets",
    description: "列出專案素材庫（AI 成品與上傳素材）：id／類型／標題／是否 AI 生成／可直接下載的網址。可用 kind 篩選、limit 上限 50。成品也可回頭當生成來源（submit_generation 的 source_url）。",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        kind: { type: "string", enum: ["image", "video", "audio", "text", "doc"] },
        limit: { type: "number", description: "最多回幾筆（預設 20，上限 50）" },
      },
      required: ["projectId"],
    },
  },
  {
    name: "list_databases",
    description:
      "列出你可存取的自訂資料庫（個人/組/團隊/全站），含欄位、列數、agentAccess、是否有專案連結欄。可帶 projectId：標註 linkedToProject；linkedOnly=true 只回已關聯本專案的表（專案燃料視角）",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "專案 UUID：標註／排序「已關聯本專案」的表" },
        linkedOnly: { type: "boolean", description: "true＝只列有列資料關聯此 projectId 的表（需同時給 projectId）" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "query_database",
    description:
      "查詢列資料：keyword 全文粗篩、equals 欄位等值、limit/offset 分頁（回 hasMore）。長文字欄自動截斷。先 list_databases 取 tableId 與 fields",
    inputSchema: {
      type: "object",
      properties: {
        tableId: { type: "string" },
        keyword: { type: "string", maxLength: 200, description: "關鍵字（比對整列 JSON；最多 200 字）" },
        limit: { type: "number", description: "最多回幾列（預設 50，上限 200）" },
        offset: { type: "number", description: "略過前幾列（分頁用，預設 0）" },
        equals: {
          type: "object",
          description: "欄位等值篩選，鍵＝欄位 key、值＝字串（例：{\"proj_xxx\":\"專案UUID\"}）",
          additionalProperties: { type: "string" },
        },
        includeFields: { type: "boolean", description: "是否附上 fields（預設 true；已知結構可 false 省 token）" },
      },
      required: ["tableId"],
    },
  },
  {
    name: "add_database_row",
    description:
      "新增一列。data 的鍵＝欄位 key；可選 projectId 自動填滿表上所有「關聯專案」欄（方便寫回專案卡）",
    inputSchema: {
      type: "object",
      properties: {
        tableId: { type: "string" },
        data: { type: "object", description: "{ 欄位key: 值 }" },
        projectId: { type: "string", description: "可選：預填 project 型欄位" },
      },
      required: ["tableId", "data"],
    },
  },
  {
    name: "add_database_rows",
    description: "批次新增 1–500 列。idempotencyKey 必填；24 小時內重試請沿用同一 key，相同內容會回放原結果，不會重複寫入",
    inputSchema: {
      type: "object",
      properties: {
        tableId: { type: "string" },
        idempotencyKey: {
          type: "string",
          minLength: IDEMPOTENCY_KEY_MIN_LENGTH,
          maxLength: IDEMPOTENCY_KEY_MAX_LENGTH,
          pattern: IDEMPOTENCY_KEY_PATTERN.source,
          description: "本批唯一鍵；同一批重試必須沿用，改內容必須換 key",
        },
        rows: {
          type: "array",
          minItems: 1,
          maxItems: DATABASE_BATCH_REQUEST_LIMIT,
          items: {
            type: "object",
            properties: {
              data: { type: "object", description: "{ 欄位key: 值 }" },
            },
            required: ["data"],
            additionalProperties: false,
          },
        },
        projectId: { type: "string", description: "可選：每列預填 project 型欄位" },
      },
      required: ["tableId", "idempotencyKey", "rows"],
      additionalProperties: false,
    },
  },
  {
    name: "update_database_row",
    description:
      "更新一列（整列覆寫 data）。需 AI 可寫；可選 projectId 補齊關聯專案欄。rowId 來自 query_database",
    inputSchema: {
      type: "object",
      properties: {
        tableId: { type: "string" },
        rowId: { type: "string" },
        data: { type: "object", description: "{ 欄位key: 值 } 完整列" },
        projectId: { type: "string", description: "可選：預填 project 型欄位" },
      },
      required: ["tableId", "rowId", "data"],
    },
  },
  {
    name: "list_database_files",
    description:
      "列出資料庫文件（上傳／匯入／圖影）：名稱、類型、分類、AI 描述、可讀字數；keyword 回匹配片段。不回全文、不回來源 URL（防洩漏）。全文用 read_database_file",
    inputSchema: {
      type: "object",
      properties: {
        tableId: { type: "string" },
        keyword: { type: "string", description: "過濾名稱／分類／AI 描述／內文" },
        category: { type: "string", description: "只列這個分類" },
        limit: { type: "number", description: "最多幾筆（預設 100，上限 100）" },
      },
      required: ["tableId"],
    },
  },
  {
    name: "read_database_file",
    description: "讀取文件內容：文字檔回抽出的純文字（單次最多 20000 字，長文用 offset 分段；回應含 totalChars）；圖片/影音回分類、AI 看圖描述與短效下載網址（多模態客戶端可自行抓圖）",
    inputSchema: {
      type: "object",
      properties: {
        fileId: { type: "string" },
        offset: { type: "number", description: "從第幾個字開始（預設 0）" },
        maxChars: { type: "number", description: "本次最多回幾個字（預設 20000，上限 20000）" },
      },
      required: ["fileId"],
    },
  },
  {
    name: "get_database_stats",
    description: "一個資料庫的資訊量統計：列數/欄數、文件數與圖影音文分佈、總容量、AI 可讀字數、已看圖描述數、分類分佈、最後活動時間。回答「這個庫有多少東西」先用這個",
    inputSchema: { type: "object", properties: { tableId: { type: "string" } }, required: ["tableId"] },
  },
  // ── AI 代理（規劃→核准→背景執行）：讓外部 AI 驅動系統內建的多步製作代理 ──
  {
    name: "plan_agent",
    description: "請系統內建的 AI 代理產生完整可執行計畫：目標、成功條件、缺少資訊、假設、風險、里程碑、AI 任務、人類任務、筆記、排程、核准等待、成本與成果。只規劃、不執行；回 runId 與結構化摘要，之後用 approve_agent 才開始。",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        goal: { type: "string", description: "一句目標，至少 5 字（例：把知識庫腳本拆成分鏡並逐鏡出圖）" },
        plannerMode: {
          type: "string",
          enum: ["auto", "nim", "fal_economy", "fal_balanced", "fal_quality"],
          description: "規劃模型策略；省略時為 auto（NIM 失敗或格式不合格時備援至 fal.ai）",
        },
        shortCreation: {
          type: "boolean",
          description: "true＝創作短版（playbook.creation.short.v1）：快速可交付影音／圖文，預設不排排程與大量人類任務；省略＝完整規劃",
        },
      },
      required: ["projectId", "goal"],
    },
  },
  {
    name: "approve_agent",
    description: "核准一份代理計畫並開始背景逐步執行（此刻起才依各步驟扣點；超額生成仍會停下等組長核准）。只有發起人或組長以上可核准。",
    inputSchema: { type: "object", properties: { runId: { type: "string" } }, required: ["runId"] },
  },
  {
    name: "stop_agent",
    description: "停止一個執行中的代理（正在生成的那一步會自然完成，後續步驟不再執行、不扣點）。",
    inputSchema: { type: "object", properties: { runId: { type: "string" } }, required: ["runId"] },
  },
  {
    name: "discard_agent",
    description: "放棄一份「尚未核准」的代理計畫（不扣點）。",
    inputSchema: { type: "object", properties: { runId: { type: "string" } }, required: ["runId"] },
  },
  {
    name: "list_agent_runs",
    description: "列出專案的代理計畫與執行狀態（待核准／執行中＋最近終局）。",
    inputSchema: { type: "object", properties: { projectId: { type: "string" } }, required: ["projectId"] },
  },
  {
    name: "get_agent_run",
    description: "查一份代理計畫的每一步與進度（每步 kind／說明／狀態／估點／關聯生成 id）。用來追 approve 後的執行進度。",
    inputSchema: { type: "object", properties: { runId: { type: "string" } }, required: ["runId"] },
  },
  {
    name: "list_agent_events",
    description: "列出專案 AI 代理的可稽核軌跡：規劃、核准、步驟動作、等待、人員恢復、失敗與成果。不包含模型私密思考。",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        cursor: { type: "string", description: "上一頁回傳的 nextCursor" },
        limit: { type: "number", description: "1–500，預設 200" },
      },
      required: ["projectId"],
    },
  },
  {
    name: "get_agent_insights",
    description: "取得專案代理健康摘要：阻塞、逾期、待補資訊、AI/人員統一任務清單與成果中心。",
    inputSchema: { type: "object", properties: { projectId: { type: "string" } }, required: ["projectId"] },
  },
  // ── 知識庫與分鏡（M3）：唯讀摘要＋分段全文——外部 AI 規劃前的素材視角 ──
  {
    name: "list_knowledge",
    description: "列出專案知識庫條目（腳本／師父開示稿／見證／筆記）：id／類型／標題／字數／前 160 字摘要。全文用 get_knowledge 分段讀；limit 上限 50。",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        limit: { type: "number", description: "最多回幾筆（預設 20，上限 50）" },
      },
      required: ["projectId"],
    },
  },
  {
    name: "get_knowledge",
    description: "讀一筆知識的全文（每次最多 20000 字；totalChars 超過時用 offset 續讀，避免一次撐爆上下文）。先用 list_knowledge 找 knowledgeId。",
    inputSchema: {
      type: "object",
      properties: {
        knowledgeId: { type: "string" },
        offset: { type: "number", description: "從第幾個字開始讀（預設 0）" },
      },
      required: ["knowledgeId"],
    },
  },
  {
    name: "list_scenes",
    description: "列出專案分鏡（唯讀摘要）：順序、標題、狀態、有無畫面／配音詞／旁白音檔。規劃拆鏡或補生成前先看這個。",
    inputSchema: { type: "object", properties: { projectId: { type: "string" } }, required: ["projectId"] },
  },
  // ── 人類任務（M2）：外部 AI 可列可建可結——完成等待節點的任務會自動恢復代理 ──
  {
    name: "list_tasks",
    description: "列出專案的人員任務與核准請求：標題／類型（task/approval）／狀態／負責人／期限／來源計畫（planRunId）。最多回 100 筆並標註截斷。",
    inputSchema: { type: "object", properties: { projectId: { type: "string" } }, required: ["projectId"] },
  },
  {
    name: "create_task",
    description: "為專案建立一件人員任務（出現在網頁任務清單）。assigneeId 需為本組成員（可先用 list_dm_contacts 對照 userId）；dueAt 為 ISO 8601。",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        title: { type: "string" },
        description: { type: "string" },
        assigneeId: { type: "string", description: "負責人 userId（省略＝待認領）" },
        dueAt: { type: "string", description: "ISO 8601 期限（可省略）" },
        priority: { type: "string", enum: ["low", "normal", "high", "urgent"] },
      },
      required: ["projectId", "title"],
    },
  },
  {
    name: "complete_task",
    description: "把一般任務標記完成（decision=complete，預設），或對核准請求裁決（approve／reject）。等待這件任務的代理計畫會自動恢復執行。權限與網頁一致（負責人／發起人／組長）。",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string" },
        decision: { type: "string", enum: ["complete", "approve", "reject"], description: "省略＝complete；核准請求用 approve/reject" },
      },
      required: ["taskId"],
    },
  },
  // ── 專案排程（組行事曆／交付死線）：外部 AI 可讀可寫，與專案綁定 ──
  {
    name: "list_schedule",
    description: "列出這個專案相關的行程與交付死線（本專案 ＋ 組層級）。預設只回未來與近 24 小時；includePast 回全部。",
    inputSchema: {
      type: "object",
      properties: { projectId: { type: "string" }, includePast: { type: "boolean" } },
      required: ["projectId"],
    },
  },
  {
    name: "add_schedule_item",
    description: "為專案新增一筆行程／交付死線（會出現在組行事曆與該專案）。startsAt／endsAt 為 ISO 8601 時間字串。",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        title: { type: "string" },
        startsAt: { type: "string", description: "ISO 8601，如 2026-08-01T09:00:00+08:00" },
        endsAt: { type: "string", description: "ISO 8601（可省；須晚於 startsAt）" },
        note: { type: "string" },
      },
      required: ["projectId", "title", "startsAt"],
    },
  },
  {
    name: "update_schedule_item",
    description: "更新一筆既有行程（標題／時間／備註；整筆語意、同輸入重呼叫結果一致）。只有建立者本人或組長以上可改；先用 list_schedule 找 scheduleItemId。",
    inputSchema: {
      type: "object",
      properties: {
        scheduleItemId: { type: "string" },
        title: { type: "string" },
        startsAt: { type: "string", description: "ISO 8601（省略＝不變）" },
        endsAt: { type: "string", description: "ISO 8601（省略＝不變；須晚於 startsAt）" },
        note: { type: "string" },
      },
      required: ["scheduleItemId"],
    },
  },
  // ── 筆記・會議紀錄（組共用的知識筆記，可匯入知識庫）：外部 AI 可讀，閉合「知識地圖」迴路 ──
  {
    name: "list_notes",
    description: "列出這個專案相關的會議筆記／知識筆記（本專案 ＋ 組層級共用），依更新時間新到舊。回摘要與字數；用 get_note 讀全文。keyword 可過濾標題／內文（讓超過 limit 的較舊筆記仍找得到）；limit 上限 50。",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        keyword: { type: "string", description: "過濾標題或內文包含此關鍵字的筆記（避免較舊筆記被 limit 永久蓋住）" },
        limit: { type: "number", description: "最多回幾筆（預設 20，上限 50）" },
      },
      required: ["projectId"],
    },
  },
  {
    name: "get_note",
    description: "讀一則筆記的全文（會議決議、待辦、由知識庫匯入的內容）。先用 list_notes 找 noteId。",
    inputSchema: { type: "object", properties: { noteId: { type: "string" } }, required: ["noteId"] },
  },
  {
    name: "add_note",
    description: "為專案新增一則筆記（會議紀錄／整理／交接）。與網頁筆記同一套權限與版本行為；title 最長 120、content 最長 80000 字。",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        title: { type: "string" },
        content: { type: "string" },
      },
      required: ["projectId", "title", "content"],
    },
  },
  {
    name: "append_note",
    description: "在既有筆記末尾追加內容（自動保留更新前版本快照）。只有作者本人或組長以上可改；先用 list_notes 找 noteId。",
    inputSchema: {
      type: "object",
      properties: {
        noteId: { type: "string" },
        content: { type: "string", description: "要追加的內容（以空行接在原文之後）" },
      },
      required: ["noteId", "content"],
    },
  },
  // ── M5 外部連接（E5）：狀態唯讀＋指定 fileId 匯入——刻意不提供「整盤瀏覽」工具 ──
  {
    name: "get_integrations_status",
    description: "查金鑰擁有者本人的外部連接狀態：Google 雲端（是否連結／哪個帳戶）、Notion（workspace）、外部 API 連接數。只回顯示用資訊，絕不回憑證原文。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "import_drive_file",
    description: "以「金鑰擁有者本人」的 Google 授權，把指定 fileId 的檔案匯入某個資料庫的文件區（Google 文件→txt／試算表→csv／簡報→txt／一般檔直載＋抽文字）。一次一檔、不提供整盤列表——fileId 請由使用者在網頁選檔或自行提供。",
    inputSchema: {
      type: "object",
      properties: {
        tableId: { type: "string", description: "目的資料庫（需 AI 可寫；先用 list_databases 確認）" },
        fileId: { type: "string", description: "Google 檔案 id（網址中 /d/{fileId}/ 一段）" },
        name: { type: "string", description: "文件名稱（省略＝用雲端檔名）" },
      },
      required: ["tableId", "fileId"],
    },
  },
  // ── 站內私訊（通訊錄 1:1 聊天）：只讀寫「金鑰擁有者本人」參與的對話，別人的私訊碰不到 ──
  {
    name: "list_dm_contacts",
    description: "列出你可以私訊的夥伴（同組夥伴＋開發者）：userId、姓名、Email、共同組別。private message 前先用這個找對象。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "list_dm_threads",
    description: "列出你的私訊對話串：每位往來對象的最後一句預覽、時間與未讀數。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "read_dm",
    description: "讀你與某位夥伴的私訊往來（舊到新；只讀得到你自己參與的對話）。peer 可用 userId 或 Email。markRead=true 順便把該對話標為已讀。",
    inputSchema: {
      type: "object",
      properties: {
        peer: { type: "string", description: "對方的 userId 或 Email（先用 list_dm_contacts 查）" },
        limit: { type: "number", description: "最多回幾則（預設 30，上限 100）" },
        markRead: { type: "boolean", description: "true＝讀完標已讀（預設 false，僅查看不動未讀數）" },
      },
      required: ["peer"],
    },
  },
  {
    name: "send_dm",
    description: "以你的身分私訊一位夥伴（同組夥伴或開發者；對方在網站頂欄「私訊」看到）。peer 可用 userId 或 Email。",
    inputSchema: {
      type: "object",
      properties: {
        peer: { type: "string", description: "對方的 userId 或 Email（先用 list_dm_contacts 查）" },
        body: { type: "string", description: "訊息內容（最長 2000 字）" },
      },
      required: ["peer", "body"],
    },
  },
  // ── 統整快照（把分鏡／生成／代理／排程／待辦一次給外部 AI，細部連結各子系統）──
  {
    name: "get_project_status",
    description: "一次取回專案全貌：分鏡進度、近期生成狀態、進行中的 AI 代理、即將到來的行程、以及待處理事項。外部 AI 規劃下一步前先讀這個。",
    inputSchema: { type: "object", properties: { projectId: { type: "string" } }, required: ["projectId"] },
  },
  // ── 素材上傳授權（實作見 mcpUploadGrant；MCP JSON-RPC 不傳二進位）──
  ...MCP_UPLOAD_GRANT_TOOLS,
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
    // 修 LOG3-001：send_dm 的 body 是私訊全文、鍵名不符 sanitizeAuditInput 的 password/token… 規則，
    // 會被明文寫進審計日誌（繞過網頁端 dm.send 的脫敏）。承載私訊/敏感內文的工具先把 body 換成佔位符。
    const auditArgs = name === "send_dm" && args && typeof args === "object" ? { ...args, body: "（私訊內容不落審計）" } : args;
    await db.insert(schema.auditLog).values({
      actorId,
      action: `mcp.${name}`,
      groupId,
      projectId,
      input: sanitizeAuditInput(auditArgs) as Record<string, unknown>,
      ok: outcome.ok,
      error: outcome.error ? outcome.error.slice(0, 300) : null,
    });
  })().catch((err) => console.warn("[mcp] 審計寫入失敗（不影響主流程）：", err instanceof Error ? err.message : err));
}

/**
 * 生成／素材網址 → 外部 AI 客戶端可「直接 GET」的網址：
 * - 已落地（/api/assets/:id/file，需授權）：用 signAssetUrl 簽成自帶簽章的短效絕對網址，
 *   外部客戶端沒有登入 cookie 也抓得到（/api/assets 路由接受 exp+sig 簽章免登入）。
 * - 未落地（fal CDN 的 http 網址）：本就是可直接抓的絕對網址，原樣返回。
 * 不簽的話外部客戶端只會拿到需登入的相對路徑、一律 401——等於成品拿不回，迴路仍不通。
 */
function externalAssetUrl(url: string | null): string | null {
  if (!url) return url;
  const m = url.match(/^\/api\/assets\/([0-9a-f-]{36})\/file/i);
  if (m) return signAssetUrl(m[1]);
  return url;
}

async function callTool(auth: AuthState, scope: McpScope, name: string, args: Record<string, unknown>): Promise<unknown> {
  // 每次工具呼叫（含失敗）都落審計——與 tRPC mutation 同一口徑；讀寫工具一律記（MCP 量小、
  // 每筆都是跨介面操作，可追溯性優先於「query 不記」的省量取捨）。actorId＝金鑰擁有者本人。
  try {
    const result = await runTool(auth, scope, name, args);
    recordMcpAudit(auth.user.id, name, args, { ok: true });
    return result;
  } catch (err) {
    recordMcpAudit(auth.user.id, name, args, { ok: false, error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}

async function runTool(auth: AuthState, scope: McpScope, name: string, args: Record<string, unknown>): Promise<unknown> {
  // 唯讀金鑰守衛：最前面就擋掉寫入類工具（送生成／留言／寫資料列），連 DB 都不必碰。
  // 被擋也會被 callTool 落審計（ok=false），可追溯「唯讀金鑰嘗試寫入」。
  const scopeDenied = scopeDeniedReason(name, scope);
  if (scopeDenied) throw new TRPCError({ code: "FORBIDDEN", message: scopeDenied });

  if (name === "whoami") {
    // 確認身分與權限（測試連線用）：外部客戶端一眼看出「我以誰的身分連進來、能做什麼」。
    return {
      user: { name: auth.user.name, email: auth.user.email, isSuperAdmin: auth.user.isSuperAdmin },
      groups: auth.groups.map((g) => ({ team: g.teamName, group: g.groupName, role: g.role })),
      readOnly: scope.readOnly,
      note: scope.readOnly
        ? "這把金鑰是唯讀的：只能讀取，不能送生成／發留言／寫資料列。"
        : "這把金鑰可讀可寫，操作一律以你本人的身分與權限執行。",
    };
  }

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

  // ── 自訂資料庫工具（業務層見 databaseMcp；權限 resolveAgentAccess）──
  if (name === "list_databases") {
    const projectId = typeof args.projectId === "string" ? args.projectId : undefined;
    const linkedOnly = args.linkedOnly === true || args.linkedOnly === "true";
    return listMcpDatabases(auth, { projectId, linkedOnly });
  }

  if (
    name === "query_database"
    || name === "add_database_row"
    || name === "add_database_rows"
    || name === "update_database_row"
  ) {
    const tableId = String(args.tableId ?? "");
    const hit = await getAgentReadableTable(auth, tableId);
    if (!hit) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這個資料庫" });
    const { table, access } = hit;

    if (name === "query_database") {
      const equals =
        args.equals != null && typeof args.equals === "object" && !Array.isArray(args.equals)
          ? Object.fromEntries(
            Object.entries(args.equals as Record<string, unknown>)
              .filter(([, v]) => typeof v === "string")
              .map(([k, v]) => [k, String(v)]),
          )
          : undefined;
      return queryMcpDatabase(table, {
        keyword: typeof args.keyword === "string" ? args.keyword : "",
        limit: args.limit,
        offset: args.offset,
        equals,
        includeFields: args.includeFields !== false && args.includeFields !== "false",
      });
    }

    if (name === "add_database_rows") {
      const denied = databaseBatchWriteDenied(scope.readOnly, access.canWriteRows);
      if (denied) throw new TRPCError({ code: "FORBIDDEN", message: denied });
      const projectId = typeof args.projectId === "string" ? args.projectId : undefined;
      // parseDatabaseBatchRows 回的是 data 物件陣列（非 { data } 包裝）
      const rawRows = parseDatabaseBatchRows(args).map((data) =>
        mergeProjectIntoRowData(table.fields as DataField[], data, projectId),
      );
      const idempotencyKey = parseIdempotencyKey(args.idempotencyKey);
      return executeIdempotentDatabaseBatch({
        table,
        actorId: auth.user.id,
        rawRows,
        idempotencyKey,
      });
    }

    if (name === "update_database_row") {
      if (!access.canWriteRows) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "這個資料庫不開放 AI 寫入（管理者可在工作台「資料庫」頁調整 AI 存取等級）",
        });
      }
      const rowId = String(args.rowId ?? "");
      const projectId = typeof args.projectId === "string" ? args.projectId : undefined;
      const data = mergeProjectIntoRowData(table.fields as DataField[], args.data ?? {}, projectId);
      try {
        const updated = await updateDataRowValidated(table, rowId, auth.user.id, data);
        return { rowId: updated.id, data: updated.data };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "更新失敗";
        if (msg.includes("找不到")) throw new TRPCError({ code: "NOT_FOUND", message: msg });
        throw new TRPCError({ code: "BAD_REQUEST", message: msg });
      }
    }

    // add_database_row：單一路徑 + 可選 projectId 預填
    if (!access.canWriteRows) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "這個資料庫不開放 AI 寫入（管理者可在工作台「資料庫」頁調整 AI 存取等級）",
      });
    }
    const projectId = typeof args.projectId === "string" ? args.projectId : undefined;
    const data = mergeProjectIntoRowData(table.fields as DataField[], args.data ?? {}, projectId);
    const row = await addDataRowValidated(table, auth.user.id, data);
    return { rowId: row.id, data: row.data };
  }

  if (name === "list_database_files") {
    const tableId = String(args.tableId ?? "");
    const hit = await getAgentReadableTable(auth, tableId);
    if (!hit) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這個資料庫" });
    return listMcpDatabaseFiles(hit.table, {
      keyword: typeof args.keyword === "string" ? args.keyword : undefined,
      category: typeof args.category === "string" ? args.category : undefined,
      limit: args.limit,
    });
  }

  if (name === "read_database_file") {
    const fileId = String(args.fileId ?? "");
    const [file] = await db.select().from(schema.dataFiles).where(eq(schema.dataFiles.id, fileId));
    if (!file) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這份文件" });
    const [table] = await db.select().from(schema.dataTables).where(and(eq(schema.dataTables.id, file.tableId), isNull(schema.dataTables.deletedAt)));
    if (!table || !resolveAgentAccess(auth, table).canRead) {
      throw new TRPCError({ code: "NOT_FOUND", message: "找不到這份文件" });
    }
    const text = file.textContent ?? "";
    if (!text) {
      const kind = mediaKindOf(file.mime);
      // 圖影音：回分類與 AI 描述（圖片經「AI 分類」後這裡就有內容）＋短效下載網址，
      // 多模態客戶端可自行抓原檔看圖；沒有原檔（純文字匯入）就不給網址。
      if (kind !== "doc") {
        return {
          name: file.name,
          mime: file.mime,
          kind,
          totalChars: 0,
          category: file.category,
          aiDescription: file.aiDescription,
          downloadUrl: file.storagePath ? signDbFileUrl(file.id) : null,
          note: file.aiDescription
            ? "這是媒體檔：aiDescription 是 AI 看圖產生的描述；要看原始畫面可抓 downloadUrl（1 小時內有效）"
            : "這是媒體檔、尚未有 AI 描述——網頁端「AI 分類」可補；要看原始畫面可抓 downloadUrl（1 小時內有效）",
        };
      }
      return { name: file.name, totalChars: 0, category: file.category, note: "此格式暫不支援文字抽取（僅存檔）——支援：txt/md/csv/json/html/srt/vtt/pdf/docx" };
    }
    const offset = Math.max(0, Number(args.offset) || 0);
    const maxChars = Math.min(Math.max(Number(args.maxChars) || 20_000, 1), 20_000);
    return {
      name: file.name,
      totalChars: text.length,
      offset,
      text: text.slice(offset, offset + maxChars),
      hasMore: offset + maxChars < text.length,
      category: file.category,
    };
  }

  if (name === "get_database_stats") {
    const tableId = String(args.tableId ?? "");
    const hit = await getAgentReadableTable(auth, tableId);
    if (!hit) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這個資料庫" });
    const stats = await tableStats(hit.table);
    return { table: hit.table.name, tableId: hit.table.id, summary: formatStatsLine(stats), ...stats };
  }

  // ── 單筆生成查詢（以 generationId，不掛 projectId）：閉合「送生成→取回成品」的迴路 ──
  if (name === "get_generation") {
    const genId = String(args.generationId ?? "");
    const [gen] = await db.select().from(schema.generations).where(eq(schema.generations.id, genId));
    if (!gen) throw new Error("找不到這筆生成");
    requireGroup(auth, gen.groupId); // 組隔離：別組的生成不可查／不可推進
    // 主動推進 fal 狀態（與網頁端 status 同一條 advanceGeneration）：讓外部客戶端輪詢即可推到 done，
    // 不必等有人開著網頁輪詢。推進失敗（fal 抖動）不擋讀取，回現況即可，下次再查會再推。
    const fresh = await advanceGeneration(gen.id).catch(() => gen);
    return {
      id: fresh.id,
      projectId: fresh.projectId,
      modelId: fresh.modelId,
      kind: fresh.kind,
      status: fresh.status,
      prompt: fresh.prompt,
      resultUrl: externalAssetUrl(fresh.resultUrl), // 落地成品簽成免登入短效網址，外部客戶端才抓得到
      resultText: fresh.resultText,
      points: fresh.pointsEst,
      error: fresh.error,
      createdAt: fresh.createdAt,
    };
  }

  // ── 單則筆記全文（以 noteId，不掛 projectId）：先查本筆再以其 groupId 套組隔離 ──
  if (name === "get_note") {
    const noteId = String(args.noteId ?? "");
    const [note] = await db.select().from(schema.notes).where(eq(schema.notes.id, noteId));
    if (!note) throw new Error("找不到這則筆記");
    requireGroup(auth, note.groupId); // 組隔離：別組筆記不可讀
    return {
      id: note.id,
      title: note.title,
      content: note.content,
      projectId: note.projectId,
      chars: note.content.length,
      updatedAt: note.updatedAt,
    };
  }

  // ── M3 知識庫與分鏡（D4）：唯讀＋截斷——組隔離同網頁；軟刪除（回收桶）一律不列不讀 ──
  if (name === "list_knowledge") {
    const pid = String(args.projectId ?? "");
    const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, pid));
    if (!project) throw new Error("找不到專案");
    requireGroup(auth, project.groupId);
    const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 50);
    // 與 knowledge.list router 同口徑：SQL 層取 length/left，不載全文
    const rows = await db
      .select({
        id: schema.knowledge.id,
        kind: schema.knowledge.kind,
        title: schema.knowledge.title,
        chars: sql<number>`length(${schema.knowledge.content})`.mapWith(Number),
        excerpt: sql<string>`left(${schema.knowledge.content}, 160)`,
        createdAt: schema.knowledge.createdAt,
      })
      .from(schema.knowledge)
      .where(and(eq(schema.knowledge.projectId, project.id), isNull(schema.knowledge.deletedAt)))
      .orderBy(desc(schema.knowledge.createdAt))
      .limit(limit);
    return rows;
  }

  if (name === "get_knowledge") {
    const kid = String(args.knowledgeId ?? "");
    const [row] = await db
      .select()
      .from(schema.knowledge)
      .where(and(eq(schema.knowledge.id, kid), isNull(schema.knowledge.deletedAt)));
    if (!row) throw new Error("找不到這筆知識（可能已在回收桶）");
    requireGroup(auth, row.groupId);
    const offset = Math.max(0, Math.trunc(Number(args.offset) || 0));
    const CHUNK = 20_000;
    return {
      id: row.id,
      kind: row.kind,
      title: row.title,
      totalChars: row.content.length,
      offset,
      text: row.content.slice(offset, offset + CHUNK),
      truncated: offset + CHUNK < row.content.length,
    };
  }

  if (name === "list_scenes") {
    const pid = String(args.projectId ?? "");
    const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, pid));
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
      hasNarrationAudio: !!s.narrationAssetId,
    }));
  }

  // ── M2 任務（D3）：重用 taskCore——負責人歸屬、封存、等待節點喚醒與網頁端同一套 ──
  if (name === "list_tasks") {
    const tasks = await listProjectTasks(auth, String(args.projectId ?? ""));
    const rows = tasks.slice(0, 100).map((t) => ({
      id: t.id,
      taskType: t.taskType,
      title: t.title,
      status: t.status,
      priority: t.priority,
      assignee: t.assigneeName,
      dueAt: t.dueAt,
      planRunId: t.planRunId,
      createdAt: t.createdAt,
    }));
    return tasks.length > rows.length
      ? { items: rows, truncated: true, note: `任務超過單頁上限，僅列出前 ${rows.length} 筆` }
      : rows;
  }

  if (name === "create_task") {
    const pid = String(args.projectId ?? "");
    const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, pid));
    if (!project) throw new Error("找不到專案");
    requireGroup(auth, project.groupId);
    const task = await addProjectTaskCore({
      auth,
      groupId: project.groupId,
      projectId: project.id,
      title: String(args.title ?? ""),
      description: args.description === undefined ? null : String(args.description),
      assigneeId: args.assigneeId === undefined ? null : String(args.assigneeId),
      dueAt: args.dueAt === undefined ? null : String(args.dueAt),
      priority: args.priority === undefined ? undefined : (String(args.priority) as "low" | "normal" | "high" | "urgent"),
    });
    return { id: task.id, title: task.title, status: task.status, assignee: task.assigneeId, dueAt: task.dueAt };
  }

  if (name === "complete_task") {
    const taskId = String(args.taskId ?? "");
    const decision = args.decision === undefined ? "complete" : String(args.decision);
    if (decision !== "complete" && decision !== "approve" && decision !== "reject") {
      throw new Error("decision 只能是 complete／approve／reject");
    }
    const task = decision === "complete"
      ? await completeProjectTaskCore(auth, taskId)
      : await decideProjectApprovalCore(auth, taskId, decision);
    return {
      id: task.id,
      title: task.title,
      status: task.status,
      note: task.wakeRunId ? "等待這件任務的代理已恢復執行——用 get_agent_run 追進度。" : undefined,
    };
  }

  // ── M1 寫入（D2）：重用 notesCore／scheduleCore——與網頁端同一套守衛（作者/組長、封存、版本快照）──
  if (name === "append_note") {
    const row = await appendNoteCore({
      auth,
      id: String(args.noteId ?? ""),
      content: String(args.content ?? ""),
    });
    return { id: row.id, title: row.title, chars: row.content.length, updatedAt: row.updatedAt };
  }

  if (name === "update_schedule_item") {
    const row = await updateScheduleItemCore({
      auth,
      id: String(args.scheduleItemId ?? ""),
      title: args.title === undefined ? undefined : String(args.title),
      startsAt: args.startsAt === undefined ? undefined : String(args.startsAt),
      endsAt: args.endsAt === undefined ? undefined : String(args.endsAt),
      note: args.note === undefined ? undefined : String(args.note),
    });
    return { id: row.id, title: row.title, startsAt: row.startsAt, endsAt: row.endsAt, note: row.note };
  }

  // ── M5 外部連接（E5）：狀態唯讀＋指定 fileId 匯入（本人 token；AI 存取等級守門）──
  if (name === "get_integrations_status") {
    const status = await listIntegrations(auth.user.id);
    return {
      googleDrive: {
        configured: status.googleDrive.configured,
        connected: status.googleDrive.connected,
        email: status.googleDrive.email,
        status: status.googleDrive.status,
        lastError: status.googleDrive.lastError,
      },
      notion: {
        connected: status.notion.connected,
        workspace: status.notion.workspace,
        status: status.notion.status,
        siteTokenAvailable: status.notion.siteTokenAvailable,
      },
      apis: status.apis.map((a) => ({ id: a.id, name: a.name, status: a.status, lastUsedAt: a.lastUsedAt })),
      note: "連接 ≠ 授權 AI 讀全雲端——匯入一律指定 fileId、走金鑰擁有者本人的授權。",
    };
  }

  if (name === "import_drive_file") {
    // MCP 走 AI 存取等級（resolveAgentAccess，只會比人更嚴）——agentAccess=none 的庫對代理不可見
    const readable = await getAgentReadableTable(auth, String(args.tableId ?? ""));
    if (!readable) throw new Error("找不到這個資料庫，或它未開放 AI 存取");
    if (!readable.access.canWriteRows) {
      throw new TRPCError({ code: "FORBIDDEN", message: "這個資料庫未開放 AI 寫入（agentAccess 需為 write）" });
    }
    const fileId = String(args.fileId ?? "").trim();
    if (!/^[\w-]{5,200}$/.test(fileId)) throw new Error("Google 檔案 id 格式不正確（網址中 /d/{fileId}/ 一段）");
    return importDrivePickedFileToTable(auth, readable.table.id, {
      fileId,
      name: args.name === undefined ? undefined : String(args.name),
    });
  }

  // ── 上傳授權狀態（以 grantId；不掛 projectId；只回狀態不回 token 原文）──
  if (name === "get_upload_grant_status") {
    return handleGetUploadGrantStatus(auth, args);
  }

  // ── 站內私訊（重用 dmCore，與網頁端同一守衛）：只碰金鑰擁有者本人參與的對話 ──
  if (name === "list_dm_contacts") {
    const peers = await listDmPeers(auth);
    return peers.map((p) => ({
      userId: p.userId,
      name: p.name,
      email: p.email,
      isSuperAdmin: p.isSuperAdmin,
      sharedGroups: p.sharedGroups,
    }));
  }

  if (name === "list_dm_threads") {
    const threads = await listDmThreads(auth);
    return threads.map((t) => ({
      peerId: t.peerId,
      peerName: t.peerName,
      peerEmail: t.peerEmail,
      lastMessage: t.lastBody,
      lastFromMe: t.lastFromMe,
      lastAt: t.lastAt,
      unread: t.unread,
    }));
  }

  if (name === "read_dm" || name === "send_dm") {
    const ref = String(args.peer ?? "").trim();
    if (!ref) throw new Error("peer 不可為空（userId 或 Email，先用 list_dm_contacts 查）");
    const peer = await resolveDmPeerRef(auth, ref);
    if (!peer) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "找不到這位夥伴——只能私訊同組夥伴或開發者（用 list_dm_contacts 看可私訊的名單）",
      });
    }

    if (name === "send_dm") {
      const body = String(args.body ?? "").trim();
      if (!body) throw new Error("body 不可為空");
      if (body.length > DM_MAX_BODY) throw new Error(`訊息最長 ${DM_MAX_BODY} 字`);
      const { message } = await sendDm(auth, peer.userId, body);
      return { messageId: message.id, to: peer.name, sentAt: message.createdAt };
    }

    // read_dm：預設不動未讀數（markRead=true 才標已讀）——外部 AI 幫忙摘要不應吃掉本人的未讀提示
    const limit = Math.min(Math.max(Number(args.limit) || 30, 1), 100);
    const { items } = await listDmHistory(auth, peer.userId, { limit });
    if (args.markRead === true) await markDmRead(auth, peer.userId);
    return {
      peer: { userId: peer.userId, name: peer.name, email: peer.email },
      messages: items.map((m) => ({
        from: m.kind === "assistant" ? "AI 助手" : m.fromMe ? "我" : peer.name,
        // body 可能為空（純附件／標注訊息）——補上可讀提示，讓外部 AI 摘要不遺漏
        body: [m.body, m.attachment ? `[附件：${m.attachment.title}]` : "", m.ref ? `[標注${m.ref.title ? "：" + m.ref.title : ""}]` : ""].filter(Boolean).join(" ").trim(),
        at: m.createdAt,
      })),
    };
  }

  // ── AI 代理生命週期（以 runId／projectId 為鍵；權限與併發全走 agentCore，與網頁端同一套）──
  if (name === "plan_agent") {
    const plannerModeResult = args.plannerMode === undefined
      ? null
      : agentPlannerModeSchema.safeParse(args.plannerMode);
    if (plannerModeResult && !plannerModeResult.success) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "代理規劃模型選項不正確" });
    }
    const plannerMode = plannerModeResult?.success ? plannerModeResult.data : undefined;
    const run = await planAgentCore({
      auth,
      projectId: String(args.projectId ?? ""),
      goal: String(args.goal ?? ""),
      plannerMode,
      // D5/M4：短版旗標與工作台「快速開拍（短版）」同一語意——外部模型不必自己拼骨架
      playbookId: args.shortCreation === true ? "playbook.creation.short.v1" : undefined,
    });
    return {
      runId: run.id,
      status: run.status,
      summary: run.summary,
      planSummary: run.planSummary,
      plannerTelemetry: run.plannerTelemetry,
      estPoints: run.estPoints,
      steps: (run.steps as AgentStep[]).map((s) => ({
        id: s.id,
        kind: s.kind,
        title: s.title,
        note: s.note,
        actorType: s.actorType,
        dependsOn: s.dependsOn ?? [],
        milestoneId: s.milestoneId ?? null,
        sourceRefs: s.sourceRefs ?? [],
        points: s.points ?? 0,
      })),
      note: "計畫已排好但尚未執行——用 approve_agent 核准後才會開始扣點執行，或用 discard_agent 放棄。",
    };
  }
  if (name === "approve_agent") {
    const run = await approveAgentCore({ auth, runId: String(args.runId ?? "") });
    return { runId: run.id, status: run.status, note: "已核准，背景執行器會逐步執行；用 get_agent_run 追進度、stop_agent 中止。" };
  }
  if (name === "stop_agent") {
    const run = await stopAgentCore({ auth, runId: String(args.runId ?? "") });
    return { runId: run.id, status: run.status };
  }
  if (name === "discard_agent") {
    const run = await discardAgentCore({ auth, runId: String(args.runId ?? "") });
    return { runId: run.id, status: run.status };
  }
  if (name === "list_agent_runs") {
    const runs = await listAgentRunsForProject(auth, String(args.projectId ?? ""));
    return runs.map((r) => ({
      runId: r.id,
      goal: r.goal,
      status: r.status,
      estPoints: r.estPoints,
      currentStep: r.currentStep,
      stepCount: (r.steps as AgentStep[]).length,
      createdAt: r.createdAt,
    }));
  }
  if (name === "get_agent_run") {
    const r = await getAgentRunChecked(auth, String(args.runId ?? ""));
    return {
      runId: r.id,
      goal: r.goal,
      summary: r.summary,
      planSummary: r.planSummary,
      status: r.status,
      estPoints: r.estPoints,
      currentStep: r.currentStep,
      error: r.error,
      steps: (r.steps as AgentStep[]).map((s) => ({
        kind: s.kind,
        id: s.id,
        title: s.title,
        note: s.note,
        status: s.status,
        actorType: s.actorType,
        dependsOn: s.dependsOn ?? [],
        milestoneId: s.milestoneId ?? null,
        sourceRefs: s.sourceRefs ?? [],
        outputRefs: s.outputRefs ?? [],
        points: s.points ?? 0,
        generationId: s.generationId ?? null,
        noteId: s.noteId ?? null,
        scheduleItemId: s.scheduleItemId ?? null,
        taskId: s.taskId ?? null,
        detail: s.detail ?? null,
      })),
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }
  if (name === "list_agent_events") {
    const cursor = typeof args.cursor === "string" ? args.cursor : undefined;
    const limit = typeof args.limit === "number" ? Math.trunc(args.limit) : undefined;
    return listProjectAgentEvents(auth, String(args.projectId ?? ""), { cursor, limit });
  }
  if (name === "get_agent_insights") {
    return getProjectAgentInsights(auth, String(args.projectId ?? ""));
  }

  // ── 排程／筆記與統整快照（以 projectId 為鍵，先解析專案的組再套組隔離）──
  if (name === "list_schedule" || name === "add_schedule_item" || name === "list_notes" || name === "add_note" || name === "get_project_status") {
    const pid = String(args.projectId ?? "");
    const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, pid));
    if (!project) throw new Error("找不到專案");
    requireGroup(auth, project.groupId); // 組隔離（不屬於此組直接擋）

    if (name === "list_notes") {
      // 專案視角：只回本專案的筆記 ＋ 整組共用（未掛專案）的筆記——與 list_schedule 同一過濾哲學。
      const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 50);
      const keyword = String(args.keyword ?? "").trim();
      // keyword：讓超過 limit 的較舊筆記仍能被外部 AI 找到（比照 list_database_files 的內文過濾）。
      const conds = [eq(schema.notes.groupId, project.groupId), or(eq(schema.notes.projectId, project.id), isNull(schema.notes.projectId))!];
      if (keyword) conds.push(or(sql`${schema.notes.title} ilike ${"%" + keyword + "%"}`, sql`${schema.notes.content} ilike ${"%" + keyword + "%"}`)!);
      const rows = await db
        .select({
          id: schema.notes.id,
          projectId: schema.notes.projectId,
          title: schema.notes.title,
          content: schema.notes.content,
          updatedAt: schema.notes.updatedAt,
        })
        .from(schema.notes)
        .where(and(...conds))
        .orderBy(desc(schema.notes.updatedAt))
        .limit(limit);
      return rows.map((n) => ({
        id: n.id,
        title: n.title,
        chars: n.content.length,
        excerpt: n.content.slice(0, 160),
        projectScoped: n.projectId === project.id,
        updatedAt: n.updatedAt,
      }));
    }

    if (name === "list_schedule") {
      // 專案視角的過濾在 DB 端完成（本專案 ＋ 組層級），避免單頁上限先被別的專案吃掉
      const { items, truncated } = await listScheduleForGroup(auth, project.groupId, Boolean(args.includePast), project.id);
      const rows = items
        .map((i) => ({ id: i.id, title: i.title, startsAt: i.startsAt, endsAt: i.endsAt, note: i.note, owner: i.ownerName, projectScoped: i.projectId === project.id }));
      // QA-017：截斷要讓外部 AI 看得見，不能默默當成全部
      return truncated ? { items: rows, truncated: true, note: "行程超過單頁上限，僅列出最早的一頁" } : rows;
    }

    if (name === "add_schedule_item") {
      const row = await addScheduleItemCore({
        auth,
        groupId: project.groupId,
        projectId: project.id,
        title: String(args.title ?? ""),
        startsAt: String(args.startsAt ?? ""),
        endsAt: args.endsAt ? String(args.endsAt) : null,
        note: args.note ? String(args.note) : null,
      });
      return { id: row.id, title: row.title, startsAt: row.startsAt, endsAt: row.endsAt };
    }

    if (name === "add_note") {
      // notesCore 內部再驗一次專案歸屬與封存（requireActive）；標題／內容長度守門也在 core
      const row = await addNoteCore({
        auth,
        groupId: project.groupId,
        projectId: project.id,
        title: String(args.title ?? ""),
        content: String(args.content ?? ""),
      });
      return { id: row.id, title: row.title, chars: row.content.length, createdAt: row.createdAt };
    }

    // get_project_status：把各子系統一次統整給外部 AI（細部連結分鏡／生成／代理／排程／待辦）
    const scenes = await db.select().from(schema.scenes).where(and(eq(schema.scenes.projectId, project.id), isNull(schema.scenes.deletedAt)));
    const gens = await db.select().from(schema.generations).where(eq(schema.generations.projectId, project.id)).orderBy(desc(schema.generations.createdAt)).limit(50);
    const runs = await listAgentRunsForProject(auth, project.id);
    const { items: sched } = await listScheduleForGroup(auth, project.groupId, false, project.id);
    const now = new Date();
    const tally = (arr: string[]) => arr.reduce<Record<string, number>>((m, k) => ((m[k] = (m[k] ?? 0) + 1), m), {});
    return {
      project: { title: project.title, kind: project.kind, format: project.format, status: project.status },
      scenes: { total: scenes.length, byStatus: tally(scenes.map((s) => s.status)) },
      generations: {
        recent: gens.length,
        byStatus: tally(gens.map((g) => g.status)),
        awaitingApproval: gens.filter((g) => g.status === "awaiting_approval").length,
      },
      agentRuns: runs
        .filter((r) => r.status === "awaiting_approval" || r.status === "running" || r.status === "waiting")
        .map((r) => ({ runId: r.id, goal: r.goal, status: r.status, currentStep: r.currentStep, stepCount: (r.steps as AgentStep[]).length })),
      upcomingSchedule: sched
        .filter((i) => i.startsAt >= now)
        .slice(0, 5)
        .map((i) => ({ title: i.title, startsAt: i.startsAt, projectScoped: i.projectId === project.id })),
    };
  }

  const projectId = String(args.projectId ?? "");
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
  if (!project) throw new Error("找不到專案");
  // per-user 組隔離：不屬於此專案的組直接擋（requireGroup 拋 FORBIDDEN，被 callTool 落審計後回 JSON-RPC error）
  requireGroup(auth, project.groupId);
  // 封存專案守衛（寫入類工具才擋，讀取放行）——見 archivedWriteReason
  const archived = archivedWriteReason(name, project.status);
  if (archived) throw new TRPCError({ code: "PRECONDITION_FAILED", message: archived });

  if (name === "get_project_context") {
    const wv = worldviewSchema.parse(project.worldview ?? {});
    const scenes = await db.select().from(schema.scenes).where(and(eq(schema.scenes.projectId, project.id), isNull(schema.scenes.deletedAt)));
    return { title: project.title, kind: project.kind, format: project.format, worldview: wv, scenes: scenes.map((s) => ({ title: s.title, status: s.status })) };
  }

  if (name === "list_generations") {
    // 讀取類：組隔離已於上方 requireGroup 把關（封存專案的生成仍可讀，故不套 archived 守衛）。
    const conds = [eq(schema.generations.projectId, project.id)];
    const status = args.status ? String(args.status) : "";
    if (status) conds.push(eq(schema.generations.status, status as typeof schema.generations.$inferSelect.status));
    const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 50);
    const rows = await db
      .select()
      .from(schema.generations)
      .where(and(...conds))
      .orderBy(desc(schema.generations.createdAt))
      .limit(limit);
    return rows.map((g) => ({
      id: g.id,
      modelId: g.modelId,
      kind: g.kind,
      status: g.status,
      prompt: g.prompt.length > 80 ? g.prompt.slice(0, 80) + "…" : g.prompt,
      resultUrl: externalAssetUrl(g.resultUrl), // 落地成品簽成免登入短效網址，外部客戶端才抓得到
      resultText: g.resultText,
      points: g.pointsEst,
      createdAt: g.createdAt,
    }));
  }

  if (name === "list_assets") {
    // 讀取類：組隔離已於上方 requireGroup 把關。素材庫成品／上傳素材，回可直接下載的網址。
    const conds = [eq(schema.assets.projectId, project.id), isNull(schema.assets.deletedAt)]; // 回收桶素材不外洩
    const kind = args.kind ? String(args.kind) : "";
    if (kind) conds.push(eq(schema.assets.kind, kind));
    const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 50);
    const rows = await db
      .select()
      .from(schema.assets)
      .where(and(...conds))
      .orderBy(desc(schema.assets.createdAt))
      .limit(limit);
    return rows.map((a) => ({
      id: a.id,
      kind: a.kind,
      title: a.title,
      isAiGenerated: a.isAiGenerated,
      // 本地落地素材簽成免登入短效網址；純外部網址原樣返回
      url: a.storagePath ? signAssetUrl(a.id) : a.url,
      createdAt: a.createdAt,
    }));
  }

  if (name === "submit_generation") {
    const userPrompt = String(args.prompt ?? "").trim();
    if (!userPrompt) throw new Error("prompt 不可為空");
    const sourceUrl = args.source_url ? String(args.source_url) : undefined;
    // TD-02：MCP 與網頁端同一 Command（政策／狀態機／ACL／扣點／門檻）
    // userId＝金鑰擁有者本人：扣他的額度、走他的核准門檻、審計記他。
    const gen = await executeGenerationCommand({
      auth,
      source: "mcp",
      // 修 R6-MONEY-01：客戶端冪等鍵——逾時重送同鍵回既有列、不雙重扣點
      id: typeof args.client_request_id === "string" ? args.client_request_id : undefined,
      projectId: project.id,
      modelId: String(args.modelId ?? ""),
      prompt: userPrompt,
      sourceUrl,
      reasonPrefix: "MCP 生成",
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
    if (body.length > 2000) throw new Error("訊息最長 2000 字"); // 修 IN-01：與網頁端同上限，別讓 MCP 繞過
    const [msg] = await db
      .insert(schema.messages)
      .values({ groupId: project.groupId, projectId: project.id, userId: auth.user.id, kind: "text", body })
      .returning();
    return { messageId: msg.id };
  }

  if (name === "request_upload_grant") {
    // 寫入類：組隔離 + 封存守衛已於上方把關；ACL／pending 上限／TTL 見 mcpUploadGrant。
    return handleRequestUploadGrant(auth, project, args);
  }

  throw new Error(`未知工具：${name}`);
}

function mcpClientIp(req: Request): string {
  // index.ts 已設 trust proxy=1，req.ip 即真實 client IP
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
}

function mcpRateLimitFailure(res: Response, error: unknown): boolean {
  if (error instanceof RateLimitUnavailableError || error instanceof RateLimitConfigurationError) {
    // Fail closed：PostgreSQL/金鑰設定壞掉時不可退回單機記憶體，也不可略過防爆破後繼續驗證。
    console.error(`[mcp] PostgreSQL 限流不可用（拒絕請求）：${error.name}: ${error.message}`);
    res.status(503).json({ error: "MCP 安全檢查暫時無法使用，請稍後再試" });
    return true;
  }
  return false;
}

/** JSON-RPC 處理器（掛在 POST /api/mcp） */
export async function handleMcp(req: Request, res: Response): Promise<void> {
  // 未啟用＝沒有任何個人金鑰，且非 production 也沒有明確開啟 legacy key：回 404 不張揚端點。
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
    res.status(429).json({ error: "MCP 金鑰連續失敗過多（每分鐘 10 次後封鎖 5 分鐘），請稍後再試" });
    return;
  }
  // 身分解析：個人金鑰→該使用者；env 共用金鑰→開發者；皆不符→401（記一次失敗，擋暴力猜）
  const provided = req.headers["x-api-key"];
  const identity = typeof provided === "string" && provided.length > 0 ? await resolveMcpIdentity(provided) : null;
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
    // 驗證成功清掉這個 IP 的失敗視窗；清理失敗也 fail closed，避免 DB 故障時繞過限流。
    await clearRateLimit(RATE_LIMIT_SCOPES.mcpIp, ip);
  } catch (error) {
    if (mcpRateLimitFailure(res, error)) return;
    throw error;
  }
  const auth = identity.auth;
  const body = req.body as { jsonrpc?: string; id?: number | string | null; method?: string; params?: Record<string, unknown> };
  const reply = (result: unknown): void => void res.json({ jsonrpc: "2.0", id: body.id ?? null, result });
  const fail = (code: number, message: string, data?: { code: string }): void =>
    void res.json({
      jsonrpc: "2.0",
      id: body.id ?? null,
      error: { code, message, ...(data ? { data } : {}) },
    });

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
        // D1：附上 catalog 推導的 annotations（read/write 分類同源；四個 hint 顯式輸出，
        // 因協議層預設偏保守——未給 destructive/openWorld 會被視為 true）
        return reply({
          tools: TOOLS.map((tool) => {
            const annotations = mcpToolAnnotations(tool.name);
            return annotations ? { ...tool, annotations } : tool;
          }),
        });
      case "tools/call": {
        const { name, arguments: args } = (body.params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
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
