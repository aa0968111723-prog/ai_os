import { describe, expect, it } from "vitest";
import {
  assistantGoalFrameSchema,
  canClaimRemoteSourceFact,
  continuationHint,
  expireStaleActiveGoal,
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
    expect(continuationHint("整理一下")).toBe("CONTINUE");
    expect(continuationHint("放第三鏡")).toBe("CONTINUE");
    expect(continuationHint("幫我建立一個新專案")).toBe("NEW_GOAL");
    expect(continuationHint("不是這個")).toBe("CORRECT");
  });

  it("clears a timed-out pending interaction so the conversation can continue", () => {
    const goal = expireStaleActiveGoal({
      goalId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      status: "waiting_user_input",
      frame: {
        intent: "IMPORT",
        operation: "IMPORT",
        objectType: "ASSET",
        source: { type: "UNKNOWN_CLOUD" },
        scope: {},
        referents: [],
        constraints: [],
        desiredOutcome: "PERSIST_ASSETS",
        missingSlots: ["source"],
        understandingConfidence: "high",
        sourceConfidence: "low",
        entityConfidence: "medium",
        capabilityConfidence: "low",
      },
      resolvedSlots: {},
      missingSlots: ["source"],
      pendingInteraction: {
        interactionId: "11111111-1111-4111-8111-111111111111",
        runId: "run-1",
        goalId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        type: "SOURCE_PICKER",
        title: "你要使用哪個來源？",
        required: true,
        resumeToken: "33333333-3333-4333-8333-333333333333",
        expiresAt: "2026-08-12T00:05:00.000Z",
        expectedResultType: "selection",
        status: "pending",
        createdAt: "2026-08-12T00:00:00.000Z",
      },
      resultRefIds: [],
    }, Date.parse("2026-08-12T00:05:01.000Z"));
    expect(goal?.status).toBe("ready");
    expect(goal?.pendingInteraction?.status).toBe("expired");
  });
});
