import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FAL_STORY_FALLBACK_MAX_MS,
  FAL_STORY_FALLBACK_MODEL,
  FAL_STORY_PRIMARY_MAX_MS,
  FAL_STORY_PRIMARY_MODEL,
} from "./falStoryLlm";

describe("story parse fal.ai provider contract", () => {
  it("uses GPT-5.6 Sol first and Luna as a latency fallback", () => {
    expect(FAL_STORY_PRIMARY_MODEL).toBe("openai/gpt-5.6-sol");
    expect(FAL_STORY_FALLBACK_MODEL).toBe("openai/gpt-5.6-luna");
    expect(FAL_STORY_PRIMARY_MAX_MS + FAL_STORY_FALLBACK_MAX_MS).toBeLessThan(75_000);
  });

  it("routes the production story parser through the fal adapter", () => {
    const router = readFileSync(join(process.cwd(), "server/routers/story.ts"), "utf8");
    expect(router).toContain('import { falStoryExtractComplete } from "../services/falStoryLlm"');
    expect(router).toContain("complete: falStoryExtractComplete");
  });

  it("uses fal OpenRouter OpenAI-compatible chat with the existing FAL_KEY", () => {
    const provider = readFileSync(join(process.cwd(), "server/services/falStoryLlm.ts"), "utf8");
    expect(provider).toContain("https://fal.run/openrouter/router/openai/v1/chat/completions");
    expect(provider).toContain("process.env.FAL_KEY");
    expect(provider).toContain("Authorization: `Key ${resolveFalKey()}`");
  });
});
