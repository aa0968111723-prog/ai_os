import { describe, expect, it } from "vitest";
import { cosineSimilarity, featureHashEmbedding, lexicalOverlap } from "./intelligenceCore";

describe("Intelligence Library semantic search", () => {
  it("ranks a semantically matching Chinese asset above unrelated material", () => {
    const query = featureHashEmbedding("安倢雨天照片");
    const relevant = cosineSimilarity(query, featureHashEmbedding("安倢在淡水雨中撐傘的人物照片"));
    const unrelated = cosineSimilarity(query, featureHashEmbedding("季度預算與設備採購 Excel"));
    expect(relevant).toBeGreaterThan(unrelated);
    expect(lexicalOverlap("安倢雨天照片", "安倢在雨天的照片")).toBeGreaterThan(0.4);
  });

  it("produces stable versionable vectors", () => {
    expect(featureHashEmbedding("克難坡相關素材")).toEqual(featureHashEmbedding("克難坡相關素材"));
    expect(featureHashEmbedding("x")).toHaveLength(96);
  });
});
