import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./fal", () => ({
  falSubmit: vi.fn(),
  falStatus: vi.fn(),
}));

import { falStatus, falSubmit } from "./fal";
import {
  FAL_STORY_FALLBACK_MODEL,
  FAL_STORY_PRIMARY_MODEL,
  falStoryExtractComplete,
} from "./falStoryLlm";
import { NimServiceError } from "./nvidia-nim";

const submit = vi.mocked(falSubmit);
const status = vi.mocked(falStatus);

const opts = { model: "ignored", timeoutMs: 1_000, fallbackTimeoutMs: 1_000 };

describe("falStoryExtractComplete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.FAL_KEY = "test-key";
    submit.mockResolvedValue({ requestId: "req-1" });
  });

  it("sends openrouter/router the prompt shape that endpoint actually accepts", async () => {
    status.mockResolvedValue({ status: "done", resultText: '{"scenes":[]}' });

    const result = await falStoryExtractComplete("整份劇本", opts);

    expect(result).toMatchObject({
      output: '{"scenes":[]}',
      model: FAL_STORY_PRIMARY_MODEL,
      downgraded: false,
    });
    const [endpoint, kind, input] = submit.mock.calls[0]!;
    expect(endpoint).toBe("openrouter/router");
    expect(kind).toBe("text");
    expect(input).toMatchObject({ prompt: "整份劇本", model: FAL_STORY_PRIMARY_MODEL, reasoning: true });
    expect(typeof input.system_prompt).toBe("string");
    expect(input).not.toHaveProperty("messages");
  });

  it("downgrades to the cheaper model when the flagship stays queued past its probe", async () => {
    status.mockImplementation(async (_endpoint, _kind, requestId) =>
      requestId === "slow" ? { status: "running" as const } : { status: "done" as const, resultText: "{}" },
    );
    submit.mockResolvedValueOnce({ requestId: "slow" }).mockResolvedValueOnce({ requestId: "fast" });

    const result = await falStoryExtractComplete("整份劇本", opts);

    expect(result).toMatchObject({ model: FAL_STORY_FALLBACK_MODEL, downgraded: true });
    expect(submit.mock.calls[1]![2]).toMatchObject({ model: FAL_STORY_FALLBACK_MODEL });
  });

  it("reports how long the user actually waited when both models time out", async () => {
    status.mockResolvedValue({ status: "running" });

    const error = await falStoryExtractComplete("整份劇本", opts).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(NimServiceError);
    const seconds = Number(/超過 (\d+) 秒/.exec(String((error as Error).message))?.[1]);
    // Both attempts were capped at 1s each, so the toast must say ~2s — never the
    // caller-side 75s budget that #799's message borrowed.
    expect(seconds).toBeGreaterThanOrEqual(2);
    expect(seconds).toBeLessThan(10);
    expect((error as NimServiceError).degradable).toBe(true);
  });

  it("does not burn the fallback on an auth failure a second model cannot fix", async () => {
    submit.mockRejectedValue(new Error("fal submit 失敗 401: unauthorized"));

    const error = await falStoryExtractComplete("整份劇本", opts).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(NimServiceError);
    expect((error as NimServiceError).degradable).toBe(false);
    expect(submit).toHaveBeenCalledTimes(1);
  });
});
