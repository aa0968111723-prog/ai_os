import type { AgentPlannerMode, AgentPlannerUsage } from "../../shared/agentPlanner";
import { chatCompletion, NIM_DEFAULT_MODEL, NimServiceError } from "./nvidia-nim";
import { falStatus, falSubmit } from "./fal";

/**
 * 共用 LLM 供應層。
 *
 * 此前只有「代理規劃」（agentPlannerProvider）能選供應商，而使用者每天在用的
 * 聊天助手（assistant.ts）寫死呼叫 NVIDIA NIM 免費 llama —— 好模型已經在門口，
 * 只是沒接到主對話。這一層把供應商路由抽出來，讓助手與規劃器共用同一套選擇。
 *
 * **成本不變式**：NIM 走免費額度，站內問答收 0 點；fal 則是平台實付 USD。
 * 因此預設一律是 NIM，fal 必須由使用者明確選擇——絕不因為「品質比較好」
 * 就在使用者不知情的情況下開始花基金會的錢。
 */

/** fal 上可選的模型檔位。改價或換模型只改這裡。 */
export const FAL_AGENT_PROFILES = {
  fal_economy: {
    model: "google/gemini-2.5-flash-lite",
    maxTokens: 3_000,
    temperature: 0.1,
  },
  fal_balanced: {
    model: "openai/gpt-5-mini",
    maxTokens: 5_000,
    temperature: 0.1,
  },
  fal_quality: {
    model: "anthropic/claude-sonnet-4.5",
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
}

/** fal 必須帶 system_prompt；呼叫端沒給時用這句中性預設，不改變回答風格。 */
const NEUTRAL_SYSTEM_PROMPT = "你是正式產品的中文 AI 助手。依使用者提供的內容作答，不要輸出 reasoning 或 chain-of-thought。";

async function completeNim(params: CompleteTextParams): Promise<LlmCompletion> {
  const response = await chatCompletion({
    messages: [
      ...(params.systemPrompt ? [{ role: "system" as const, content: params.systemPrompt }] : []),
      { role: "user", content: params.prompt },
    ],
    temperature: params.temperature ?? 0.1,
    maxTokens: params.maxTokens ?? 5_000,
    timeoutMs: params.timeoutMs ?? 60_000,
    signal: params.signal,
  });
  return {
    provider: "nvidia-nim",
    model: NIM_DEFAULT_MODEL,
    text: response.choices[0]?.message?.content ?? "",
    usage: response.usage
      ? {
          promptTokens: response.usage.prompt_tokens,
          completionTokens: response.usage.completion_tokens,
          totalTokens: response.usage.total_tokens,
        }
      : undefined,
  };
}

async function completeFal(params: CompleteTextParams, mode: FalAgentMode): Promise<LlmCompletion> {
  const profile = FAL_AGENT_PROFILES[mode];
  const submitted = await falSubmit(FAL_OPENROUTER_ENDPOINT, "text", {
    prompt: params.prompt,
    system_prompt: params.systemPrompt ?? NEUTRAL_SYSTEM_PROMPT,
    model: profile.model,
    reasoning: false,
    temperature: params.temperature ?? profile.temperature,
    max_tokens: params.maxTokens ?? profile.maxTokens,
  });
  const deadline = Date.now() + (params.timeoutMs ?? 90_000);
  while (Date.now() < deadline) {
    if (params.signal?.aborted) throw new LlmServiceError("已取消");
    const status = await falStatus(FAL_OPENROUTER_ENDPOINT, "text", submitted.requestId);
    if (status.status === "done") {
      if (!status.resultText?.trim()) throw new LlmServiceError("fal.ai 模型沒有回傳內容");
      return { provider: "fal-openrouter", model: profile.model, text: status.resultText, usage: status.usage };
    }
    if (status.status === "failed") throw new LlmServiceError(status.error || "fal.ai 呼叫失敗");
    await sleep(FAL_POLL_INTERVAL_MS, params.signal);
  }
  throw new LlmServiceError("fal.ai 回應逾時，請稍後再試");
}

/**
 * 依模式取得一次文字補全。
 *
 * - `nim`（預設）：NVIDIA NIM 免費額度，站內 0 點。
 * - `fal_economy` / `fal_balanced` / `fal_quality`：走 fal openrouter，平台實付 USD。
 * - `auto`：先試 NIM，連線失敗才轉 fal 均衡，並在回傳值標 `fellBack`——
 *   讓 UI 能誠實告訴使用者「這次花到錢了」，而不是默默計費。
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

  if (mode === "nim") {
    try {
      return await completeNim(params);
    } catch (error) {
      throw sanitize(error, "nvidia-nim");
    }
  }

  // auto：免費優先，失敗才付費備援
  try {
    return await completeNim(params);
  } catch (nimError) {
    if (params.signal?.aborted) throw sanitize(nimError, "nvidia-nim");
    try {
      const fallback = await completeFal(params, "fal_balanced");
      return { ...fallback, fellBack: true };
    } catch {
      // 備援也失敗時回報原始的 NIM 錯誤——那才是使用者真正選的供應商
      throw sanitize(nimError, "nvidia-nim");
    }
  }
}
