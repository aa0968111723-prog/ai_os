import { describe, expect, it } from "vitest";
import {
  assistantGoalFrameSchema,
  canClaimRemoteSourceFact,
  continuationHint,
  goalRequiresVerifiedExecution,
} from "./assistantGoalFrame";

describe("assistantGoalFrame", () => {
  it("represents an ambiguous cloud count as a missing source instead of project assets", () => {
    const parsed = assistantGoalFrameSchema.parse({
      intent: "QUERY",
      operation: "COUNT",
      objectType: "ASSET",
      source: { type: "UNKNOWN_CLOUD" },
      desiredOutcome: "VERIFIED_COUNT",
      missingSlots: ["source"],
      understandingConfidence: "high",
      sourceConfidence: "low",
      entityConfidence: "medium",
      capabilityConfidence: "low",
    });
    expect(parsed.source?.type).toBe("UNKNOWN_CLOUD");
    expect(parsed.missingSlots).toContain("source");
  });

  it("never treats imported/project evidence as proof of a remote-source count", () => {
    expect(canClaimRemoteSourceFact("REMOTE_SOURCE")).toBe(true);
    expect(canClaimRemoteSourceFact("IMPORTED_PROVENANCE")).toBe(false);
    expect(canClaimRemoteSourceFact("PROJECT_ASSETS")).toBe(false);
    expect(canClaimRemoteSourceFact("AIOS_LIBRARY")).toBe(false);
  });

  it("marks write-like outcomes as requiring real verified execution", () => {
    expect(goalRequiresVerifiedExecution("PERSIST_ASSETS")).toBe(true);
    expect(goalRequiresVerifiedExecution("VERIFIED_BINDING")).toBe(true);
    expect(goalRequiresVerifiedExecution("START_CLASSIFICATION")).toBe(true);
    expect(goalRequiresVerifiedExecution("ANSWER")).toBe(false);
    expect(goalRequiresVerifiedExecution("VERIFIED_COUNT")).toBe(false);
  });

  it("recognizes concise continuation/correction answers without using them as execution authority", () => {
    expect(continuationHint("對")).toBe("CONFIRM");
    expect(continuationHint("不是 Drive，是 Photos")).toBe("CORRECT");
    expect(continuationHint("繼續")).toBe("CONTINUE");
    expect(continuationHint("第二個")).toBe("ANSWER_PENDING_QUESTION");
    expect(continuationHint("幫我建立一個新專案")).toBe("NEW_GOAL");
  });
});
