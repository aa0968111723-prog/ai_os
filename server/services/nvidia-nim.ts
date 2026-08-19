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

/**
 * 高階（旗艦）模型：留給「一次做完、錯了整條下游都歪掉」的深度分析——
 * 目前是劇本解析（storyParse）：它要一次讀完整份劇本，同時做代名詞歸併、
 * 既有卡比對、分場分鏡與信心評分。這種長上下文＋多重推理正是 70B 會漏掉東西、
 * 405B 明顯較穩的地方；而且它一份劇本只跑一次，成本差距換得起品質。
 *
 * 逐鏡生成、助手閒聊那種高頻短任務**不要**用這顆：貴又慢，品質差距也吃不到。
 * 設 NVIDIA_NIM_REASONING_MODEL 可整站換掉（例如換成 deepseek-r1 這類推理模型）。
 */
export const NIM_REASONING_MODEL =
  process.env.NVIDIA_NIM_REASONING_MODEL?.trim() || NVIDIA_MODELS.llama3_405b;

/**
 * 旗艦模型不是保證存在的：帳號沒開通、供應商下架某個檔位、或這顆正好塞車，
 * 都會回 4xx／5xx。這時候「解析整個失敗」比「用 70B 解析」糟得多——
 * 使用者要的是把劇本變成分鏡，不是特定一顆模型。所以降級一次到日常主力模型，
 * 並把實際用了哪一顆回報給呼叫端（要寫進 AI 軌跡，不能讓人以為跑的是旗艦）。
 */
/** 旗艦逾時可以換 70B 再試；金鑰／帳號錯誤換模型救不了。 */
export function isNimTimeoutError(err: unknown): boolean {
  if (err instanceof NimServiceError) return err.degradable && /逾時|無回應/.test(err.message);
  return err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
}

/**
 * First attempt must never inherit the old 150s hang.
 * Live Zeabur still toasted「超過 150 秒無回應」when timeoutMs was omitted
 * or a caller forwarded the historic default — fallback never got a turn.
 */
/** 70B A–F extract needs ~80s; still clamp the historic 150s hang. */
export const NIM_FIRST_ATTEMPT_MAX_MS = 90_000;
/** When callers forget timeoutMs, probe quickly then fall to 70B. */
export const NIM_FIRST_ATTEMPT_DEFAULT_MS = 25_000;

export function clampNimAttemptMs(timeoutMs?: number): number {
  const raw = timeoutMs ?? NIM_FIRST_ATTEMPT_DEFAULT_MS;
  return Math.min(Math.max(1_000, raw), NIM_FIRST_ATTEMPT_MAX_MS);
}

export async function nimCompleteWithFallback(
  prompt: string,
  opts: {
    model: string;
    fallbackModel?: string;
    temperature?: number;
    maxTokens?: number;
    timeoutMs?: number;
    /** Second attempt budget. Defaults to timeoutMs — callers with a short primary must set this or the fallback re-hangs for the same long wait. */
    fallbackTimeoutMs?: number;
    signal?: AbortSignal;
  },
): Promise<{ output: string; model: string; downgraded: boolean }> {
  const fallback = opts.fallbackModel ?? NIM_DEFAULT_MODEL;
  const primaryTimeoutMs = clampNimAttemptMs(opts.timeoutMs);
  const fallbackTimeoutMs = clampNimAttemptMs(opts.fallbackTimeoutMs ?? opts.timeoutMs);
  try {
    return {
      output: await nimComplete(prompt, { ...opts, timeoutMs: primaryTimeoutMs }),
      model: opts.model,
      downgraded: false,
    };
  } catch (err) {
    if (opts.signal?.aborted) throw err;
    // Same-model 70B first-pass (short scripts) still needs the leftover budget.
    // `model === fallback` used to throw immediately — split fallbackTimeoutMs never ran.
    const splitBudget = typeof opts.fallbackTimeoutMs === "number" && opts.fallbackTimeoutMs > 0;
    if (opts.model === fallback && !splitBudget) throw err;
    // 只擋非降級（401/402/403、沒金鑰）。逾時／429／5xx 換 70B 還有機會——
    // 舊寫法 `instanceof NimServiceError` 一律再拋，live 的「超過 150 秒無回應」永遠到不了備援。
    if (err instanceof NimServiceError && !nimErrorDegradable(err)) throw err;
    console.warn(`[nim] 旗艦模型 ${opts.model} 失敗，降級為 ${fallback}：`, err);
    return {
      output: await nimComplete(prompt, {
        ...opts,
        model: fallback,
        timeoutMs: fallbackTimeoutMs,
      }),
      model: fallback,
      downgraded: true,
    };
  }
}

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
  /** 呼叫端中止訊號(如 SSE 用戶端斷線):與 timeoutMs 由 proxyFetch 以 AbortSignal.any 合成,斷線即取消在途 HTTP */
  signal?: AbortSignal;
  /**
   * 要求逐 token 對數機率（模型自報的信心值）。
   * 不是每顆模型都吃這個參數，吃不下會回 400——所以這裡不預設開，
   * 且 chatCompletion 遇到 400 會自動改用不帶 logprobs 重送一次，
   * 讓「想看信心值」永遠不會害到本來會成功的請求。
   */
  logprobs?: boolean;
}

export interface ChatCompletionResponse {
  choices: Array<{
    message: {
      role: string;
      content: string;
      /** 推理型模型主動回傳的推理摘要（OpenAI 相容欄位）；沒有就是沒有 */
      reasoning_content?: string;
    };
    /** 只有請求時帶 logprobs 才有：逐 token 的對數機率 */
    logprobs?: { content?: Array<{ token: string; logprob: number }> };
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  /** 供應商不吃 logprobs、已自動改用不帶 logprobs 重送時為 true（非供應商欄位，本層標記） */
  logprobsUnsupported?: boolean;
}

/**
 * NIM 服務限制錯誤（人話版）：免費層有「試用點數（約 1,000 次呼叫）」與「每分鐘約 40 次」兩種上限，
 * 打到上限時使用者該看到具體原因與解法，而不是通用的「暫時沒回應」。
 * 呼叫端 catch 時以 instanceof 判斷：是這個類別就把 message 原樣顯示給使用者。
 */
export class NimServiceError extends Error {
  /**
   * 這個錯誤「降級到備援供應商（fal）」救不救得了：
   * - 逾時／流量達上限（429）／暫時性問題 → true，改走 fal 使用者還有答案；
   * - 金鑰／設定錯誤（401/402/403、未設金鑰）→ false，那是設定問題，備援只會默默多花一筆。
   */
  readonly degradable: boolean;
  constructor(message: string, options?: { degradable?: boolean }) {
    super(message);
    this.name = "NimServiceError";
    this.degradable = options?.degradable ?? true;
  }
}

/** 逾時/暫時性失敗自動重試（含首次共 3 次）。LLM 端點偶發 timeout/5xx/網路抖動——
 *  一次重試就能救回大多數（實測：同一問第一次「暫時沒回應」、第二次就成功）。
 *  上限/金鑰（NimServiceError）、4xx、用戶端主動中止一律不重試。 */
const NIM_MAX_ATTEMPTS = 3;
const NIM_RETRY_BASE_MS = 400;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** 這個錯誤該不該重試：上限/金鑰重試無用；4xx 客戶端錯誤重試無用；
 *  網路錯誤、逾時（TimeoutError，無 nimStatus）、5xx 伺服器暫時性錯誤才重試。 */
export function nimRetryable(err: unknown): boolean {
  if (err instanceof NimServiceError) return false;
  const status = (err as { nimStatus?: number } | null | undefined)?.nimStatus;
  if (typeof status === "number") return status >= 500; // 5xx 才重試；4xx 不重試
  return true; // 無 HTTP 狀態＝網路/逾時類，重試
}

/** 這個 NIM 錯誤該不該觸發「降級到備援供應商（fal）」：逾時／429／暫時性問題（5xx、無狀態的網路類）
 *  可以——降級讓使用者還有答案；金鑰／設定錯誤（401/402/403、未設金鑰）備援救不了，不降級。 */
export function nimErrorDegradable(err: unknown): boolean {
  if (err instanceof NimServiceError) return err.degradable;
  const status = (err as { nimStatus?: number } | null | undefined)?.nimStatus;
  if (typeof status === "number") return status >= 500; // 5xx 暫時性可降級；4xx 客戶端錯誤不降級
  return true; // 無 HTTP 狀態＝網路/逾時類，可降級
}

/** 呼叫 NVIDIA NIM Chat API(OpenAI 相容);金鑰未設或 HTTP 錯誤一律拋例外,由呼叫端退點。
 *  暫時性失敗（逾時/5xx/網路）會自動退避重試至多 NIM_MAX_ATTEMPTS 次（見 nimRetryable）。
 *
 *  **總時限不變式**：`timeoutMs` 是**整段呼叫（含重試）**的上限，不是「每次重試各吃一個」。
 *  舊版每次 attempt 各拿完整 timeoutMs，單次 ask 最壞卡到 3×60s=180s——長上下文（A2）與
 *  工具動作（T3）逾時都栽在這裡：使用者等 60–100s 沒回應、trace 停在 prepared。重試只該
 *  救「短暫」抖動（快速 5xx／網路 blip），救不了「模型真的慢」；真正的慢讓它在 deadline 內
 *  結束並以明確人話逾時收束，不無聲地把等待時間翻三倍。 */
export async function chatCompletion(options: ChatCompletionOptions): Promise<ChatCompletionResponse> {
  if (!NVIDIA_NIM_API_KEY) {
    throw new NimServiceError("AI 文字服務尚未設定金鑰——請管理員到 build.nvidia.com 申請（免費）並設定 NVIDIA_NIM_API_KEY", { degradable: false });
  }
  const timeoutMs = options.timeoutMs ?? 60_000;
  // 整個呼叫（含所有重試）的總時限。逾時以 NimServiceError 拋出＝不重試、呼叫端直接顯示人話原因。
  const deadline = Date.now() + timeoutMs;
  const timeoutError = () => new NimServiceError(`AI 文字服務回應逾時（超過 ${Math.round(timeoutMs / 1000)} 秒無回應）`);
  let lastErr: unknown;
  for (let attempt = 1; attempt <= NIM_MAX_ATTEMPTS; attempt++) {
    if (options.signal?.aborted) throw lastErr ?? new DOMException("已中止", "AbortError");
    if (Date.now() >= deadline) throw timeoutError(); // 總時限已到：不再發起新的 attempt
    try {
      const res = await proxyFetch(`${NVIDIA_NIM_ENDPOINT}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${NVIDIA_NIM_API_KEY}` },
        body: JSON.stringify({
          model: options.model || NIM_DEFAULT_MODEL,
          messages: options.messages,
          temperature: options.temperature ?? 0.7,
          max_tokens: options.maxTokens ?? 2048,
          ...(options.logprobs ? { logprobs: true } : {}),
        }),
        // 每次請求只吃「剩餘預算」：重試不會把總時間拖超過 deadline
        timeoutMs: Math.max(1_000, deadline - Date.now()),
        signal: options.signal,
      });
      if (!res.ok) {
        const error = await res.text();
        // 這顆模型不吃 logprobs：降級重送一次（沒有信心值總比整個請求失敗好）
        if (res.status === 400 && options.logprobs) {
          const fallback = await chatCompletion({ ...options, logprobs: false });
          return { ...fallback, logprobsUnsupported: true };
        }
        // NIM 免費層的兩種上限＋金鑰問題轉人話（讓使用者/管理員知道怎麼辦）；其他錯誤保留原文供除錯
        if (res.status === 429) {
          throw new NimServiceError("AI 文字服務流量達上限（NIM 免費層約每分鐘 40 次）——等一分鐘再試；常態壅塞請管理員向 NVIDIA 申請提高流量");
        }
        if (res.status === 401 || res.status === 402 || res.status === 403) {
          throw new NimServiceError("NIM 金鑰無效或免費試用點數已用完——請管理員到 build.nvidia.com 檢查帳號點數、換新金鑰，或申請加值", { degradable: false });
        }
        const e = new Error(`NVIDIA NIM API 錯誤 (${res.status}): ${error.slice(0, 300)}`) as Error & { nimStatus?: number };
        e.nimStatus = res.status; // 供 nimRetryable 判斷 5xx 可重試、4xx 不重試
        throw e;
      }
      return (await res.json()) as ChatCompletionResponse;
    } catch (err) {
      if (options.signal?.aborted) throw err; // 用戶端主動中止（SSE 斷線）：尊重中止，不重試
      if (!nimRetryable(err)) throw err; // 上限/金鑰/4xx：重試無用，原樣拋
      lastErr = err;
      if (attempt >= NIM_MAX_ATTEMPTS) throw err; // 用完次數：拋最後一次錯誤（呼叫端照舊退點/顯示人話）
      // 重試的價值只在救「短暫」抖動：剩餘預算不足一次完整的請求窗口，重啟只是把使用者等待加倍——直接逾時收束
      if (deadline - Date.now() < timeoutMs / 2) throw timeoutError();
      await sleep(NIM_RETRY_BASE_MS * attempt); // 線性退避：400ms、800ms
    }
  }
  throw lastErr ?? new Error("NVIDIA NIM 呼叫失敗");
}

/**
 * 單提示詞便利包裝(取代原本直 POST fal.run/fal-ai/any-llm 的 5 個後端呼叫點):
 * 收單一 prompt、回純文字輸出。呼叫端既有的 isMockMode 守門/扣退點/JSON 解析行為不變。
 */
export async function nimComplete(
  prompt: string,
  opts?: { model?: string; temperature?: number; maxTokens?: number; timeoutMs?: number; signal?: AbortSignal },
): Promise<string> {
  const result = await chatCompletion({
    model: opts?.model,
    messages: [{ role: "user", content: prompt }],
    temperature: opts?.temperature,
    maxTokens: opts?.maxTokens,
    timeoutMs: opts?.timeoutMs,
    signal: opts?.signal,
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
