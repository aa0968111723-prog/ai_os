import {
  type AgentPlannerMode,
  type AgentPlannerTelemetry,
  type AgentPlannerUsage,
} from "../../shared/agentPlanner";
import {
  completePlanDraftSchema,
  extractPlanJson,
  type CompletePlanDraft,
} from "./agentPlanning";
import { falStatus, falSubmit } from "./fal";
import {
  chatCompletion,
  NIM_DEFAULT_MODEL,
  NimServiceError,
} from "./nvidia-nim";

const FAL_OPENROUTER_ENDPOINT = "openrouter/router";
const FAL_POLL_INTERVAL_MS = 750;
const FAL_PLAN_TIMEOUT_MS = 90_000;

/**
 * 模型檔位下沉到共用 LLM 供應層（llmProvider），讓聊天助手與規劃器吃同一份設定——
 * 兩邊各留一份的話，改價或換模型時必然漂移。此處 re-export 維持既有匯入點不變。
 */
export { FAL_AGENT_PROFILES, type FalAgentMode } from "./llmProvider";
import { FAL_AGENT_PROFILES, type FalAgentMode } from "./llmProvider";

interface PlannerCompletion {
  provider: "nvidia-nim" | "fal-openrouter";
  model: string;
  text: string;
  usage?: AgentPlannerUsage;
}

export interface AgentPlannerProviderDependencies {
  completeNim: (prompt: string) => Promise<PlannerCompletion>;
  completeFal: (prompt: string, mode: FalAgentMode) => Promise<PlannerCompletion>;
}

export interface AgentPlanProviderResult {
  draft: CompletePlanDraft;
  telemetry: AgentPlannerTelemetry;
}

export class AgentPlannerServiceError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AgentPlannerServiceError";
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function parseDraft(text: string): CompletePlanDraft | null {
  const parsed = completePlanDraftSchema.safeParse(extractPlanJson(text));
  return parsed.success ? parsed.data : null;
}

function sanitizeProviderError(error: unknown, provider: "nvidia-nim" | "fal-openrouter"): AgentPlannerServiceError {
  if (error instanceof AgentPlannerServiceError) return error;
  if (provider === "nvidia-nim" && error instanceof NimServiceError) {
    return new AgentPlannerServiceError(error.message, { cause: error });
  }
  const message = error instanceof Error ? error.message : String(error);
  if (provider === "fal-openrouter") {
    if (message.includes("FAL_KEY 未設定")) {
      return new AgentPlannerServiceError("fal.ai 代理規劃尚未設定金鑰，請管理員設定 FAL_KEY 後重新部署", { cause: error });
    }
    if (/\b429\b/.test(message)) {
      return new AgentPlannerServiceError("fal.ai 目前流量繁忙，請稍後再試或改用 NVIDIA NIM", { cause: error });
    }
    return new AgentPlannerServiceError("fal.ai 代理規劃暫時沒有回應，請稍後再試或改用 NVIDIA NIM", { cause: error });
  }
  return new AgentPlannerServiceError("NVIDIA NIM 代理規劃暫時沒有回應，請改用自動備援或 fal.ai 模型", { cause: error });
}

async function completeNim(prompt: string): Promise<PlannerCompletion> {
  const response = await chatCompletion({
    messages: [
      {
        role: "system",
        content: "你是正式產品的 AI 代理規劃器。只輸出一個符合指定結構的 JSON 物件，不要輸出 markdown、解說、reasoning 或 chain-of-thought。",
      },
      { role: "user", content: prompt },
    ],
    temperature: 0.1,
    maxTokens: 5_000,
    timeoutMs: 60_000,
  });
  const usage = response.usage
    ? {
        promptTokens: response.usage.prompt_tokens,
        completionTokens: response.usage.completion_tokens,
        totalTokens: response.usage.total_tokens,
      }
    : undefined;
  return {
    provider: "nvidia-nim",
    model: NIM_DEFAULT_MODEL,
    text: response.choices[0]?.message?.content ?? "",
    usage,
  };
}

async function completeFal(prompt: string, mode: FalAgentMode): Promise<PlannerCompletion> {
  const profile = FAL_AGENT_PROFILES[mode];
  const submitted = await falSubmit(FAL_OPENROUTER_ENDPOINT, "text", {
    prompt,
    system_prompt: "你是正式產品的 AI 代理規劃器。只輸出一個符合指定結構的 JSON 物件，不要輸出 markdown、解說、reasoning 或 chain-of-thought。",
    model: profile.model,
    reasoning: false,
    temperature: profile.temperature,
    max_tokens: profile.maxTokens,
  });
  const deadline = Date.now() + FAL_PLAN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const status = await falStatus(FAL_OPENROUTER_ENDPOINT, "text", submitted.requestId);
    if (status.status === "done") {
      if (!status.resultText?.trim()) {
        throw new AgentPlannerServiceError("fal.ai 模型沒有回傳可用的代理計畫");
      }
      return {
        provider: "fal-openrouter",
        model: profile.model,
        text: status.resultText,
        usage: status.usage,
      };
    }
    if (status.status === "failed") {
      throw new AgentPlannerServiceError(status.error || "fal.ai 代理規劃失敗");
    }
    await sleep(FAL_POLL_INTERVAL_MS);
  }
  throw new AgentPlannerServiceError("fal.ai 代理規劃逾時，請稍後再試");
}

const DEFAULT_DEPENDENCIES: AgentPlannerProviderDependencies = {
  completeNim,
  completeFal,
};

function repairPrompt(originalPrompt: string, invalidOutput: string): string {
  return `${originalPrompt}

上一版輸出沒有通過結構驗證。請重新輸出完整 JSON，確保：
1. 只有一個 JSON 物件，不含 markdown 或說明。
2. summary 與 steps 必填欄位完整。
3. kind、日期、代號與 dependsOn 僅使用原規格允許的值。
4. 不輸出 reasoning 或 chain-of-thought。

<上一版無效輸出>
${invalidOutput.slice(0, 12_000)}
</上一版無效輸出>`;
}

function addUsage(total: AgentPlannerUsage, next?: AgentPlannerUsage): AgentPlannerUsage {
  if (!next) return total;
  const sum = (a?: number, b?: number) => a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0);
  return {
    promptTokens: sum(total.promptTokens, next.promptTokens),
    completionTokens: sum(total.completionTokens, next.completionTokens),
    totalTokens: sum(total.totalTokens, next.totalTokens),
    costUsd: sum(total.costUsd, next.costUsd),
  };
}

/**
 * 產生並驗證代理計畫：
 * - auto：NIM 成功就用；連線失敗或結構錯誤時轉 Fal 均衡。
 * - 明確指定供應商：同供應商最多做一次 JSON 修復，不暗中切換。
 * - 回傳值只含已通過 Zod 的 draft 與可稽核計量，不含私密推理。
 */
export async function generateAgentPlanDraft(
  prompt: string,
  requestedMode: AgentPlannerMode = "auto",
  dependencies: AgentPlannerProviderDependencies = DEFAULT_DEPENDENCIES,
): Promise<AgentPlanProviderResult> {
  let usage: AgentPlannerUsage = {};
  let attemptCount = 0;
  let fallbackReason: AgentPlannerTelemetry["fallbackReason"];
  let fallbackFrom: AgentPlannerTelemetry["fallbackFrom"];

  const invoke = async (
    provider: "nvidia-nim" | "fal-openrouter",
    content: string,
    falMode: FalAgentMode = "fal_balanced",
  ): Promise<PlannerCompletion> => {
    attemptCount += 1;
    try {
      const completion = provider === "nvidia-nim"
        ? await dependencies.completeNim(content)
        : await dependencies.completeFal(content, falMode);
      usage = addUsage(usage, completion.usage);
      return completion;
    } catch (error) {
      throw sanitizeProviderError(error, provider);
    }
  };

  const finish = (draft: CompletePlanDraft, completion: PlannerCompletion): AgentPlanProviderResult => ({
    draft,
    telemetry: {
      requestedMode,
      provider: completion.provider,
      model: completion.model,
      attemptCount,
      fallbackFrom,
      fallbackReason,
      ...usage,
    },
  });

  if (requestedMode === "auto") {
    try {
      const nim = await invoke("nvidia-nim", prompt);
      const draft = parseDraft(nim.text);
      if (draft) return finish(draft, nim);
      fallbackReason = "invalid_output";
    } catch {
      fallbackReason = "provider_error";
    }
    fallbackFrom = "nvidia-nim";
    const fal = await invoke("fal-openrouter", prompt, "fal_balanced");
    const draft = parseDraft(fal.text);
    if (draft) return finish(draft, fal);
    const repaired = await invoke("fal-openrouter", repairPrompt(prompt, fal.text), "fal_balanced");
    const repairedDraft = parseDraft(repaired.text);
    if (repairedDraft) return finish(repairedDraft, repaired);
    throw new AgentPlannerServiceError("AI 兩次都沒有產生符合安全規格的完整計畫，請把目標、日期或交付成果說得更具體後再試");
  }

  const provider = requestedMode === "nim" ? "nvidia-nim" : "fal-openrouter";
  const falMode = requestedMode === "nim" ? "fal_balanced" : requestedMode;
  const first = await invoke(provider, prompt, falMode);
  const draft = parseDraft(first.text);
  if (draft) return finish(draft, first);
  const repaired = await invoke(provider, repairPrompt(prompt, first.text), falMode);
  const repairedDraft = parseDraft(repaired.text);
  if (repairedDraft) return finish(repairedDraft, repaired);
  throw new AgentPlannerServiceError("AI 兩次都沒有產生符合安全規格的完整計畫，請把目標、日期或交付成果說得更具體後再試");
}
