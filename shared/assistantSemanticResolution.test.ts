import { describe, expect, it } from "vitest";
import type { AssistantActiveGoal } from "./assistantGoalFrame";
import {
  deriveDeterministicGoalFrame,
  executionPlanFromGoal,
  matchAssistantCapabilityForGoal,
  resolveWorkingProject,
} from "./assistantSemanticResolution";

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";

function active(over: Partial<AssistantActiveGoal> = {}): AssistantActiveGoal {
  return {
    goalId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    status: "waiting_user_input",
    frame: {
      intent: "IMPORT",
      operation: "IMPORT",
      objectType: "ASSET",
      source: { type: "GOOGLE_DRIVE" },
      scope: { projectId: P1 },
      referents: [],
      constraints: [],
      desiredOutcome: "PERSIST_ASSETS",
      missingSlots: [],
      understandingConfidence: "high",
      sourceConfidence: "high",
      entityConfidence: "high",
      capabilityConfidence: "high",
    },
    resolvedSlots: {},
    missingSlots: [],
    resultRefIds: [],
    ...over,
  };
}

describe("assistantSemanticResolution", () => {
  it("understands Drive import and maps to the shared registry", () => {
    const { frame } = deriveDeterministicGoalFrame("從 Google Drive 選資料加入目前專案");
    expect(frame.intent).toBe("IMPORT");
    expect(frame.operation).toBe("IMPORT");
    expect(frame.source?.type).toBe("GOOGLE_DRIVE");
    const withProject = { ...frame, scope: { projectId: P1 } };
    const match = matchAssistantCapabilityForGoal(withProject);
    expect(match.status).toBe("matched");
    expect(match.capabilityId).toBe("import_google_drive");
  });

  it("does not silently turn ambiguous cloud into project assets", () => {
    const { frame } = deriveDeterministicGoalFrame("雲端內有多少素材？");
    expect(frame.operation).toBe("COUNT");
    expect(frame.source?.type).toBe("UNKNOWN_CLOUD");
    expect(frame.missingSlots).toContain("source");
    expect(matchAssistantCapabilityForGoal(frame).status).toBe("missing_context");
  });

  it("fails closed for a Google Photos remote count", () => {
    const { frame } = deriveDeterministicGoalFrame("這個 Google Photos 裡有多少素材？");
    const match = matchAssistantCapabilityForGoal(frame);
    expect(match.status).toBe("unsupported");
    expect(match.evidenceScope).toBe("REMOTE_SOURCE");
    expect(match.reason).toMatch(/Google Photos/);
  });

  it("correction keeps the same goal and changes source instead of starting over", () => {
    const previous = active();
    const { frame, continuation } = deriveDeterministicGoalFrame("不是 Drive，是 Photos", previous);
    expect(continuation).toBe("CORRECT");
    expect(frame.continuationOfGoalId).toBe(previous.goalId);
    expect(frame.source?.type).toBe("GOOGLE_PHOTOS");
  });

  it("maps recent-result organization to classify_asset", () => {
    const { frame } = deriveDeterministicGoalFrame("把這些整理一下");
    expect(frame.referents).toContain("recent_results");
    const match = matchAssistantCapabilityForGoal(frame);
    expect(match.capabilityId).toBe("classify_asset");
    expect(match.status).toBe("matched");
  });

  it("maps recent assets to Shot 3 attachment", () => {
    const { frame } = deriveDeterministicGoalFrame("把這些放到 Shot 3");
    expect(frame.operation).toBe("ATTACH");
    expect(frame.objectType).toBe("SHOT");
    const match = matchAssistantCapabilityForGoal({ ...frame, scope: { projectId: P1, shotId: "33333333-3333-4333-8333-333333333333" } });
    expect(match.capabilityId).toBe("attach_asset_to_shot");
    expect(match.status).toBe("matched");
  });

  it("explicit project mention outranks the current page project", () => {
    const result = resolveWorkingProject({
      message: "把資料加到北藝回顧",
      candidates: [{ id: P1, title: "目前頁面專案" }, { id: P2, title: "北藝回顧" }],
      pageProjectId: P1,
    });
    expect(result.status).toBe("resolved");
    expect(result.projectId).toBe(P2);
    expect(result.source).toBe("explicit");
  });

  it("answers 第二個 against trusted pending project candidates", () => {
    const previous = active({
      frame: { ...active().frame, scope: {} },
      resolvedSlots: { projectCandidates: [{ id: P1, title: "A" }, { id: P2, title: "B" }] },
    });
    const result = resolveWorkingProject({
      message: "第二個",
      candidates: [{ id: P1, title: "A" }, { id: P2, title: "B" }],
      activeGoal: previous,
    });
    expect(result.projectId).toBe(P2);
    expect(result.source).toBe("pending_choice");
  });

  it("semantic plan is sourced from the matched capability rather than keyword intent", () => {
    const { frame } = deriveDeterministicGoalFrame("從 Google Drive 選資料加入目前專案");
    const resolved = { ...frame, scope: { projectId: P1 } };
    const match = matchAssistantCapabilityForGoal(resolved);
    const plan = executionPlanFromGoal(resolved, match, "加入 Drive 資料");
    expect(plan.capabilityId).toBe("import_google_drive");
    expect(plan.executionMode).toBe("DIRECT_TOOL");
    expect(plan.intent).toBe("DIRECT");
  });
});
