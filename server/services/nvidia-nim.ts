/**
 * NVIDIA NIM LLM 客戶端(AI 代理系統的文字生成整站遷移:fal any-llm → NVIDIA NIM)。
 * 分工定案:LLM 文字(導演建議/拆分鏡/專案助手/留言@助手/團隊彙總/生成台 llm 類)走 NIM;
 * 圖像/影片/音訊/視覺理解/轉錄/訓練維持 fal.ai(見 server/services/fal.ts)。
 * - 協定:OpenAI 相容 chat/completions(NVIDIA_NIM_ENDPOINT,預設 integrate.api.nvidia.com/v1)。
 * - 同步 API:chatCompletion / nimComplete——後端自動呼叫用(呼叫端自帶 mock 守門與扣退點)。
 * - 佇列 API:nimSubmit / nimStatus——生成台 llm 類經 generationCore 走這對,
 *   介面對齊 falSubmit/falStatus(NIM 本身是同步 API,這裡以記憶體任務表模擬佇列,
 *   重啟遺留的孤兒列由既有 30 分鐘陳屍清掃退點回收,與 fal mock 佇列同一套兜底)。
 */
import { randomUUID } from "node:crypto";
import { proxyFetch } from "./http";
import type { FalStatusResult } from "./fal";

const NVIDIA_NIM_ENDPOINT =
  process.env.NVIDIA_NIM_ENDPOINT?.trim().replace(/\/$/, "") || "https://integrate.api.nvidia.com/v1";
const NVIDIA_NIM_API_KEY = process.env.NVIDIA_NIM_API_KEY?.trim();

/** 可用模型速查(NIM 目錄的常用檔;生成台完整清單見 shared/models.ts 的 llm 類) */
export const NVIDIA_MODELS = {
  deepseekR1: "deepseek-ai/deepseek-r1",
  llama3_405b: "meta/llama-3.1-405b-instruct",
  llama3_70b: "meta/llama-3.1-70b-instruct",
  llama3_8b: "meta/llama-3.1-8b-instruct",
  mistralLarge: "mistralai/mistral-large-2-instruct",
  nemotron: "nvidia/nemotron-4-340b-instruct",
  qwen2_5_72b: "qwen/qwen2.5-72b-instruct",
} as const;

export type NvidiaModel = (typeof NVIDIA_MODELS)[keyof typeof NVIDIA_MODELS];

/**
 * 後端自動 LLM(導演/助手/彙總)的模型單一設定點(沿襲原 ANY_LLM_MODEL 的設計):
 * 設環境變數 NVIDIA_NIM_MODEL 即可整站切換;預設 llama-3.1-70b(品質/成本平衡的日常主力)。
 */
export const NIM_DEFAULT_MODEL = process.env.NVIDIA_NIM_MODEL?.trim() || NVIDIA_MODELS.llama3_70b;

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatCompletionOptions {
  model?: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  /** 逾時上限;LLM 掛起→逾時走呼叫端 catch 退點(比照原 any-llm 呼叫的 60s) */
  timeoutMs?: number;
}

export interface ChatCompletionResponse {
  choices: Array<{ message: { role: string; content: string } }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

/** 呼叫 NVIDIA NIM Chat API(OpenAI 相容);金鑰未設或 HTTP 錯誤一律拋例外,由呼叫端退點 */
export async function chatCompletion(options: ChatCompletionOptions): Promise<ChatCompletionResponse> {
  if (!NVIDIA_NIM_API_KEY) {
    throw new Error("NVIDIA_NIM_API_KEY 未設定");
  }
  const res = await proxyFetch(`${NVIDIA_NIM_ENDPOINT}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${NVIDIA_NIM_API_KEY}` },
    body: JSON.stringify({
      model: options.model || NIM_DEFAULT_MODEL,
      messages: options.messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 2048,
    }),
    timeoutMs: options.timeoutMs ?? 60_000,
  });
  if (!res.ok) {
    const error = await res.text();
    throw new Error(`NVIDIA NIM API 錯誤 (${res.status}): ${error.slice(0, 300)}`);
  }
  return (await res.json()) as ChatCompletionResponse;
}

/**
 * 單提示詞便利包裝(取代原本直 POST fal.run/fal-ai/any-llm 的 5 個後端呼叫點):
 * 收單一 prompt、回純文字輸出。呼叫端既有的 isMockMode 守門/扣退點/JSON 解析行為不變。
 */
export async function nimComplete(
  prompt: string,
  opts?: { model?: string; temperature?: number; maxTokens?: number; timeoutMs?: number },
): Promise<string> {
  const result = await chatCompletion({
    model: opts?.model,
    messages: [{ role: "user", content: prompt }],
    temperature: opts?.temperature,
    maxTokens: opts?.maxTokens,
    timeoutMs: opts?.timeoutMs,
  });
  return result.choices[0]?.message?.content ?? "";
}

/** 檢查 NVIDIA NIM 連線狀態(維運用,見 scripts/check-nim.ts):最小 token 呼叫確認金鑰與端點有效 */
export async function checkNimStatus(): Promise<{ ok: boolean; model?: string; error?: string }> {
  if (!NVIDIA_NIM_API_KEY) {
    return { ok: false, error: "NVIDIA_NIM_API_KEY 未設定" };
  }
  try {
    await chatCompletion({
      model: NVIDIA_MODELS.llama3_8b,
      messages: [{ role: "user", content: "Hi" }],
      maxTokens: 10,
      timeoutMs: 30_000,
    });
    return { ok: true, model: NVIDIA_MODELS.llama3_8b };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/* ── 佇列介面(生成台 llm 類):對齊 falSubmit/falStatus,generationCore 依此分流 ── */

/** 完成的任務保留 30 分鐘供輪詢端讀取後由惰性清掃回收(與陳屍清掃同口徑,防 Map 無界成長) */
const JOB_TTL_MS = 30 * 60 * 1000;

interface NimJob {
  status: "running" | "done" | "failed";
  text?: string;
  error?: string;
  /** 進入終局狀態的時刻(TTL 清掃基準;running 中不清——孤兒由 DB 端陳屍清掃兜底) */
  settledAt?: number;
}

const nimJobs = new Map<string, NimJob>();

function pruneJobs(): void {
  const now = Date.now();
  for (const [id, job] of nimJobs) {
    if (job.settledAt && now - job.settledAt > JOB_TTL_MS) nimJobs.delete(id);
  }
}

/**
 * 送出一筆 NIM 文字生成(fire-and-forget):立即回 requestId,實際呼叫在背景進行,
 * 結果由 nimStatus 輪詢取回——讓送出 mutation 跟 fal 佇列一樣快回,不被 LLM 延遲卡住。
 * 注意:mock 模式不會走到這裡(generationCore 分流時 mock 一律交給 falSubmit 的假佇列)。
 */
export function nimSubmit(input: Record<string, unknown>): { requestId: string } {
  pruneJobs();
  const requestId = `nim_${randomUUID()}`;
  nimJobs.set(requestId, { status: "running" });
  const model = typeof input.model === "string" ? input.model : undefined;
  const prompt = String(input.prompt ?? "");
  void chatCompletion({ model, messages: [{ role: "user", content: prompt }] })
    .then((res) => {
      const text = res.choices[0]?.message?.content?.trim();
      nimJobs.set(
        requestId,
        text
          ? { status: "done", text, settledAt: Date.now() }
          : { status: "failed", error: "NVIDIA NIM 回傳空內容", settledAt: Date.now() },
      );
    })
    .catch((err) => {
      nimJobs.set(requestId, {
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
        settledAt: Date.now(),
      });
    });
  return { requestId };
}

/**
 * 查一筆 NIM 任務狀態(同步、無網路呼叫)。終局結果保留至 TTL 讓多個輪詢端(背景執行器/
 * 瀏覽器)都讀得到——不能讀完即刪,否則併發輪詢的另一端會誤判失敗、與 CAS 推進打架。
 * 任務不存在(伺服器重啟過)回 running,交給既有 30 分鐘陳屍清掃標失敗+退點,不誤判終局。
 */
export function nimStatus(requestId: string): FalStatusResult {
  const job = nimJobs.get(requestId);
  if (!job) return { status: "running" };
  if (job.status === "running") return { status: "running" };
  if (job.status === "failed") return { status: "failed", error: job.error ?? "未知錯誤" };
  return { status: "done", resultText: job.text };
}
