/**
 * One-click film orchestration. Composes existing mutations only:
 * save → incremental parse → idempotent storyboard → scenes.batchGenerate
 * (agent run + quota + approval + command path). No second queue.
 */

/** Same default as DeliveryRoom so batch style does not fork. */
export const ONE_CLICK_BATCH_MODEL = "fal-ai/fast-lightning-sdxl";
/** Honest output kind for the default batch model (still image, not film). */
export const ONE_CLICK_BATCH_KIND = "image" as const;

export const STORY_FLUSH_EVENT = "aios:story-flush";
export const STORY_FLUSHED_EVENT = "aios:story-flushed";
export const STORY_FLUSH_FAILED_EVENT = "aios:story-flush-failed";

export type OneClickFilmResult = {
  runId: string;
  shots: number;
  estPoints: number;
};

export async function runOneClickFilm(ops: {
  flushStory: () => Promise<void>;
  parse: () => Promise<void>;
  generateStoryboard: () => Promise<void>;
  batchGenerate: () => Promise<OneClickFilmResult>;
}): Promise<OneClickFilmResult> {
  await ops.flushStory();
  await ops.parse();
  await ops.generateStoryboard();
  return ops.batchGenerate();
}

export function requestStoryFlush(opts?: { timeoutMs?: number }): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (ok: boolean, message?: string) => {
      if (settled) return;
      settled = true;
      window.removeEventListener(STORY_FLUSHED_EVENT, onOk);
      window.removeEventListener(STORY_FLUSH_FAILED_EVENT, onFail);
      if (ok) resolve();
      else reject(new Error(message || "故事尚未存到伺服器，無法開始生成"));
    };
    const onOk = () => finish(true);
    const onFail = (ev: Event) => {
      const detail = (ev as CustomEvent<{ message?: string }>).detail;
      finish(false, detail?.message);
    };
    window.addEventListener(STORY_FLUSHED_EVENT, onOk);
    window.addEventListener(STORY_FLUSH_FAILED_EVENT, onFail);
    window.dispatchEvent(new Event(STORY_FLUSH_EVENT));
    window.setTimeout(() => finish(false, "故事儲存逾時，請稍後再試"), opts?.timeoutMs ?? 8000);
  });
}
