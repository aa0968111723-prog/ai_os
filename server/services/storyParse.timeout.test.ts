import { describe, expect, it, vi } from "vitest";
import { NimServiceError } from "./nvidia-nim";
import {
  extractStoryPlanFromProvider,
  resolveStoryExtractStrategy,
  STORY_PARSE_LONG_FALLBACK_MS,
  STORY_PARSE_LONG_PRIMARY_MS,
  STORY_PARSE_SHORT_CHARS,
} from "./storyParse";
import { NIM_DEFAULT_MODEL, NIM_REASONING_MODEL } from "./nvidia-nim";

describe("story parse bounded extract（~1k 稿不得掛死 150s）", () => {
  it("a ~1167-char script uses 70B first with a short budget, not 405B/150s", () => {
    const strategy = resolveStoryExtractStrategy(1_167);
    expect(1_167).toBeLessThanOrEqual(STORY_PARSE_SHORT_CHARS);
    expect(strategy.primaryModel).toContain("70b");
    expect(strategy.primaryTimeoutMs).toBeLessThanOrEqual(45_000);
    expect(strategy.budgetMs).toBeLessThanOrEqual(80_000);
    expect(strategy.primaryTimeoutMs + strategy.fallbackTimeoutMs).toBeLessThan(150_000);
  });

  it("a hanging provider fails with a recoverable error under the budget, not a hang", async () => {
    const complete = vi.fn(async (_prompt: string, opts: { timeoutMs?: number; fallbackTimeoutMs?: number }) => {
      const wait = opts.timeoutMs ?? 150_000;
      await new Promise((_, reject) => {
        setTimeout(() => reject(new NimServiceError(`AI 文字服務回應逾時（超過 ${Math.round(wait / 1000)} 秒無回應）`)), wait);
      });
      throw new Error("unreachable");
    });

    vi.useFakeTimers();
    const pending = extractStoryPlanFromProvider("sys", 1_167, complete).then(
      (value) => ({ ok: true as const, value }),
      (error) => ({ ok: false as const, error }),
    );
    const strategy = resolveStoryExtractStrategy(1_167);
    await vi.advanceTimersByTimeAsync(strategy.budgetMs);
    const result = await pending;
    vi.useRealTimers();

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error).toBeInstanceOf(NimServiceError);
    expect(String(result.error)).toMatch(/逾時/);
    expect(String(result.error)).not.toMatch(/超過 150 秒/);
    expect(complete).toHaveBeenCalled();
    const firstTimeout = complete.mock.calls[0]?.[1]?.timeoutMs ?? 0;
    expect(firstTimeout).toBeLessThanOrEqual(45_000);
  });

  it("long parse splits 405B / 70B so one model cannot spend 150s", () => {
    const strategy = resolveStoryExtractStrategy(8_000);
    expect(strategy.primaryModel).toBe(NIM_REASONING_MODEL);
    expect(strategy.fallbackModel).toBe(NIM_DEFAULT_MODEL);
    expect(strategy.primaryTimeoutMs).toBe(STORY_PARSE_LONG_PRIMARY_MS);
    expect(strategy.fallbackTimeoutMs).toBe(STORY_PARSE_LONG_FALLBACK_MS);
    expect(strategy.primaryTimeoutMs).toBeGreaterThanOrEqual(45_000);
    expect(strategy.primaryTimeoutMs).toBeLessThanOrEqual(60_000);
    expect(strategy.fallbackTimeoutMs).toBeGreaterThanOrEqual(50_000);
    expect(strategy.fallbackTimeoutMs).toBeLessThanOrEqual(60_000);
    expect(strategy.primaryTimeoutMs + strategy.fallbackTimeoutMs).toBeLessThanOrEqual(120_000);
    expect(strategy.primaryTimeoutMs).toBeLessThan(150_000);
    expect(strategy.fallbackTimeoutMs).toBeLessThan(150_000);
  });
});
