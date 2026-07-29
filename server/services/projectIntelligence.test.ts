import { describe, expect, it } from "vitest";
import { formatProjectIntelligence } from "./projectIntelligence";

describe("project intelligence formatter", () => {
  it("turns scattered generation, agent and task state into one compact snapshot", () => {
    const text = formatProjectIntelligence({
      assets: {
        total: 7,
        byKind: { image: 4, video: 1, audio: 2 },
        sourceReady: { image: 4, video: 1, audio: 2, zip: 0 },
      },
      generations: {
        total: 12,
        done: 8,
        active: 1,
        failed: 3,
        successRate: 8 / 11,
        recentFailures: [{
          modelId: "fal-ai/example",
          modelLabel: "Example",
          error: "fal result 422",
        }],
      },
      agents: {
        active: 1,
        waiting: 1,
        failed: 0,
        blockers: ["等待：組長確認旁白"],
      },
      tasks: {
        open: 2,
        urgent: 1,
        overdue: 1,
      },
    });

    expect(text).toContain("完結成功率 73%");
    expect(text).toContain("Example: fal result 422");
    expect(text).toContain("等待：組長確認旁白");
    expect(text).toContain("緊急 1／逾期 1");
  });
});
