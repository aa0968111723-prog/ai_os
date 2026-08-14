import { describe, expect, it } from "vitest";
import { ONE_CLICK_BATCH_MODEL, runOneClickFilm } from "./oneClickFilm";

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
