import { describe, expect, it } from "vitest";
import {
  ALLOWED_MEMORY_KINDS,
  MEMORY_NAMESPACES,
  MemoryBoundaryError,
  assertWithinMemoryBoundary,
} from "./cutosMemory";

/**
 * The memory boundary is the rule that stops AIOS becoming a second copy of
 * CUTOS. These tests are the enforcement, not the documentation: each one is a
 * concrete thing an over-eager agent would try to remember.
 */
describe("memory boundary", () => {
  const accept = (kind: string, value: unknown) =>
    expect(() => assertWithinMemoryBoundary(kind, value)).not.toThrow();
  const reject = (kind: string, value: unknown, code: string) => {
    try {
      assertWithinMemoryBoundary(kind, value);
      throw new Error("expected the boundary to reject this value");
    } catch (error) {
      expect(error).toBeInstanceOf(MemoryBoundaryError);
      expect((error as MemoryBoundaryError).code).toBe(code);
    }
  };

  describe("what AIOS may remember", () => {
    it("accepts an editing pace preference", () => {
      accept("editing_pace_preference", { pace: "fast", removeSilenceOver: 800 });
    });

    it("accepts a caption style", () => {
      accept("caption_style", { font: "Noto Sans TC", position: "bottom", maxCharsPerLine: 16 });
    });

    it("accepts a project goal", () => {
      accept("project_goal", { goal: "剪成八分鐘精華，再找三段短影音" });
    });

    it("accepts an accepted/rejected suggestion as a short verdict", () => {
      accept("accepted_suggestion", { highlightId: "highlight_2", acceptedAt: "2026-08-19" });
      accept("rejected_suggestion", { highlightId: "highlight_5", reasonCode: "off_topic" });
    });

    it("accepts a verified editing decision referring to CUTOS by id", () => {
      accept("verified_editing_decision", {
        cutosProjectId: "p1",
        planId: "plan_abc",
        timelineRevision: 7,
        outcome: "applied",
      });
    });

    it("accepts a small set of decided ranges as references", () => {
      accept("semantic_decision", {
        keptRanges: [{ startMs: 0, endMs: 8_000 }, { startMs: 30_000, endMs: 42_000 }],
      });
    });
  });

  describe("what belongs to CUTOS and must be refused", () => {
    it("refuses a kind that is not on the allow-list", () => {
      reject("full_transcript", { anything: 1 }, "FORBIDDEN_KIND");
      reject("timeline_snapshot", { anything: 1 }, "FORBIDDEN_KIND");
    });

    it("refuses a transcript, however it is labelled", () => {
      reject("semantic_decision", { transcript: "今天我們要談的是遠距工作" }, "FORBIDDEN_CONTENT");
      reject("semantic_decision", { transcript_sentences: [] }, "FORBIDDEN_CONTENT");
      reject("semantic_decision", { sentences: [] }, "FORBIDDEN_CONTENT");
    });

    it("refuses a timeline or an edit plan as a source of truth", () => {
      reject("verified_editing_decision", { timeline: { clips: [] } }, "FORBIDDEN_CONTENT");
      reject("verified_editing_decision", { editPlan: { operations: [] } }, "FORBIDDEN_CONTENT");
      reject("verified_editing_decision", { operations: [] }, "FORBIDDEN_CONTENT");
    });

    it("refuses the semantic index and raw media references", () => {
      reject("semantic_decision", { semanticIndex: {} }, "FORBIDDEN_CONTENT");
      reject("semantic_decision", { waveform: { peaks: [] } }, "FORBIDDEN_CONTENT");
      reject("semantic_decision", { storageKey: "sources/p1/original.mp4" }, "FORBIDDEN_CONTENT");
      reject("semantic_decision", { filePath: "/var/data/original.mp4" }, "FORBIDDEN_CONTENT");
    });

    it("refuses a long string — that is content, not a preference", () => {
      reject("project_goal", { goal: "字".repeat(600) }, "FORBIDDEN_CONTENT");
    });

    it("refuses an array long enough to be a transcript", () => {
      reject(
        "semantic_decision",
        { keptRanges: Array.from({ length: 40 }, (_, i) => ({ startMs: i, endMs: i + 1 })) },
        "FORBIDDEN_CONTENT",
      );
    });

    it("refuses an oversized payload outright", () => {
      reject("project_goal", { blob: "x".repeat(200).repeat(30) }, "PAYLOAD_TOO_LARGE");
    });

    it("refuses a payload that hides content behind deep nesting", () => {
      reject(
        "semantic_decision",
        { a: { b: { c: { d: { e: { f: "deep" } } } } } },
        "FORBIDDEN_CONTENT",
      );
    });

    it("catches a forbidden field nested inside an allowed one", () => {
      reject(
        "verified_editing_decision",
        { decision: { detail: { timeline: { clips: [] } } } },
        "FORBIDDEN_CONTENT",
      );
    });
  });
});

describe("memory namespaces", () => {
  it("scopes preferences to a user and memories to a CUTOS project", () => {
    expect(MEMORY_NAMESPACES.userPreferences("u1")).toBe("user/u1/video-preferences");
    expect(MEMORY_NAMESPACES.projectEditing("p1")).toBe("project/p1/editing-memory");
    expect(MEMORY_NAMESPACES.projectSemanticDecisions("p1")).toBe("project/p1/semantic-decisions");
    expect(MEMORY_NAMESPACES.runEphemeral("r1")).toBe("run/r1/ephemeral");
  });

  it("gives two projects disjoint namespaces", () => {
    expect(MEMORY_NAMESPACES.projectEditing("p1")).not.toBe(MEMORY_NAMESPACES.projectEditing("p2"));
  });

  it("keeps the allowed-kind list explicit rather than open-ended", () => {
    expect(ALLOWED_MEMORY_KINDS).toContain("editing_pace_preference");
    expect(ALLOWED_MEMORY_KINDS).not.toContain("transcript");
    expect(ALLOWED_MEMORY_KINDS.length).toBeLessThan(20);
  });
});
