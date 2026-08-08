import { describe, expect, it } from "vitest";
import {
  applyCategoryFeedback,
  clusterFaceObservations,
  extractEntityCandidates,
  normalizeEntityName,
  parseLibraryQuery,
  semanticDuplicateThreshold,
} from "./intelligenceAdvanced";

describe("Intelligence Library advanced understanding", () => {
  it("clusters anonymous faces without assigning real-world identity", () => {
    const clusters = clusterFaceObservations([
      { intelligenceId: "a", faceIndex: 0, embedding: [1, 0, 0] },
      { intelligenceId: "b", faceIndex: 0, embedding: [0.99, 0.05, 0] },
      { intelligenceId: "c", faceIndex: 0, embedding: [0, 1, 0] },
    ], 0.9);
    expect(clusters.map((cluster) => cluster.members.length)).toEqual([2, 1]);
    expect(clusters[0]?.confidence).toBeGreaterThan(0.99);
    expect(clusters[0]).not.toHaveProperty("personName");
  });

  it("parses negative entity constraints and review-oriented intents", () => {
    expect(parseLibraryQuery("有安倢但沒有敏豐的照片")).toMatchObject({
      excludedTerms: ["敏豐的照片"],
      intent: "general",
    });
    expect(parseLibraryQuery("還沒有被分類的素材").intent).toBe("unclassified");
    expect(parseLibraryQuery("沒有用在任何專案的影片").intent).toBe("unused");
  });

  it("extracts conservative non-person entities", () => {
    const entities = extractEntityCandidates("安倢在淡水雨中撐傘，時間是傍晚。主題：和平");
    expect(entities).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "WEATHER", name: "Rain" }),
      expect.objectContaining({ type: "TIME", name: "Evening" }),
      expect.objectContaining({ type: "TOPIC", name: "和平" }),
    ]));
    expect(entities.some((entity) => entity.type === ("PERSON" as never))).toBe(false);
    expect(normalizeEntityName("  淡 水  ")).toBe("淡 水");
  });

  it("keeps near-duplicate thresholds configurable and bounded", () => {
    expect(semanticDuplicateThreshold({ INTELLIGENCE_NEAR_DUPLICATE_SIMILARITY: "0.97" } as NodeJS.ProcessEnv)).toBe(0.97);
    expect(semanticDuplicateThreshold({ INTELLIGENCE_NEAR_DUPLICATE_SIMILARITY: "2" } as NodeJS.ProcessEnv)).toBeLessThan(1);
  });

  it("applies repeated team corrections without model fine-tuning", () => {
    const result = applyCategoryFeedback(
      { category: "Document", categoryConfidence: 0.76, rationale: "base" },
      [1, 2].map(() => ({
        action: "change", prediction: { category: "Document" }, correction: { category: "Script" },
      })),
    );
    expect(result.category).toBe("Script");
    expect(result.categoryConfidence).toBeGreaterThanOrEqual(0.96);
  });
});
