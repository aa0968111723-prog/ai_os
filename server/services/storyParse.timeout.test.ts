import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { NimServiceError } from "./nvidia-nim";
import {
  extractStoryPlanFromProvider,
  mockStoryExtract,
  resolveStoryExtractStrategy,
  STORY_PARSE_LONG_FALLBACK_MS,
  STORY_PARSE_LONG_PRIMARY_MS,
  STORY_PARSE_SHORT_CHARS,
  STORY_PARSE_SHORT_FALLBACK_MS,
  STORY_PARSE_SHORT_PRIMARY_MS,
} from "./storyParse";
import { NIM_DEFAULT_MODEL, NIM_FIRST_ATTEMPT_MAX_MS, NIM_REASONING_MODEL } from "./nvidia-nim";
import { TKU_ZEN_SHOTLIST_A_LINE, TKU_ZEN_SHOTLIST_AD_PARSE, TKU_ZEN_SHOTLIST_FIRST_PARSE } from "../../shared/fixtures/tkuZenPromo";

describe("story parse bounded extract（~1k 稿不得掛死 150s）", () => {
  it("a ~300-char Chinese SHOTLIST uses 70B first with time to finish, not 405B/150s", () => {
    expect(TKU_ZEN_SHOTLIST_FIRST_PARSE.length).toBeGreaterThanOrEqual(280);
    expect(TKU_ZEN_SHOTLIST_FIRST_PARSE.length).toBeLessThanOrEqual(STORY_PARSE_SHORT_CHARS);
    expect(TKU_ZEN_SHOTLIST_A_LINE.length).toBe(66);
    expect(TKU_ZEN_SHOTLIST_AD_PARSE.length).toBe(161);
    const tiny = resolveStoryExtractStrategy(21);
    const aLine = resolveStoryExtractStrategy(TKU_ZEN_SHOTLIST_A_LINE.length);
    const ad = resolveStoryExtractStrategy(TKU_ZEN_SHOTLIST_AD_PARSE.length);
    const strategy = resolveStoryExtractStrategy(TKU_ZEN_SHOTLIST_FIRST_PARSE.length);
    expect(tiny.primaryModel).toBe(strategy.primaryModel);
    expect(aLine.primaryModel).toBe(strategy.primaryModel);
    expect(ad.primaryModel).toBe(strategy.primaryModel);
    expect(aLine.primaryModel).not.toBe(NIM_REASONING_MODEL);
    expect(ad.primaryModel).not.toBe(NIM_REASONING_MODEL);
    expect(strategy.primaryModel).toContain("70b");
    expect(strategy.fallbackModel).toBe(NIM_DEFAULT_MODEL);
    expect(strategy.primaryTimeoutMs).toBe(STORY_PARSE_SHORT_PRIMARY_MS);
    expect(strategy.fallbackTimeoutMs).toBe(STORY_PARSE_SHORT_FALLBACK_MS);
    expect(strategy.primaryTimeoutMs).toBeGreaterThanOrEqual(40_000);
    expect(strategy.primaryTimeoutMs).toBeLessThan(NIM_FIRST_ATTEMPT_MAX_MS);
    expect(strategy.primaryTimeoutMs + strategy.fallbackTimeoutMs).toBeLessThan(90_000);
    expect(strategy.budgetMs).toBeLessThan(90_000);
    expect(String(strategy.primaryTimeoutMs)).not.toMatch(/150000/);
  });

  it("a ~1167-char script uses 70B first with a short budget, not 405B/150s", () => {
    const strategy = resolveStoryExtractStrategy(1_167);
    expect(1_167).toBeLessThanOrEqual(STORY_PARSE_SHORT_CHARS);
    expect(strategy.primaryModel).toContain("70b");
    expect(strategy.fallbackModel).toBe(NIM_DEFAULT_MODEL);
    expect(strategy.fallbackModel).not.toBe(NIM_REASONING_MODEL);
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

  it("cache-miss EXTRACT for 2k and 12k never forwards 405B/150s to the provider", async () => {
    const seen: Array<{ model: string; timeoutMs?: number; fallbackTimeoutMs?: number }> = [];
    const complete = vi.fn(async (_prompt: string, opts: { model: string; timeoutMs?: number; fallbackTimeoutMs?: number }) => {
      seen.push(opts);
      return { output: "{\"ok\":1}", model: opts.model, downgraded: false };
    });
    await extractStoryPlanFromProvider("sys", 2_000, complete);
    await extractStoryPlanFromProvider("sys", 12_000, complete);
    expect(seen[0]).toMatchObject({ model: NIM_DEFAULT_MODEL, timeoutMs: STORY_PARSE_SHORT_PRIMARY_MS });
    expect(seen[0]?.model).not.toBe(NIM_REASONING_MODEL);
    expect(seen[1]).toMatchObject({ model: NIM_REASONING_MODEL, timeoutMs: STORY_PARSE_LONG_PRIMARY_MS });
    expect(seen[1]?.timeoutMs).toBeLessThan(150_000);
    expect(seen[1]?.fallbackTimeoutMs).toBe(STORY_PARSE_LONG_FALLBACK_MS);
    expect(seen.every((call) => (call.timeoutMs ?? 150_000) < 150_000)).toBe(true);
  });

  it("66-char A-line, 161-char A–D, and 301-char SHOTLIST share the 70B first-pass", async () => {
    const seen: string[] = [];
    const complete = vi.fn(async (_prompt: string, opts: { model: string; timeoutMs?: number }) => {
      seen.push(opts.model);
      expect(opts.model).toBe(NIM_DEFAULT_MODEL);
      expect(opts.timeoutMs).toBe(STORY_PARSE_SHORT_PRIMARY_MS);
      return { output: "{\"ok\":1}", model: opts.model, downgraded: false };
    });
    await extractStoryPlanFromProvider("sys", TKU_ZEN_SHOTLIST_A_LINE.length, complete);
    await extractStoryPlanFromProvider("sys", TKU_ZEN_SHOTLIST_AD_PARSE.length, complete);
    await extractStoryPlanFromProvider("sys", TKU_ZEN_SHOTLIST_FIRST_PARSE.length, complete);
    expect(seen).toEqual([NIM_DEFAULT_MODEL, NIM_DEFAULT_MODEL, NIM_DEFAULT_MODEL]);
  });

  it("~300-char Chinese first parse completes in mock without a 150s timeout", async () => {
    const complete = vi.fn(async (_prompt: string, opts: { model: string; timeoutMs?: number; fallbackTimeoutMs?: number }) => {
      expect(opts.model).toBe(NIM_DEFAULT_MODEL);
      expect(opts.timeoutMs ?? 150_000).toBe(STORY_PARSE_SHORT_PRIMARY_MS);
      expect(opts.timeoutMs ?? 150_000).toBeLessThan(150_000);
      expect(opts.fallbackTimeoutMs ?? 150_000).toBe(STORY_PARSE_SHORT_FALLBACK_MS);
      return {
        output: JSON.stringify(mockStoryExtract(TKU_ZEN_SHOTLIST_FIRST_PARSE)),
        model: NIM_DEFAULT_MODEL,
        downgraded: false,
      };
    });
    const started = Date.now();
    const result = await extractStoryPlanFromProvider("sys", TKU_ZEN_SHOTLIST_FIRST_PARSE.length, complete);
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(result.output).toContain("小華");
    expect(result.strategy.primaryTimeoutMs).toBe(STORY_PARSE_SHORT_PRIMARY_MS);
    expect(result.strategy.budgetMs).toBeLessThan(90_000);
    expect(complete).toHaveBeenCalledOnce();
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

/**
 * Teammate mapped the 150s hang: proxyFetch only hits undici ~300s when
 * timeoutMs is omitted. chatCompletion always passes remaining budget.
 * Hard cap is the NIM timeout (old default 150s), not a Zeabur/Vercel gateway.
 * Do not add a default in http.ts — keep the fix in nimCompleteWithFallback
 * + runStoryParse budget split only.
 */
describe("parse hang is NIM timeout, not a platform gateway", () => {
  it("chatCompletion always forwards remaining budget; http.ts has no default timeoutMs", () => {
    const http = readFileSync(join(process.cwd(), "server/services/http.ts"), "utf8");
    expect(http).toContain("if (timeoutMs && timeoutMs > 0)");
    expect(http).not.toMatch(/timeoutMs\s*=\s*[^\n]*\?\?\s*\d+/);
    expect(http).not.toMatch(/AbortSignal\.timeout\(\s*(150_000|300_000)/);

    const nim = readFileSync(join(process.cwd(), "server/services/nvidia-nim.ts"), "utf8");
    const chatStart = nim.indexOf("export async function chatCompletion");
    const chat = nim.slice(chatStart, nim.indexOf("export async function nimComplete(", chatStart));
    expect(chat).toContain("const timeoutMs = options.timeoutMs ?? 60_000");
    expect(chat).toContain("timeoutMs: Math.max(1_000, deadline - Date.now())");

    const fallback = nim.slice(
      nim.indexOf("export const NIM_FIRST_ATTEMPT_MAX_MS"),
      nim.indexOf("export interface ChatMessage"),
    );
    expect(fallback).toContain("clampNimAttemptMs");
    expect(fallback).toContain("NIM_FIRST_ATTEMPT_MAX_MS");
    expect(fallback).toContain("nimErrorDegradable");

    const parse = readFileSync(join(process.cwd(), "server/services/storyParse.ts"), "utf8");
    expect(parse).toContain("complete: StoryExtractComplete = nimCompleteWithFallback");
    expect(parse).toContain("timeoutMs: strategy.primaryTimeoutMs");
    expect(parse).toContain("fallbackTimeoutMs: strategy.fallbackTimeoutMs");
    expect(parse).toContain("extractStoryPlanFromProvider(sys, sentStory.length, input.complete)");
    expect(parse).toContain("lockXiaohuaCharacters");
    expect(parse).toContain("禁止發明「年輕男性");
    // Teammate live audit: cache-miss of any length called 405B / 150s. That one-liner must stay gone.
    const codeOnly = parse
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("//") && !line.trimStart().startsWith("*"))
      .join("\n");
    expect(codeOnly).not.toMatch(/nimCompleteWithFallback\(\s*sys,/);
    expect(codeOnly).not.toMatch(/timeoutMs:\s*150_000/);
  });

  it("cache-miss of 301, ~2k, or 12k never uses 405B/150s; short scripts start on 70B", () => {
    for (const n of [301, 1_167, 2_000, 12_000]) {
      const strategy = resolveStoryExtractStrategy(n);
      expect(strategy.primaryTimeoutMs).toBeLessThan(150_000);
      expect(strategy.fallbackTimeoutMs).toBeLessThan(150_000);
      expect(strategy.primaryTimeoutMs + strategy.fallbackTimeoutMs).toBeLessThan(150_000);
      expect(strategy.fallbackModel).toBe(NIM_DEFAULT_MODEL);
    }
    const tiny = resolveStoryExtractStrategy(21);
    const aLine = resolveStoryExtractStrategy(66);
    const ad = resolveStoryExtractStrategy(161);
    const shotlist = resolveStoryExtractStrategy(301);
    const mid = resolveStoryExtractStrategy(2_000);
    expect(tiny.primaryModel).toBe(NIM_DEFAULT_MODEL);
    expect(aLine.primaryModel).toBe(NIM_DEFAULT_MODEL);
    expect(ad.primaryModel).toBe(NIM_DEFAULT_MODEL);
    expect(ad.primaryModel).not.toBe(NIM_REASONING_MODEL);
    expect(shotlist.primaryModel).toBe(NIM_DEFAULT_MODEL);
    expect(mid.primaryModel).toBe(NIM_DEFAULT_MODEL);
    expect(shotlist.primaryModel).not.toBe(NIM_REASONING_MODEL);
    expect(mid.primaryModel).not.toBe(NIM_REASONING_MODEL);
    const long = resolveStoryExtractStrategy(12_000);
    expect(long.primaryModel).toBe(NIM_REASONING_MODEL);
    expect(long.primaryTimeoutMs).toBeLessThanOrEqual(60_000);
    expect(long.fallbackModel).toBe(NIM_DEFAULT_MODEL);
  });

  it("repo has no zeabur.toml / vercel.json / nginx / maxDuration cap", () => {
    expect(existsSync(join(process.cwd(), "zeabur.toml"))).toBe(false);
    expect(existsSync(join(process.cwd(), "vercel.json"))).toBe(false);
    expect(existsSync(join(process.cwd(), "nginx.conf"))).toBe(false);
    expect(existsSync(join(process.cwd(), "nginx"))).toBe(false);
  });
});
