import { describe, expect, it, vi } from "vitest";
import { processIntelligenceJobBurst } from "./intelligenceRunner";

describe("Intelligence ingestion burst", () => {
  it("does not reclaim a transiently requeued job or starve the next queued job in the same burst", async () => {
    const claim = vi.fn()
      .mockResolvedValueOnce("requeued")
      .mockResolvedValueOnce("completed");

    expect(await processIntelligenceJobBurst(8, claim)).toBe(0);
    expect(claim).toHaveBeenCalledTimes(1);
  });

  it("continues through completed jobs and stops when the queue is idle", async () => {
    const claim = vi.fn()
      .mockResolvedValueOnce("completed")
      .mockResolvedValueOnce("completed")
      .mockResolvedValueOnce("idle");

    expect(await processIntelligenceJobBurst(8, claim)).toBe(2);
    expect(claim).toHaveBeenCalledTimes(3);
  });
});
