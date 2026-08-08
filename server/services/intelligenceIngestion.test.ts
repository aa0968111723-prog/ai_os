import { describe, expect, it } from "vitest";
import { completedAnalysisStatus, INGESTION_STAGES, nextIngestionStage } from "./intelligenceLibrary";
import { chunkText, contentHash } from "./intelligenceCore";

describe("Intelligence Library ingestion pipeline", () => {
  it("uses one ordered abstraction for every source", () => {
    expect(INGESTION_STAGES).toEqual([
      "extract_metadata", "ocr", "transcription", "image_analysis", "video_analysis", "audio_analysis",
      "classification", "face_detection", "face_embedding", "face_clustering", "embedding", "dedupe", "relationship_detection",
    ]);
    expect(nextIngestionStage("extract_metadata")).toBe("ocr");
    expect(nextIngestionStage("audio_analysis")).toBe("classification");
    expect(nextIngestionStage("classification")).toBe("face_detection");
    expect(nextIngestionStage("face_clustering")).toBe("embedding");
    expect(nextIngestionStage("relationship_detection")).toBeNull();
  });

  it("chunks long documents deterministically for re-embedding", () => {
    const text = Array.from({ length: 30 }, (_, i) => `Scene ${i + 1}。安倢在淡水雨中撐傘。`).join("\n");
    const chunks = chunkText(text, 180, 20);
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.map(contentHash)).toEqual(chunkText(text, 180, 20).map(contentHash));
  });

  it("keeps uncertain analysis in the human review queue after the final stage", () => {
    expect(completedAnalysisStatus("needs_review", 0)).toBe("needs_review");
    expect(completedAnalysisStatus("processing", 0)).toBe("ready");
    expect(completedAnalysisStatus("needs_review", 1)).toBe("partial");
  });
});
