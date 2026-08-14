import { describe, expect, it } from "vitest";
import { ONE_CLICK_BATCH_KIND, ONE_CLICK_BATCH_MODEL, requestStoryFlush, runOneClickFilm } from "./oneClickFilm";

describe("runOneClickFilm", () => {
  it("runs save → parse → storyboard → batch in order", async () => {
    const order: string[] = [];
    const result = await runOneClickFilm({
      flushStory: async () => {
        order.push("save");
      },
      parse: async () => {
        order.push("parse");
      },
      generateStoryboard: async () => {
        order.push("board");
      },
      batchGenerate: async () => {
        order.push("batch");
        return { runId: "run-1", shots: 3, estPoints: 6 };
      },
    });
    expect(order).toEqual(["save", "parse", "board", "batch"]);
    expect(result).toEqual({ runId: "run-1", shots: 3, estPoints: 6 });
    expect(ONE_CLICK_BATCH_MODEL).toBe("fal-ai/fast-lightning-sdxl");
    expect(ONE_CLICK_BATCH_KIND).toBe("image");
  });

  it("does not treat a flush timeout as success", async () => {
    const flush = requestStoryFlush({ timeoutMs: 20 });
    await expect(flush).rejects.toThrow(/尚未存到伺服器|逾時/);
  });

  it("resolves only after aios:story-flushed and rejects on aios:story-flush-failed", async () => {
    const ok = requestStoryFlush({ timeoutMs: 500 });
    window.dispatchEvent(new Event("aios:story-flushed"));
    await expect(ok).resolves.toBeUndefined();

    const fail = requestStoryFlush({ timeoutMs: 500 });
    window.dispatchEvent(new CustomEvent("aios:story-flush-failed", { detail: { message: "故事有衝突尚未處理" } }));
    await expect(fail).rejects.toThrow("故事有衝突尚未處理");
  });

  it("stops before batch if parse throws", async () => {
    const order: string[] = [];
    await expect(
      runOneClickFilm({
        flushStory: async () => {
          order.push("save");
        },
        parse: async () => {
          throw new Error("故事是空的");
        },
        generateStoryboard: async () => {
          order.push("board");
        },
        batchGenerate: async () => {
          order.push("batch");
          return { runId: "x", shots: 0, estPoints: 0 };
        },
      }),
    ).rejects.toThrow("故事是空的");
    expect(order).toEqual(["save"]);
  });
});
