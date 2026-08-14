/**
 * One-click film orchestration. Composes existing mutations only:
 * save → incremental parse → idempotent storyboard → scenes.batchGenerate
 * (agent run + quota + approval + command path). No second queue.
 */

/** Same default as DeliveryRoom so batch style does not fork. */
export const ONE_CLICK_BATCH_MODEL = "fal-ai/fast-lightning-sdxl";

export const STORY_FLUSH_EVENT = "aios:story-flush";

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

export function requestStoryFlush(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      window.removeEventListener("aios:story-flushed", done);
      resolve();
    };
    window.addEventListener("aios:story-flushed", done, { once: true });
    window.dispatchEvent(new Event(STORY_FLUSH_EVENT));
    window.setTimeout(done, 1200);
  });
}
