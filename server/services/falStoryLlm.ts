import { proxyFetch } from "./http";
import { NimServiceError } from "./nvidia-nim";
import type { StoryExtractComplete } from "./storyParse";

/**
 * 故事解析專用 fal.ai LLM。
 *
 * 為什麼不用原本 NIM：故事解析是「一次抽完整份劇本 → 結構化 JSON」的高影響步驟，
 * 而線上已多次遇到 NIM 45–75 秒無回應。這條路改走 fal.ai 的 OpenRouter
 * OpenAI-compatible endpoint；主模型用 GPT-5.6 Sol，逾時／暫時性錯誤再快速降級到
 * GPT-5.6 Luna。兩次嘗試的硬上限合計 55 秒，刻意低於前端 75 秒等待門檻。
 *
 * FAL_KEY 與現有圖片／影片生成共用，不新增第二把密鑰。
 */
export const FAL_STORY_PRIMARY_MODEL =
  process.env.FAL_STORY_PARSE_MODEL?.trim() || "openai/gpt-5.6-sol";
export const FAL_STORY_FALLBACK_MODEL =
  process.env.FAL_STORY_PARSE_FALLBACK_MODEL?.trim() || "openai/gpt-5.6-luna";

export const FAL_STORY_PRIMARY_MAX_MS = 35_000;
export const FAL_STORY_FALLBACK_MAX_MS = 20_000;

const FAL_OPENROUTER_CHAT_URL =
  "https://fal.run/openrouter/router/openai/v1/chat/completions";

function resolveFalKey(): string {
  const key = process.env.FAL_KEY?.trim();
  if (!key) {
    throw new NimServiceError(
      "fal.ai 尚未設定 FAL_KEY，故事 AI 解析目前無法使用；請先設定金鑰後重新部署",
      { degradable: false },
    );
  }
  return key;
}

function retryable(error: unknown): boolean {
  if (error instanceof NimServiceError) return error.degradable;
  if (error instanceof Error) {
    return error.name === "TimeoutError" || error.name === "AbortError";
  }
  return true;
}

async function falChatCompletion(
  prompt: string,
  model: string,
  timeoutMs: number,
): Promise<string> {
  const res = await proxyFetch(FAL_OPENROUTER_CHAT_URL, {
    method: "POST",
    headers: {
      Authorization: `Key ${resolveFalKey()}`,
      "Content-Type": "application/json",
    },
    timeoutMs,
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content:
            "你是影片前期製作的劇本結構分析師。只依使用者提供的素材工作；輸出必須符合提示詞要求的 JSON 結構，不要加 Markdown code fence，不要發明看不到的設定。",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.1,
      max_tokens: 8_000,
    }),
  });

  if (!res.ok) {
    const raw = (await res.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 240);
    const suffix = raw ? `：${raw}` : "";
    if (res.status === 401 || res.status === 403) {
      throw new NimServiceError(`fal.ai 驗證失敗（HTTP ${res.status}）${suffix}`, {
        degradable: false,
      });
    }
    if (res.status === 402) {
      throw new NimServiceError(`fal.ai 額度不足（HTTP 402）${suffix}`, {
        degradable: false,
      });
    }
    throw new NimServiceError(
      `fal.ai 模型 ${model} 暫時無法使用（HTTP ${res.status}）${suffix}`,
      { degradable: res.status === 400 || res.status === 408 || res.status === 425 || res.status === 429 || res.status >= 500 },
    );
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  const output = json.choices?.[0]?.message?.content?.trim() ?? "";
  if (!output) {
    throw new NimServiceError(`fal.ai 模型 ${model} 回傳空內容`, { degradable: true });
  }
  return output;
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
    return {
      output: await falChatCompletion(prompt, FAL_STORY_FALLBACK_MODEL, fallbackMs),
      model: FAL_STORY_FALLBACK_MODEL,
      downgraded: true,
    };
  }
};
