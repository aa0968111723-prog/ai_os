import { describe, expect, it } from "vitest";
import { boundAssistantActionResults, formatRecentActionResults } from "./assistantActions";

const verification = { status: "verified" as const, message: "ok" };

describe("assistant action result references", () => {
  it("keeps only a bounded recent window and bounded ids", () => {
    const results = Array.from({ length: 7 }, (_, index) => ({
      type: "import" as const,
      source: "url" as const,
      resourceIds: Array.from({ length: 80 }, (__, id) => `r-${index}-${id}`),
      assetIds: Array.from({ length: 80 }, (__, id) => `a-${index}-${id}`),
      intelligenceIds: [],
      count: 80,
      duplicateCount: 0,
      needsReviewCount: 0,
      backgroundProcessing: true,
      verification,
    }));
    const bounded = boundAssistantActionResults(results);
    expect(bounded).toHaveLength(5);
    expect(bounded[0]?.type === "import" && bounded[0].resourceIds).toHaveLength(50);
  });

  it("formats pronoun references without embedding resource content", () => {
    const text = formatRecentActionResults([{
      type: "create_project", projectId: "project-1", title: "百日夢島", verification,
    }]);
    expect(text).toContain("剛建立的專案");
    expect(text).toContain("百日夢島");
  });

  it("never promotes an unverified write into recent-reference authority", () => {
    const bounded = boundAssistantActionResults([
      { type: "create_project", projectId: "bad", title: "未驗證", verification: { status: "unverified", message: "mismatch" } },
      { type: "create_project", projectId: "good", title: "已驗證", verification },
    ]);
    expect(bounded).toEqual([{ type: "create_project", projectId: "good", title: "已驗證", verification }]);
  });
});
