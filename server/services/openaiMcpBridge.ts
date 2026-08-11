import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq, isNull, like, lt } from "drizzle-orm";
import { db, schema } from "../db";
import type { AuthState } from "./auth";
import { deriveIntegrationKey } from "./integrations";
import { createMcpTokenUnderCap, revokeMcpToken } from "./mcpAuth";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const BRIDGE_TOKEN_LABEL_PREFIX = "OpenAI 短效代理";
const MCP_TOKEN_TTL_MS = 5 * 60_000;
const CONTINUATION_TTL_MS = 15 * 60_000;
const OLD_EPHEMERAL_ROW_MS = 24 * 60 * 60_000;
const DEFAULT_MODEL = "gpt-5.6";
const DEFAULT_PRODUCTION_ORIGIN = "https://ai-os-app.zeabur.app";

export interface OpenAiMcpApproval {
  id: string;
  name: string;
  arguments: string;
  serverLabel: string;
}

export interface OpenAiMcpCallTrace {
  id: string;
  name: string;
  status?: string;
  arguments?: string;
  output?: string;
  error?: string;
}

export interface OpenAiMcpBridgeResult {
  text: string;
  approvals: OpenAiMcpApproval[];
  calls: OpenAiMcpCallTrace[];
  continuation: string | null;
  responseId: string;
  model: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
}

interface OpenAiResponsePayload {
  id?: unknown;
  model?: unknown;
  output?: unknown;
  usage?: unknown;
  error?: unknown;
}

interface ContinuationPayload {
  v: 1;
  sub: string;
  responseId: string;
  approvalIds: string[];
  exp: number;
}

export interface ApprovalDecision {
  approvalRequestId: string;
  approve: boolean;
  reason?: string;
}

function openAiKey(): string {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new Error("尚未設定 OPENAI_API_KEY");
  return key;
}

export function configuredOpenAiMcpModel(): string {
  return process.env.OPENAI_MCP_MODEL?.trim() || DEFAULT_MODEL;
}

export function isOpenAiMcpConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

/**
 * Remote MCP 必須是 OpenAI 從公網可回連的 HTTPS URL。
 * 正式站優先吃 PUBLIC_APP_URL；為目前 Zeabur 站保留安全的固定 fallback。
 * 開發環境由 router 傳入 request origin，避免測試誤打正式站。
 */
export function resolveOpenAiMcpServerUrl(requestOrigin?: string): string {
  const configured = process.env.PUBLIC_APP_URL?.trim();
  const raw = configured || (process.env.NODE_ENV === "production" ? DEFAULT_PRODUCTION_ORIGIN : requestOrigin);
  if (!raw) throw new Error("找不到公開站址；請設定 PUBLIC_APP_URL");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("PUBLIC_APP_URL 格式不正確");
  }
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new Error("正式環境的 PUBLIC_APP_URL 必須使用 HTTPS");
  }
  if (url.username || url.password) throw new Error("PUBLIC_APP_URL 不可包含帳號密碼");
  return `${url.origin}/api/mcp`;
}

function continuationKey(): Buffer {
  return deriveIntegrationKey("openai-mcp-continuation");
}

function signContinuation(payload: ContinuationPayload): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = createHmac("sha256", continuationKey()).update(body).digest("base64url");
  return `aiomcp_${body}.${sig}`;
}

function verifyContinuation(token: string, userId: string, now = Date.now()): ContinuationPayload {
  if (!token.startsWith("aiomcp_")) throw new Error("操作確認已失效，請重新送出需求");
  const raw = token.slice("aiomcp_".length);
  const dot = raw.lastIndexOf(".");
  if (dot <= 0) throw new Error("操作確認已失效，請重新送出需求");
  const body = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const expected = createHmac("sha256", continuationKey()).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error("操作確認簽章不正確，請重新送出需求");
  }
  let payload: ContinuationPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as ContinuationPayload;
  } catch {
    throw new Error("操作確認內容無法解析，請重新送出需求");
  }
  if (payload.v !== 1 || payload.sub !== userId || !payload.responseId || !Array.isArray(payload.approvalIds)) {
    throw new Error("操作確認不屬於目前使用者");
  }
  if (!Number.isFinite(payload.exp) || payload.exp <= now) {
    throw new Error("操作確認已逾時，請重新送出需求");
  }
  return payload;
}

/**
 * 短效 MCP 金鑰只存在 OpenAI 單次 Responses 請求期間：
 * - 初始讀取用唯讀 key；就算上游遭到濫用也無法寫站內資料。
 * - 使用者核准寫入時才為該次 continuation 建可寫 key。
 * - fetch 結束即 revoke；程序崩潰留下的短效 key 5 分鐘自動過期，下次呼叫再清理。
 */
async function withEphemeralMcpKey<T>(
  auth: AuthState,
  readOnly: boolean,
  fn: (token: string) => Promise<T>,
): Promise<T> {
  const now = new Date();
  const old = new Date(now.getTime() - OLD_EPHEMERAL_ROW_MS);
  // 清掉程序中斷留下的「已過期但尚未撤銷」短效 key，避免佔每人有效金鑰上限。
  await db
    .update(schema.mcpTokens)
    .set({ revokedAt: now })
    .where(and(
      eq(schema.mcpTokens.userId, auth.user.id),
      like(schema.mcpTokens.label, `${BRIDGE_TOKEN_LABEL_PREFIX}%`),
      isNull(schema.mcpTokens.revokedAt),
      lt(schema.mcpTokens.expiresAt, now),
    ));
  // 短效橋接 key 是技術暫存，不需要永久堆在使用者的 MCP 金鑰歷史。
  await db
    .delete(schema.mcpTokens)
    .where(and(
      eq(schema.mcpTokens.userId, auth.user.id),
      like(schema.mcpTokens.label, `${BRIDGE_TOKEN_LABEL_PREFIX}%`),
      lt(schema.mcpTokens.revokedAt, old),
    ));

  const created = await createMcpTokenUnderCap(
    auth.user.id,
    `${BRIDGE_TOKEN_LABEL_PREFIX} ${readOnly ? "唯讀" : "核准寫入"}`,
    { readOnly, expiresAt: new Date(Date.now() + MCP_TOKEN_TTL_MS) },
  );
  if (!created.ok) {
    throw new Error("MCP 金鑰數已達上限；請先到「接上外部 AI」撤銷不用的金鑰");
  }
  try {
    return await fn(created.result.token);
  } finally {
    await revokeMcpToken(auth.user.id, created.result.id).catch(() => false);
  }
}

export function buildRemoteMcpTool(serverUrl: string, mcpToken: string) {
  return {
    type: "mcp" as const,
    server_label: "ai_os",
    server_description: "AI-OS 使用者目前有權存取的專案、分鏡、素材、資料庫、任務、排程與 AI 製作工具。",
    server_url: serverUrl,
    headers: { "x-api-key": mcpToken },
    // 讀取可自動執行；所有寫入依 MCP readOnlyHint 一律停下來等人確認。
    require_approval: {
      never: { read_only: true },
      always: { read_only: false },
    },
  };
}

const BRIDGE_INSTRUCTIONS = `你是 AI-OS 的執行型製作助手。你的 MCP 工具連到使用者真實的 AI-OS 帳號與專案。

工作原則：
1. 先讀再做：涉及專案時先用 list_projects / get_project_status / get_project_context 等工具取得真實 id 與現況，不猜 UUID、不猜資料。
2. 能用工具查到的內容不要反問使用者重貼。需要多個唯讀工具時直接查完再回答。
3. 寫入工具會由系統要求使用者逐項核准；在核准成功並收到 MCP tool result 前，絕不能說「已完成／已建立／已修改」。
4. 若 MCP 回權限、點數、核准門檻、封存或資料驗證錯誤，據實說明，不繞過守衛。
5. 使用者要求「直接做」時，準備正確的寫入工具呼叫；不要只給教學步驟。
6. 回答使用繁體中文、簡潔清楚。不要輸出 chain-of-thought；可用工具活動與結果說明你實際查了或做了什麼。`;

async function callOpenAi(body: Record<string, unknown>): Promise<OpenAiResponsePayload> {
  let response: Response;
  try {
    response = await fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${openAiKey()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (error) {
    throw new Error(`OpenAI 暫時無法連線：${error instanceof Error ? error.message : "網路錯誤"}`);
  }
  const raw = await response.text();
  let payload: OpenAiResponsePayload = {};
  try {
    payload = raw ? JSON.parse(raw) as OpenAiResponsePayload : {};
  } catch {
    // 保持空 payload，下面以 HTTP 狀態輸出安全錯誤。
  }
  if (!response.ok) {
    const root = payload.error && typeof payload.error === "object" ? payload.error as Record<string, unknown> : null;
    const message = typeof root?.message === "string" ? root.message : `HTTP ${response.status}`;
    throw new Error(`OpenAI Responses API 失敗：${message.slice(0, 500)}`);
  }
  return payload;
}

function outputItems(payload: OpenAiResponsePayload): Record<string, unknown>[] {
  return Array.isArray(payload.output)
    ? payload.output.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    : [];
}

export function extractOpenAiMcpResult(payload: OpenAiResponsePayload): Omit<OpenAiMcpBridgeResult, "continuation"> {
  const responseId = typeof payload.id === "string" ? payload.id : "";
  if (!responseId) throw new Error("OpenAI 沒有回傳 response id");
  const items = outputItems(payload);
  const textParts: string[] = [];
  const approvals: OpenAiMcpApproval[] = [];
  const calls: OpenAiMcpCallTrace[] = [];

  for (const item of items) {
    if (item.type === "message" && Array.isArray(item.content)) {
      for (const content of item.content) {
        if (!content || typeof content !== "object") continue;
        const c = content as Record<string, unknown>;
        if ((c.type === "output_text" || c.type === "text") && typeof c.text === "string" && c.text.trim()) {
          textParts.push(c.text.trim());
        }
      }
    }
    if (item.type === "mcp_approval_request" && typeof item.id === "string" && typeof item.name === "string") {
      approvals.push({
        id: item.id,
        name: item.name,
        arguments: typeof item.arguments === "string" ? item.arguments : "{}",
        serverLabel: typeof item.server_label === "string" ? item.server_label : "ai_os",
      });
    }
    if (item.type === "mcp_call" && typeof item.id === "string" && typeof item.name === "string") {
      calls.push({
        id: item.id,
        name: item.name,
        status: typeof item.status === "string" ? item.status : undefined,
        arguments: typeof item.arguments === "string" ? item.arguments : undefined,
        output: typeof item.output === "string" ? item.output.slice(0, 2_000) : undefined,
        error: typeof item.error === "string" ? item.error.slice(0, 500) : undefined,
      });
    }
  }

  const usage = payload.usage && typeof payload.usage === "object" ? payload.usage as Record<string, unknown> : null;
  return {
    responseId,
    model: typeof payload.model === "string" ? payload.model : configuredOpenAiMcpModel(),
    text: textParts.join("\n\n"),
    approvals,
    calls,
    usage: usage ? {
      inputTokens: typeof usage.input_tokens === "number" ? usage.input_tokens : undefined,
      outputTokens: typeof usage.output_tokens === "number" ? usage.output_tokens : undefined,
      totalTokens: typeof usage.total_tokens === "number" ? usage.total_tokens : undefined,
    } : undefined,
  };
}

function resultWithContinuation(userId: string, parsed: Omit<OpenAiMcpBridgeResult, "continuation">): OpenAiMcpBridgeResult {
  const continuation = parsed.approvals.length > 0
    ? signContinuation({
        v: 1,
        sub: userId,
        responseId: parsed.responseId,
        approvalIds: parsed.approvals.map((a) => a.id),
        exp: Date.now() + CONTINUATION_TTL_MS,
      })
    : null;
  return { ...parsed, continuation };
}

export async function askOpenAiThroughMcp(
  auth: AuthState,
  message: string,
  serverUrl: string,
): Promise<OpenAiMcpBridgeResult> {
  return withEphemeralMcpKey(auth, true, async (mcpToken) => {
    const payload = await callOpenAi({
      model: configuredOpenAiMcpModel(),
      reasoning: { effort: "medium" },
      instructions: BRIDGE_INSTRUCTIONS,
      input: [{ role: "user", content: message }],
      tools: [buildRemoteMcpTool(serverUrl, mcpToken)],
      max_output_tokens: 8_000,
    });
    return resultWithContinuation(auth.user.id, extractOpenAiMcpResult(payload));
  });
}

export async function decideOpenAiMcpApprovals(
  auth: AuthState,
  continuation: string,
  decisions: ApprovalDecision[],
  serverUrl: string,
): Promise<OpenAiMcpBridgeResult> {
  const state = verifyContinuation(continuation, auth.user.id);
  const expected = new Set(state.approvalIds);
  if (decisions.length !== expected.size) throw new Error("請先逐項決定這一輪的所有操作");
  const seen = new Set<string>();
  for (const decision of decisions) {
    if (!expected.has(decision.approvalRequestId) || seen.has(decision.approvalRequestId)) {
      throw new Error("操作確認項目不一致，請重新送出需求");
    }
    seen.add(decision.approvalRequestId);
  }

  // 只有這一輪真的核准了寫入，才簽一把可寫 MCP key；全部拒絕則維持唯讀。
  const requiresWrite = decisions.some((d) => d.approve);
  return withEphemeralMcpKey(auth, !requiresWrite, async (mcpToken) => {
    const payload = await callOpenAi({
      model: configuredOpenAiMcpModel(),
      reasoning: { effort: "medium" },
      instructions: BRIDGE_INSTRUCTIONS,
      previous_response_id: state.responseId,
      input: decisions.map((decision) => ({
        type: "mcp_approval_response",
        approval_request_id: decision.approvalRequestId,
        approve: decision.approve,
        ...(decision.reason?.trim() ? { reason: decision.reason.trim().slice(0, 300) } : {}),
      })),
      tools: [buildRemoteMcpTool(serverUrl, mcpToken)],
      max_output_tokens: 8_000,
    });
    return resultWithContinuation(auth.user.id, extractOpenAiMcpResult(payload));
  });
}
