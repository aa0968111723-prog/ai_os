import type { AgentPlannerMode, AgentPlannerUsage } from "../../shared/agentPlanner";
import { AGENT_LLM_MODEL_IDS } from "../../shared/llmPricing";
import { summarizeLogprobs, type LlmIntrospection } from "../../shared/llmIntrospection";
import { chatCompletion, NIM_DEFAULT_MODEL, NimServiceError, nimErrorDegradable } from "./nvidia-nim";
import { falStatus, falSubmit } from "./fal";

/**
 * 共用 LLM 供應層。
 *
 * 此前只有「代理規劃」（agentPlannerProvider）能選供應商，而使用者每天在用的
 * 聊天助手（assistant.ts）寫死呼叫 NVIDIA NIM 免費 llama —— 好模型已經在門口，
 * 只是沒接到主對話。這一層把供應商路由抽出來，讓助手與規劃器共用同一套選擇。
 *
 * **成本不變式**：NIM 走免費額度收 0 點；fal 則是平台實付 USD，一律換成站內點數扣在
 * 發起人身上（見 shared/llmPricing），受同一套額度守門。
 * 兩條路的預設因此不同，且都不是「偷偷花錢」：
 * - 聊天助手預設 NIM 免費，要好模型由使用者自己選。
 * - 代理規劃預設高品質（DEFAULT_AGENT_PLANNER_MODE）——因為規劃品質直接決定後面
 *   執行要燒多少點；花費逐次進帳本、額度不足會被擋下，使用者事前看得到估點。
 */

/**
 * fal 上可選的模型檔位。模型 id 取自 shared/llmPricing（與價目表同一份），
 * 換模型只改那裡——在這裡另寫一份字串的話，「跑的模型」與「扣的點」遲早對不上。
 */
export const FAL_AGENT_PROFILES = {
  fal_economy: {
    model: AGENT_LLM_MODEL_IDS.fal_economy,
    maxTokens: 3_000,
    temperature: 0.1,
  },
  fal_balanced: {
    model: AGENT_LLM_MODEL_IDS.fal_balanced,
    maxTokens: 5_000,
    temperature: 0.1,
  },
  fal_quality: {
    model: AGENT_LLM_MODEL_IDS.fal_quality,
    maxTokens: 8_000,
    temperature: 0.1,
  },
} as const;

export type FalAgentMode = keyof typeof FAL_AGENT_PROFILES;

export type LlmProvider = "nvidia-nim" | "fal-openrouter";

export interface LlmCompletion {
  provider: LlmProvider;
  model: string;
  text: string;
  usage?: AgentPlannerUsage;
  /** auto 模式下 NIM 失敗轉 fal 時為 true，供 UI 誠實標示「已自動備援」 */
  fellBack?: boolean;
  /**
   * 供應商主動揭露的推理摘要與逐 token 信心（見 shared/llmIntrospection）。
   * 供應商沒給就是沒有——站內不生成、不補寫、不改寫。
   */
  introspection?: LlmIntrospection;
}

export class LlmServiceError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "LlmServiceError";
  }
}

const FAL_OPENROUTER_ENDPOINT = "openrouter/router";
const FAL_POLL_INTERVAL_MS = 750;

export function isFalMode(mode: AgentPlannerMode): mode is FalAgentMode {
  return mode in FAL_AGENT_PROFILES;
}

/** 這個模式會不會花平台的錢？UI 用它決定要不要顯示付費標示。 */
export function modeCostsMoney(mode: AgentPlannerMode): boolean {
  return isFalMode(mode);
}

/**
 * NIM 免費檔位降級（2026-08-11 效能基準：免費 NIM 成功也中位 52s、並行負載下 80-100% 逾時，
 * fal 付費檔快 4-16 倍）：
 * - nim/auto 嘗試 NIM 只給「快速偵測」預算（NIM_DEGRADE_PROBE_MS，預設 8s）——逾時/慢回即降級
 *   fal（nim→fal_economy 低成本、auto→fal_balanced 均衡），不再讓免費路徑獨吞 60s（auto 過去
 *   甚至因呼叫端「非 nim 就給 120s」而乾等到 122.8s）。
 * - NIM 逾時/暫時失敗後進入降級冷卻（NIM_DEGRADE_COOLDOWN_MS，預設 60s）：冷卻期間 nim/auto
 *   直接走備援、不試 NIM——並行負載下 NIM 劣化更劇，冷卻避免每個請求都乾等一段 probe。
 */
export const NIM_DEGRADE_PROBE_MS = Number(process.env.NIM_DEGRADE_PROBE_MS ?? 8_000);
const NIM_DEGRADE_COOLDOWN_MS = Number(process.env.NIM_DEGRADE_COOLDOWN_MS ?? 60_000);

let nimDegradedUntil = 0;

/** 目前 NIM 是否在降級冷卻期（維運/測試可查） */
export function isNimDegraded(): boolean {
  return Date.now() < nimDegradedUntil;
}

function markNimDegraded(): void {
  nimDegradedUntil = Date.now() + NIM_DEGRADE_COOLDOWN_MS;
}

/** 測試用：清掉 NIM 降級狀態，避免跨測污染 */
export function __resetNimDegradation(): void {
  nimDegradedUntil = 0;
}

/* ── fal 降級目標壅塞自適應（2026-08-11 複驗 PR #653 後續） ──────────────────────
 * 複驗發現：nim 預設成功後降級到 fal_economy（deepseek-v4-flash），但 fal_economy 本身
 * 偶發壅塞——直接 mode=fal_economy 也有 1/3 逾時、成功樣本中位 24–45s 超 15s 驗收線，
 * 而 fal_balanced 穩定 4.2–12.5s。三個對策一次做齊：
 * - 降級目標只給「較短偵測預算」（FAL_DEGRADE_PROBE_MS，預設 15s，對齊驗收線）——超過即
 *   視為壅塞並二次降級 fal_balanced，不讓壅塞的 fal_economy 獨吞等待（方向 3）。
 * - 連續失敗達門檻（FAL_ECONOMY_CONGESTION_THRESHOLD）→ fal_economy 進入壅塞冷卻
 *   （FAL_ECONOMY_COOLDOWN_MS），期間 nim 降級直接走 fal_balanced、不再試壅塞目標（方向 1＋2）。
 * - fal_economy 成功即重置計數（恢復健康就回到低成本路徑）。
 * 只作用於「nim/auto 的降級鏈路」；使用者明確選的 fal 檔位（mode=fal_economy 等）絕不
 * 自動切檔——那是明確選擇的語意，改檔位只會多花錢（fal_balanced 輸出價約 4 倍）。
 */
export const FAL_DEGRADE_PROBE_MS = Number(process.env.FAL_DEGRADE_PROBE_MS ?? 15_000);
const FAL_ECONOMY_COOLDOWN_MS = Number(process.env.FAL_ECONOMY_COOLDOWN_MS ?? 120_000);
const FAL_ECONOMY_CONGESTION_THRESHOLD = Number(process.env.FAL_ECONOMY_CONGESTION_THRESHOLD ?? 2);

let falEconomyCongestedUntil = 0;
let falEconomyConsecutiveFailures = 0;

/** fal_economy 目前是否在壅塞冷卻期（期間 nim 降級直接走 fal_balanced） */
export function isFalEconomyCongested(): boolean {
  return Date.now() < falEconomyCongestedUntil;
}

/** fal_economy 恢復健康：重置連續失敗計數（下一次降級重試低成本目標） */
function resetFalEconomyHealth(): void {
  falEconomyConsecutiveFailures = 0;
}

/** fal_economy 在降級鏈路上逾時/失敗：累計連續失敗，達門檻進入壅塞冷卻 */
function recordFalEconomyFailure(): void {
  falEconomyConsecutiveFailures += 1;
  if (falEconomyConsecutiveFailures >= FAL_ECONOMY_CONGESTION_THRESHOLD) {
    falEconomyConsecutiveFailures = 0;
    falEconomyCongestedUntil = Date.now() + FAL_ECONOMY_COOLDOWN_MS;
  }
}

/** 測試用：清掉 fal_economy 壅塞狀態，避免跨測污染 */
export function __resetFalCongestion(): void {
  falEconomyCongestedUntil = 0;
  falEconomyConsecutiveFailures = 0;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new LlmServiceError("已取消"));
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new LlmServiceError("已取消"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Named so callers can ask before retrying a paid fal_economy model. */
export const FREE_MODEL_TIMEOUT_MESSAGE = "免費模型逾時";

function isFreeModelTimeout(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /逾時|無回應/.test(message);
}

function sanitize(error: unknown, provider: LlmProvider): LlmServiceError {
  if (error instanceof LlmServiceError) return error;
  if (provider === "nvidia-nim" && error instanceof NimServiceError) {
    return new LlmServiceError(error.message, { cause: error });
  }
  const message = error instanceof Error ? error.message : String(error);
  if (provider === "fal-openrouter") {
    if (message.includes("FAL_KEY 未設定")) {
      return new LlmServiceError("fal.ai 尚未設定金鑰，請管理員設定 FAL_KEY 後重新部署", { cause: error });
    }
    if (/\b429\b/.test(message)) {
      return new LlmServiceError("fal.ai 目前流量繁忙，請稍後再試或改用免費模型", { cause: error });
    }
    return new LlmServiceError("fal.ai 暫時沒有回應，請稍後再試或改用免費模型", { cause: error });
  }
  return new LlmServiceError("AI 助手暫時沒回應，請稍後再問一次。", { cause: error });
}

export interface CompleteTextParams {
  prompt: string;
  /**
   * 可選。省略時 NIM 只送 user 訊息——與既有呼叫端逐字相同，接上這一層不改變它的行為。
   * fal 端一律需要 system_prompt，故省略時用中性預設。
   */
  systemPrompt?: string;
  mode: AgentPlannerMode;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  /**
   * When false, nim/auto never call fal. Default: true only for `auto`
   * (UI「免費優先・自動備援」). `nim` is UI「只用免費」and must not silently
   * switch to paid deepseek-v4-flash.
   */
  allowPaidFallback?: boolean;
  /**
   * 要不要一併取回供應商揭露的推理摘要與逐 token 信心。
   * 預設關：主線路徑（助手回答、規劃）不需要，開了只是多花 token 與風險。
   */
  introspect?: boolean;
}

/** fal 必須帶 system_prompt；呼叫端沒給時用這句中性預設，不改變回答風格。 */
/** 供應商正式欄位裡的推理摘要（OpenAI 相容 reasoning_content／openrouter reasoning）。找不到就回 undefined。 */
export function extractDisclosedReasoning(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const root = payload as Record<string, unknown>;
  const choice = Array.isArray(root.choices) ? root.choices[0] as Record<string, unknown> | undefined : undefined;
  const message = choice && typeof choice.message === "object" && choice.message
    ? choice.message as Record<string, unknown>
    : undefined;
  const candidate = message?.reasoning_content ?? message?.reasoning ?? root.reasoning ?? root.reasoning_content;
  const text = typeof candidate === "string" ? candidate.trim() : "";
  return text ? text.slice(0, MAX_DISCLOSED_REASONING_CHARS) : undefined;
}

/** 推理摘要顯示上限：這是給人讀的說明，不是全文存檔 */
const MAX_DISCLOSED_REASONING_CHARS = 4_000;

const NEUTRAL_SYSTEM_PROMPT = "你是正式產品的中文 AI 助手。依使用者提供的內容作答，不要輸出 reasoning 或 chain-of-thought。";

async function completeNim(params: CompleteTextParams): Promise<LlmCompletion> {
  const response = await chatCompletion({
    logprobs: params.introspect ?? false,
    messages: [
      ...(params.systemPrompt ? [{ role: "system" as const, content: params.systemPrompt }] : []),
      { role: "user", content: params.prompt },
    ],
    temperature: params.temperature ?? 0.1,
    maxTokens: params.maxTokens ?? 5_000,
    timeoutMs: params.timeoutMs ?? 60_000,
    signal: params.signal,
  });
  const introspection: LlmIntrospection = {
    disclosedReasoning: extractDisclosedReasoning(response),
    ...summarizeLogprobs(response.choices[0]?.logprobs?.content ?? []),
    ...(response.logprobsUnsupported ? { logprobsUnsupported: true } : {}),
  };
  return {
    provider: "nvidia-nim",
    model: NIM_DEFAULT_MODEL,
    text: response.choices[0]?.message?.content ?? "",
    ...(Object.values(introspection).some((value) => value !== undefined) ? { introspection } : {}),
    usage: response.usage
      ? {
          promptTokens: response.usage.prompt_tokens,
          completionTokens: response.usage.completion_tokens,
          totalTokens: response.usage.total_tokens,
        }
      : undefined,
  };
}

/**
 * fal OpenRouter 部分模型強制 reasoning，設 false 會 400：
 * 「Reasoning is mandatory for this endpoint and cannot be disabled.」
 * 產品仍只取 content／resultText，不把 chain-of-thought 回給前端。
 * 與 agentPlannerProvider 共用此常數，避免兩邊漂移。
 */
export const FAL_OPENROUTER_REASONING = true;

async function completeFal(params: CompleteTextParams, mode: FalAgentMode): Promise<LlmCompletion> {
  const profile = FAL_AGENT_PROFILES[mode];
  const submitted = await falSubmit(FAL_OPENROUTER_ENDPOINT, "text", {
    prompt: params.prompt,
    system_prompt: params.systemPrompt ?? NEUTRAL_SYSTEM_PROMPT,
    model: profile.model,
    reasoning: FAL_OPENROUTER_REASONING,
    temperature: params.temperature ?? profile.temperature,
    max_tokens: params.maxTokens ?? profile.maxTokens,
  });
  const deadline = Date.now() + (params.timeoutMs ?? 90_000);
  while (Date.now() < deadline) {
    if (params.signal?.aborted) throw new LlmServiceError("已取消");
    const status = await falStatus(FAL_OPENROUTER_ENDPOINT, "text", submitted.requestId);
    if (status.status === "done") {
      if (!status.resultText?.trim()) throw new LlmServiceError("fal.ai 模型沒有回傳內容");
      // fal-openrouter 部分模型強制開 reasoning（見 FAL_OPENROUTER_REASONING）；
      // 供應商真的把它放在回應欄位裡時才顯示，站內不代為生成。
      const reasoning = params.introspect ? extractDisclosedReasoning(status.rawResponse) : undefined;
      return {
        provider: "fal-openrouter",
        model: profile.model,
        text: status.resultText,
        usage: status.usage,
        ...(reasoning ? { introspection: { disclosedReasoning: reasoning } } : {}),
      };
    }
    if (status.status === "failed") throw new LlmServiceError(status.error || "fal.ai 呼叫失敗");
    await sleep(FAL_POLL_INTERVAL_MS, params.signal);
  }
  throw new LlmServiceError("fal.ai 回應逾時，請稍後再試");
}

/**
 * 依模式取得一次文字補全。
 *
 * - `nim`（UI「只用免費」）：只用 NVIDIA NIM。逾時/失敗直接拋出，**不**自動切
 *   fal_economy（deepseek-v4-flash）。要付費備援請選 `auto` 或明確 fal 檔位。
 *   `allowPaidFallback: true` 才恢復舊的 nim→fal 降級（測試／明確同意）。
 * - `fal_economy` / `fal_balanced` / `fal_quality`：走 fal openrouter，平台實付 USD。
 *   明確選的檔位絕不自動切換（改檔位會多花錢且違反「明確選擇」語意）。
 * - `auto`：免費優先，同樣只給 NIM 快速偵測預算——逾時即轉 fal 均衡並標 `fellBack`，讓 UI
 *   誠實告訴使用者「這次花到錢了」；NIM 降級冷卻期間直接走 fal、不再試 NIM（避免並行負載下
 *   每個請求都乾等，也讓 auto 不再選到 ≥60s 的慢檔位）。
 */
export async function completeText(params: CompleteTextParams): Promise<LlmCompletion> {
  const { mode } = params;

  if (isFalMode(mode)) {
    try {
      return await completeFal(params, mode);
    } catch (error) {
      throw sanitize(error, "fal-openrouter");
    }
  }

  if (mode === "nim" || mode === "auto") {
    const allowPaidFallback = params.allowPaidFallback ?? mode === "auto";
    // auto＝免費優先、同意備援：NIM 只給快速偵測，逾時降級 fal。
    // nim＝只用免費：走完整 timeoutMs，失敗就失敗，不偷偷切 deepseek-v4-flash。
    const fallback = async (nimError: unknown): Promise<LlmCompletion> => {
      // nim 降級：fal_economy（省成本）；fal_economy 判定壅塞時直接 fal_balanced。
      // auto 維持 fal_balanced（複驗證明穩定 4.2–12.5s，不需二次降級）。
      const primary: FalAgentMode = mode === "nim" && !isFalEconomyCongested() ? "fal_economy" : "fal_balanced";
      try {
        // 降級目標也套「較短偵測逾時」：fal_economy 壅塞時（實測可慢到 69s 或逾時）不讓
        // 使用者乾等，FAL_DEGRADE_PROBE_MS（15s，對齊驗收線）一到就視為壅塞改走 fal_balanced。
        const result = await completeFal(
          primary === "fal_economy" ? { ...params, timeoutMs: FAL_DEGRADE_PROBE_MS } : params,
          primary,
        );
        if (primary === "fal_economy") resetFalEconomyHealth();
        return { ...result, fellBack: true };
      } catch (error) {
        // 使用者已中斷：直接收束，不再二次降級、也不記錄壅塞——沒人在等答案就不該多花一筆
        if (params.signal?.aborted) throw new LlmServiceError("已取消");
        if (primary === "fal_economy") {
          // fal_economy 壅塞/失敗：記一筆（連續達標進冷卻），並立即二次降級 fal_balanced，
          // 讓「降級目標本身壅塞」也有備援——複驗的成功樣本中位 24–45s 就此壓回 15s 內。
          recordFalEconomyFailure();
          try {
            const result = await completeFal(params, "fal_balanced");
            return { ...result, fellBack: true };
          } catch (secondError) {
            // 兩檔都失敗：回報原始 NIM 錯誤（那才是使用者真正選的供應商）；
            // NIM 已在冷卻、直接走備援才失敗時，備援錯誤就是唯一原因。
            if (nimError !== undefined) throw sanitize(nimError, "nvidia-nim");
            throw sanitize(secondError, "fal-openrouter");
          }
        }
        // auto 的 fal_balanced 失敗：比照原語意回報原始 NIM 錯誤
        if (nimError !== undefined) throw sanitize(nimError, "nvidia-nim");
        throw sanitize(error, "fal-openrouter");
      }
    };
    if (!allowPaidFallback) {
      try {
        return await completeNim({ ...params, timeoutMs: params.timeoutMs ?? 60_000 });
      } catch (nimError) {
        // Default nim failure must not route to fal_economy (deepseek-v4-flash).
        // Timeout is a named error so the UI can ask before a paid retry.
        if (isFreeModelTimeout(nimError)) {
          throw new LlmServiceError(FREE_MODEL_TIMEOUT_MESSAGE, {
            cause: nimError instanceof Error ? nimError : undefined,
          });
        }
        throw sanitize(nimError, "nvidia-nim");
      }
    }
    // NIM 降級冷卻期間直接走備援、不再試 NIM——並行負載下 NIM 劣化更劇，冷卻避免乾等。
    if (isNimDegraded()) return await fallback(undefined);
    try {
      return await completeNim({ ...params, timeoutMs: NIM_DEGRADE_PROBE_MS });
    } catch (nimError) {
      if (params.signal?.aborted) throw sanitize(nimError, "nvidia-nim");
      // 金鑰/設定錯誤（degradable=false）降級救不了，照樣拋出給管理員處理
      if (!nimErrorDegradable(nimError)) throw sanitize(nimError, "nvidia-nim");
      markNimDegraded();
      return await fallback(nimError);
    }
  }

  // 理論上到不了（agentPlannerModeSchema 已限制枚舉）；留兜底避免 compile 對 never 不滿
  throw new LlmServiceError("不支援的 AI 檔位");
}
