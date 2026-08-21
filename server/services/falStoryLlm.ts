import { falStatus, falSubmit } from "./fal";
import { FAL_OPENROUTER_REASONING } from "./llmProvider";
import { NimServiceError } from "./nvidia-nim";
import type { StoryExtractComplete } from "./storyParse";

/**
 * 故事解析專用 fal.ai LLM。
 *
 * 為什麼不用原本 NIM：故事解析是「一次抽完整份劇本 → 結構化 JSON」的高影響步驟，
 * 而線上已多次遇到 NIM 45–75 秒無回應。這條路改走 fal.ai 的 OpenRouter 代理
 * （endpoint `openrouter/router`）；主模型 GPT-5.6 Sol，逾時／暫時性錯誤再快速降級
 * GPT-5.6 Luna（llmProvider 實測穩定 4–12s）。
 *
 * 傳輸層刻意與 llmProvider.completeFal 同一條：queue.fal.run 送件 ＋ 輪詢 status。
 * fal 上並沒有一條「同步 POST 到 openrouter/router 底下 OpenAI 相容子路徑」的入口——
 * 前一版對著那個自創網址送 chat 格式，正式站每次解析都只能掛到逾時才收場。
 * openrouter/router 吃的是 {prompt, system_prompt, model, ...}（見 shared/models.ts 的
 * llmOpenRouterInput），改動這裡請一併確認那份輸入形狀。
 *
 * FAL_KEY 與現有圖片／影片生成共用，不新增第二把密鑰。
 */
export const FAL_STORY_PRIMARY_MODEL =
  process.env.FAL_STORY_PARSE_MODEL?.trim() || "openai/gpt-5.6-sol";
export const FAL_STORY_FALLBACK_MODEL =
  process.env.FAL_STORY_PARSE_FALLBACK_MODEL?.trim() || "openai/gpt-5.6-luna";

/**
 * 兩次嘗試的硬上限合計 63 秒，低於 storyParse 短稿預算 budgetMs（75 秒）——
 * 逾時訊息報的秒數由本檔實際量測，不再借用那個 75。
 */
export const FAL_STORY_PRIMARY_MAX_MS = 38_000;
export const FAL_STORY_FALLBACK_MAX_MS = 25_000;

export const FAL_STORY_ENDPOINT = "openrouter/router";
const FAL_STORY_POLL_INTERVAL_MS = 750;

const STORY_SYSTEM_PROMPT =
  "你是影片前期製作的劇本結構分析師。只依使用者提供的素材工作；輸出必須符合提示詞要求的 JSON 結構，不要加 Markdown code fence，不要發明看不到的設定。";

function requireFalKey(): void {
  if (!process.env.FAL_KEY?.trim()) {
    throw new NimServiceError(
      "fal.ai 尚未設定 FAL_KEY，故事 AI 解析目前無法使用；請先設定金鑰後重新部署",
      { degradable: false },
    );
  }
}

function timeoutError(elapsedMs: number): NimServiceError {
  return new NimServiceError(
    `AI 模型回應逾時（超過 ${Math.max(1, Math.round(elapsedMs / 1000))} 秒無回應）`,
    { degradable: true },
  );
}

/** 金鑰／額度問題降級救不了；其餘（壅塞、暫時性 5xx、逾時）才值得換模型再試一次。 */
function retryable(error: unknown): boolean {
  if (error instanceof NimServiceError) return error.degradable;
  if (error instanceof Error) {
    return error.name === "TimeoutError" || error.name === "AbortError";
  }
  return true;
}

function submitFailure(error: unknown): NimServiceError {
  const message = error instanceof Error ? error.message : String(error);
  if (/\b401\b|\b403\b/.test(message)) {
    return new NimServiceError(`fal.ai 驗證失敗：${message.slice(0, 200)}`, { degradable: false });
  }
  if (/\b402\b/.test(message)) {
    return new NimServiceError(`fal.ai 額度不足：${message.slice(0, 200)}`, { degradable: false });
  }
  return new NimServiceError(`fal.ai 送件失敗：${message.slice(0, 200)}`, { degradable: true });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function falChatCompletion(
  prompt: string,
  model: string,
  timeoutMs: number,
): Promise<string> {
  requireFalKey();
  const deadline = Date.now() + timeoutMs;

  let requestId: string;
  try {
    ({ requestId } = await falSubmit(FAL_STORY_ENDPOINT, "text", {
      prompt,
      system_prompt: STORY_SYSTEM_PROMPT,
      model,
      // 部分 openrouter 模型強制 reasoning，設 false 會 400（見 FAL_OPENROUTER_REASONING）
      reasoning: FAL_OPENROUTER_REASONING,
      temperature: 0.1,
      max_tokens: 8_000,
    }));
  } catch (error) {
    throw submitFailure(error);
  }

  while (Date.now() < deadline) {
    const status = await falStatus(FAL_STORY_ENDPOINT, "text", requestId);
    if (status.status === "done") {
      const output = status.resultText?.trim() ?? "";
      if (!output) throw new NimServiceError(`fal.ai 模型 ${model} 回傳空內容`, { degradable: true });
      return output;
    }
    if (status.status === "failed") {
      throw new NimServiceError(
        `fal.ai 模型 ${model} 呼叫失敗：${status.error ?? "未知原因"}`,
        { degradable: true },
      );
    }
    await sleep(FAL_STORY_POLL_INTERVAL_MS);
  }
  throw timeoutError(timeoutMs);
}

/**
 * 介面刻意與 StoryExtractComplete 相同，讓 storyParse 的 EXTRACT／解析／落庫流程完全不動；
 * 只替換上游模型。storyParse 傳進來的舊 NIM model 名稱只代表歷史策略，這裡不使用它，
 * trace 會回報實際跑到的 fal 模型。
 */
export const falStoryExtractComplete: StoryExtractComplete = async (
  prompt,
  opts,
) => {
  const primaryMs = Math.min(
    Math.max(1_000, opts.timeoutMs ?? FAL_STORY_PRIMARY_MAX_MS),
    FAL_STORY_PRIMARY_MAX_MS,
  );
  const fallbackMs = Math.min(
    Math.max(1_000, opts.fallbackTimeoutMs ?? FAL_STORY_FALLBACK_MAX_MS),
    FAL_STORY_FALLBACK_MAX_MS,
  );
  const startedAt = Date.now();

  try {
    return {
      output: await falChatCompletion(prompt, FAL_STORY_PRIMARY_MODEL, primaryMs),
      model: FAL_STORY_PRIMARY_MODEL,
      downgraded: false,
    };
  } catch (error) {
    if (!retryable(error)) throw error;
    console.warn(
      `[storyParse] fal 主模型 ${FAL_STORY_PRIMARY_MODEL} 失敗，改用 ${FAL_STORY_FALLBACK_MODEL}：`,
      error instanceof Error ? error.message : error,
    );
    try {
      return {
        output: await falChatCompletion(prompt, FAL_STORY_FALLBACK_MODEL, fallbackMs),
        model: FAL_STORY_FALLBACK_MODEL,
        downgraded: true,
      };
    } catch (fallbackError) {
      // 兩檔都逾時：報「整段實際等了幾秒」，而不是單一次嘗試的上限——
      // 使用者看到的秒數必須對得上他真的等了多久。
      if (fallbackError instanceof NimServiceError && fallbackError.degradable && /逾時|無回應/.test(fallbackError.message)) {
        throw timeoutError(Date.now() - startedAt);
      }
      throw fallbackError;
    }
  }
};
