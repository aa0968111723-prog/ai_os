import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FAL_STORY_ENDPOINT,
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

  // Regression guard for #799: that build POSTed a synthetic
  // https://fal.run/openrouter/router/openai/v1/chat/completions with a `messages` array.
  // That route does not exist on fal, so every live parse hung until the timeout toast.
  // openrouter/router is a queue endpoint taking {prompt, system_prompt, model, ...}.
  it("submits through the fal queue endpoint the rest of the app already uses", () => {
    const provider = readFileSync(join(process.cwd(), "server/services/falStoryLlm.ts"), "utf8");
    expect(FAL_STORY_ENDPOINT).toBe("openrouter/router");
    expect(provider).toContain('falSubmit(FAL_STORY_ENDPOINT, "text"');
    expect(provider).toContain('falStatus(FAL_STORY_ENDPOINT, "text"');
    expect(provider).toContain("system_prompt");
    expect(provider).toContain("reasoning: FAL_OPENROUTER_REASONING");
    expect(provider).not.toContain("openai/v1/chat/completions");
    expect(provider).not.toContain("messages:");
    expect(provider).toContain("process.env.FAL_KEY");
  });
});
