import { describe, expect, it, vi } from "vitest";
import { rankHybridItems } from "./hybridRetrieval";

describe("progressive hybrid retrieval", () => {
  const items = [
    { title: "場景光線", content: "清晨逆光" },
    { title: "角色服裝", content: "米白外套與紅色雨傘" },
  ];

  it("ranks keyword and metadata without vector infrastructure", async () => {
    const result = await rankHybridItems(items, "角色米白外套");
    expect(result.items[0]?.title).toBe("角色服裝");
    expect(result.semanticApplied).toBe(false);
  });

  it("adds semantic scores through an optional adapter", async () => {
    const score = vi.fn().mockResolvedValue([1, 0]);
    const result = await rankHybridItems(items, "visual mood", { name: "test", score });
    expect(result.items[0]?.title).toBe("場景光線");
    expect(result.semanticApplied).toBe(true);
  });
});
