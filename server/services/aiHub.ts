/**
 * Zeabur AI Hub 供應層（OpenAI 相容）。
 *
 * 為什麼多這一條：站內文字模型長期走 NVIDIA NIM 免費層，實測中位 52s、並行負載下大量逾時；
 * AI Hub 與應用同機房，且**一律開串流**——使用者等的是「第一個字」而不是「整包 body」。
 *
 * 設定：`OPENAI_BASE_URL` 與 `OPENAI_API_KEY`（Zeabur 上已設；本機放 .env）。
 * 模型由 `OPENAI_MODEL` 指定，未設時用 DEFAULT_HUB_MODEL。
 *
 * 連線重用：OpenAI SDK v7 走原生 fetch，**不吃 Node 的 `https.Agent`**——同義且真的有效的做法是
 * 給它 undici 的 Agent 當 dispatcher（keepAlive 是 undici 連線池的預設行為，這裡把閒置保留時間
 * 拉長並固定連線數，讓連續問答不必每次重做 TLS 握手）。出口有代理時改用 ProxyAgent，
 * 與 services/http.ts 的 proxyFetch 同一套判斷，不繞過出口控管。
 */
import { Agent as UndiciAgent, ProxyAgent, fetch as undiciFetch } from "undici";
import OpenAI from "openai";
import { shouldBypass } from "./http";
import { markTiming, measureTiming } from "./requestTiming";

export const DEFAULT_HUB_MODEL = "gpt-5.6-luna";
/** 連線閒置保留時間：一次對話往返之間通常只隔幾秒，保住連線就省下整個 TLS 握手。 */
const KEEP_ALIVE_TIMEOUT_MS = 60_000;
const KEEP_ALIVE_MAX_TIMEOUT_MS = 5 * 60_000;

export class AiHubError extends Error {
  /** 換供應商（NIM／fal）救不救得了：金鑰／設定錯誤救不了，逾時與 5xx 可以。 */
  readonly degradable: boolean;
  readonly status?: number;
  constructor(message: string, options?: { degradable?: boolean; status?: number; cause?: unknown }) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = "AiHubError";
    this.degradable = options?.degradable ?? true;
    this.status = options?.status;
  }
}

export function hubBaseUrl(): string | undefined {
  return process.env.OPENAI_BASE_URL?.trim() || undefined;
}

export function hubModel(): string {
  return process.env.OPENAI_MODEL?.trim() || DEFAULT_HUB_MODEL;
}

/** 兩個變數都設好才算可用——少一個就當沒設定，讓呼叫端安靜地走既有 NIM／fal 路徑。 */
export function isAiHubConfigured(): boolean {
  return Boolean(hubBaseUrl() && process.env.OPENAI_API_KEY?.trim());
}

let cachedClient: { key: string; client: OpenAI } | undefined;
let cachedDispatcher: { proxy: string; agent: UndiciAgent | ProxyAgent } | undefined;

function dispatcherFor(baseUrl: string): UndiciAgent | ProxyAgent | undefined {
  const proxyUrl =
    process.env.HTTPS_PROXY ?? process.env.https_proxy ?? process.env.HTTP_PROXY ?? process.env.http_proxy ?? "";
  const useProxy = Boolean(proxyUrl) && !shouldBypass(baseUrl);
  const cacheKey = useProxy ? proxyUrl : "direct";
  if (cachedDispatcher?.proxy === cacheKey) return cachedDispatcher.agent;
  const agent = useProxy
    ? new ProxyAgent(proxyUrl)
    : new UndiciAgent({
        keepAliveTimeout: KEEP_ALIVE_TIMEOUT_MS,
        keepAliveMaxTimeout: KEEP_ALIVE_MAX_TIMEOUT_MS,
        connections: 32,
      });
  cachedDispatcher = { proxy: cacheKey, agent };
  return agent;
}

/** 測試用：丟掉快取的 client 與連線池，讓下一次呼叫重讀環境變數。 */
export function __resetAiHubClient(): void {
  cachedClient = undefined;
  cachedDispatcher = undefined;
}

function client(): OpenAI {
  const baseURL = hubBaseUrl();
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!baseURL || !apiKey) {
    throw new AiHubError("AI Hub 尚未設定（需要 OPENAI_BASE_URL 與 OPENAI_API_KEY）", { degradable: false });
  }
  // 同一組設定重用同一個 client 就是重用同一個連線池；設定換了才重建。
  const cacheKey = `${baseURL} ${apiKey}`;
  if (cachedClient?.key === cacheKey) return cachedClient.client;
  const instance = new OpenAI({
    baseURL,
    apiKey,
    // SDK 自帶重試會把「一次慢」變成「三次慢」，逾時語意由呼叫端的 timeoutMs 與 signal 決定。
    maxRetries: 0,
    fetch: undiciFetch as unknown as typeof fetch,
    fetchOptions: { dispatcher: dispatcherFor(baseURL) } as Record<string, unknown>,
  });
  cachedClient = { key: cacheKey, client: instance };
  return instance;
}

export interface HubMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface HubCompleteParams {
  messages: HubMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** 整段（含首 token 等待）的上限；到點以可降級的逾時錯誤收束。 */
  timeoutMs?: number;
  signal?: AbortSignal;
  /** 每收到一塊內容就呼叫一次；傳入的是「這一塊新增的文字」，不是累積值。 */
  onDelta?: (delta: string) => void;
}

export interface HubCompletion {
  text: string;
  model: string;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  /** 相對於本次呼叫開始的毫秒；供應商一個字都沒吐就是 null。 */
  firstTokenMs: number | null;
  totalMs: number;
}

function describeError(error: unknown): AiHubError {
  if (error instanceof AiHubError) return error;
  const status = (error as { status?: unknown })?.status;
  const raw = error instanceof Error ? error.message : String(error);
  const message = raw.replace(/\s+/g, " ").slice(0, 240);
  if (typeof status === "number") {
    if (status === 401 || status === 403) {
      return new AiHubError(`AI Hub 驗證失敗（HTTP ${status}）——請檢查 OPENAI_API_KEY`, { degradable: false, status, cause: error });
    }
    if (status === 402) {
      return new AiHubError("AI Hub 額度不足（HTTP 402）", { degradable: false, status, cause: error });
    }
    if (status === 404) {
      return new AiHubError(`AI Hub 找不到模型或路徑（HTTP 404）：${message}`, { degradable: false, status, cause: error });
    }
    return new AiHubError(`AI Hub 暫時無法使用（HTTP ${status}）：${message}`, { degradable: true, status, cause: error });
  }
  return new AiHubError(`AI Hub 呼叫失敗：${message}`, { degradable: true, cause: error });
}

function isBadRequest(error: unknown): boolean {
  return (error as { status?: unknown })?.status === 400;
}

/**
 * 一次串流補全。回傳完整文字（呼叫端要一次性結果時照舊可用），
 * 同時透過 onDelta 把每一塊即時交出去——SSE 路由就是靠它把字推給前端。
 */
export async function hubComplete(params: HubCompleteParams): Promise<HubCompletion> {
  const model = params.model?.trim() || hubModel();
  const startedAt = Date.now();
  const timeoutMs = params.timeoutMs && params.timeoutMs > 0 ? params.timeoutMs : 60_000;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = params.signal ? AbortSignal.any([params.signal, timeoutSignal]) : timeoutSignal;

  const run = async (includeUsage: boolean): Promise<HubCompletion> => {
    const stream = await client().chat.completions.create(
      {
        model,
        messages: params.messages,
        temperature: params.temperature ?? 0.7,
        max_tokens: params.maxTokens ?? 2_048,
        stream: true,
        ...(includeUsage ? { stream_options: { include_usage: true } } : {}),
      },
      { signal },
    );
    let text = "";
    let firstTokenMs: number | null = null;
    let usage: HubCompletion["usage"];
    let servedModel = model;
    for await (const chunk of stream) {
      if (chunk.model) servedModel = chunk.model;
      if (chunk.usage) {
        usage = {
          promptTokens: chunk.usage.prompt_tokens,
          completionTokens: chunk.usage.completion_tokens,
          totalTokens: chunk.usage.total_tokens,
        };
      }
      const delta = chunk.choices?.[0]?.delta?.content;
      if (!delta) continue;
      if (firstTokenMs === null) {
        firstTokenMs = Date.now() - startedAt;
        markTiming("firstToken");
      }
      text += delta;
      params.onDelta?.(delta);
    }
    return { text, model: servedModel, usage, firstTokenMs, totalMs: Date.now() - startedAt };
  };

  return measureTiming("llm", async () => {
    try {
      return await run(true);
    } catch (error) {
      // 逾時要說人話，且必須可降級——換供應商使用者才還有答案
      if (timeoutSignal.aborted && !params.signal?.aborted) {
        throw new AiHubError(`AI Hub 回應逾時（超過 ${Math.round(timeoutMs / 1000)} 秒無回應）`, { degradable: true, cause: error });
      }
      if (params.signal?.aborted) throw error; // 用戶端主動斷線：尊重中止，不重送
      // 代理端不吃 stream_options（OpenAI 專屬）時會回 400——拿掉再送一次，
      // 不讓「想順便看 token 用量」害到本來會成功的請求（比照 NIM 的 logprobs 降級）。
      if (isBadRequest(error)) {
        try {
          return await run(false);
        } catch (retryError) {
          throw describeError(retryError);
        }
      }
      throw describeError(error);
    }
  });
}
