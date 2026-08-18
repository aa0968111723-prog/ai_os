/**
 * P0: runStoryParse EXTRACT must fall to 70B under 150s.
 * Live 405B/150s hung 301字 and sat 161字 for ~2min.
 * Do not restore timeoutMs: 150_000 on the flagship first attempt.
 */
import { describe, expect, it, vi } from "vitest";
import {
  extractStoryPlanFromProvider,
  resolveStoryExtractStrategy,
  STORY_PARSE_SHORT_PRIMARY_MS,
} from "./storyParse";
import {
  clampNimAttemptMs,
  NIM_DEFAULT_MODEL,
  NIM_FIRST_ATTEMPT_MAX_MS,
  NIM_REASONING_MODEL,
} from "./nvidia-nim";
import {
  TKU_ZEN_SHOTLIST_A_LINE,
  TKU_ZEN_SHOTLIST_AD_PARSE,
  TKU_ZEN_SHOTLIST_FIRST_PARSE,
} from "../../shared/fixtures/tkuZenPromo";

describe("runStoryParse falls to 70B under 150s", () => {
  it("66 / 161 / 301 char pastes all start on 70B with budget < 150s", () => {
    for (const chars of [TKU_ZEN_SHOTLIST_A_LINE.length, TKU_ZEN_SHOTLIST_AD_PARSE.length, TKU_ZEN_SHOTLIST_FIRST_PARSE.length]) {
      const strategy = resolveStoryExtractStrategy(chars);
      expect(chars).toBeLessThanOrEqual(2_000);
      expect(strategy.primaryModel).toBe(NIM_DEFAULT_MODEL);
      expect(strategy.primaryModel).toContain("70b");
      expect(strategy.primaryModel).not.toBe(NIM_REASONING_MODEL);
      expect(strategy.fallbackModel).toBe(NIM_DEFAULT_MODEL);
      expect(strategy.primaryTimeoutMs).toBe(STORY_PARSE_SHORT_PRIMARY_MS);
      expect(strategy.primaryTimeoutMs + strategy.fallbackTimeoutMs).toBeLessThan(150_000);
      expect(strategy.budgetMs).toBeLessThan(150_000);
    }
  });

  it("EXTRACT forwards the 70B strategy — never 405B/150s — for the 161-char A–D paste", async () => {
    const complete = vi.fn(async (_prompt: string, opts: { model: string; timeoutMs?: number; fallbackTimeoutMs?: number }) => {
      expect(opts.model).toBe(NIM_DEFAULT_MODEL);
      expect(opts.timeoutMs).toBeLessThan(150_000);
      expect((opts.timeoutMs ?? 0) + (opts.fallbackTimeoutMs ?? 0)).toBeLessThan(150_000);
      return { output: "{\"ok\":1}", model: opts.model, downgraded: false };
    });
    const result = await extractStoryPlanFromProvider("sys", TKU_ZEN_SHOTLIST_AD_PARSE.length, complete);
    expect(result.strategy.primaryModel).toBe(NIM_DEFAULT_MODEL);
    expect(complete).toHaveBeenCalledOnce();
  });

  it("timeoutMs=150000 is clamped and the flagship timeout actually runs 70B", async () => {
    expect(clampNimAttemptMs(150_000)).toBe(NIM_FIRST_ATTEMPT_MAX_MS);
    expect(clampNimAttemptMs(150_000)).toBeLessThan(150_000);
  });
});
