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

  it("does not treat a custom database as project assets", () => {
    const { frame } = deriveDeterministicGoalFrame("db1 自訂資料表有幾列？");
    expect(frame.source?.type).toBe("CUSTOM_DATABASE");
    expect(frame.source?.type).not.toBe("PROJECT_ASSETS");
    expect(frame.operation).toBe("COUNT");
  });

  it("does not treat project assets as Google Photos", () => {
    const { frame } = deriveDeterministicGoalFrame("這個專案素材有幾張？");
    expect(frame.source?.type).toBe("PROJECT_ASSETS");
    expect(frame.source?.type).not.toBe("GOOGLE_PHOTOS");
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

  it("treats '查看剛匯入的資料' as a recent-result read, not a new source import", () => {
    const { frame } = deriveDeterministicGoalFrame("查看剛匯入的資料");
    expect(frame).toMatchObject({ operation: "READ", objectType: "ASSET", missingSlots: [] });
    expect(frame.referents).toContain("recent_results");
    expect(matchAssistantCapabilityForGoal(frame)).toMatchObject({ status: "matched", capabilityId: "read_assets" });
  });

  it("#662: '哪一個最久沒更新' is FIND project, not UPDATE write", () => {
    for (const message of ["哪一個最久沒更新？", "哪個最久沒更新", "哪一個最舊"]) {
      const { frame } = deriveDeterministicGoalFrame(message);
      expect(frame.operation).toBe("FIND");
      expect(frame.objectType).toBe("PROJECT");
      expect(frame.desiredOutcome).toBe("VERIFIED_LIST");
      expect(matchAssistantCapabilityForGoal(frame).capabilityId).toBe("read_context");
    }
  });

  it("Q16: '最近匯入了哪些素材？' is provenance read, not SOURCE_PICKER import", () => {
    for (const message of ["最近匯入了哪些素材？", "最近加入了哪些素材", "匯入了哪些素材"]) {
      const { frame } = deriveDeterministicGoalFrame(message);
      expect(frame.operation).toBe("READ");
      expect(frame.objectType).toBe("ASSET");
      expect(frame.missingSlots).not.toContain("source");
      expect(matchAssistantCapabilityForGoal(frame).capabilityId).toBe("read_assets");
    }
  });

  it("Q13: schedule utterance maps to add_schedule_item with verified write outcome", () => {
    const { frame } = deriveDeterministicGoalFrame("幫我安排明天下午三點的會議");
    expect(frame.operation).toBe("CREATE");
    expect(frame.objectType).toBe("SCHEDULE");
    expect(frame.desiredOutcome).toBe("PERSIST_SCHEDULE");
    expect(matchAssistantCapabilityForGoal(frame).capabilityId).toBe("add_schedule_item");
  });

  it("parses free_only and max_points constraints from natural language", () => {
    const a = deriveDeterministicGoalFrame("不要超過 100 點，用最好的可用模型完成");
    expect(a.frame.constraints.some((c) => c.startsWith("max_points:100"))).toBe(true);
    expect(a.frame.source).toBeUndefined();

    const b = deriveDeterministicGoalFrame("只用免費模型，不要付費 fallback");
    expect(b.frame.constraints).toContain("free_only");
  });

  it("delivery language on a project becomes dispatch_agent, not create_project", () => {
    const { frame } = deriveDeterministicGoalFrame("把這個專案做到今天可以交");
    expect(frame.operation).toBe("CREATE");
    expect(frame.objectType).toBe("PROJECT");
    expect(frame.constraints.some((c) => c.startsWith("delivery:"))).toBe(true);
    expect(matchAssistantCapabilityForGoal(frame).capabilityId).toBe("dispatch_agent");
  });

  it("recent N assets attach keeps recent_results + limit referent", () => {
    const { frame } = deriveDeterministicGoalFrame("把最近五張圖放第三鏡");
    expect(frame.operation).toBe("ATTACH");
    expect(frame.objectType).toBe("SHOT");
    expect(frame.referents).toContain("recent_results");
    expect(frame.referents).toContain("recent_limit:5");
  });

  it("fresh-eye: 丟幾張圖到第三鏡 is ATTACH not bare IMPORT", () => {
    const { frame } = deriveDeterministicGoalFrame("丟幾張圖到第三鏡");
    expect(frame.operation).toBe("ATTACH");
    expect(frame.objectType).toBe("SHOT");
    expect(matchAssistantCapabilityForGoal(frame).capabilityId).toBe("attach_asset_to_shot");
  });

  it("fresh-eye: 預算上限 50 點 parses max_points", () => {
    const { frame } = deriveDeterministicGoalFrame("預算上限 50 點");
    expect(frame.constraints).toContain("max_points:50");
  });

  it("resolves '剛建立的專案' from the latest verified CreateProjectResult instead of a stale active goal", () => {
    const result = resolveWorkingProject({
      message: "把這個 URL 加入剛建立的專案：https://example.com/a.pdf",
      candidates: [{ id: P1, title: "舊專案" }, { id: P2, title: "新專案" }],
      activeGoal: active({ frame: { ...active().frame, scope: { projectId: P1 } } }),
      recentActionResults: [{
        type: "create_project",
        projectId: P2,
        title: "新專案",
        verification: { status: "verified", message: "read back" },
      }],
      continuation: "NEW_GOAL",
    });
    expect(result).toMatchObject({ status: "resolved", projectId: P2, source: "recent_result" });
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

  it("GF2-style chain: Drive import → organize → attach shot 3", () => {
    const importFrame = deriveDeterministicGoalFrame("從 Drive 加五張圖到北藝回顧").frame;
    expect(importFrame.source?.type).toBe("GOOGLE_DRIVE");
    expect(importFrame.operation).toBe("IMPORT");

    const organize = deriveDeterministicGoalFrame("整理一下", active({
      frame: { ...importFrame, scope: { projectId: P2 } },
      status: "completed",
      resultRefIds: ["a1", "a2", "a3"],
    }));
    expect(organize.continuation).toBe("CONTINUE");
    expect(matchAssistantCapabilityForGoal(organize.frame).capabilityId).toBe("classify_asset");

    const attach = deriveDeterministicGoalFrame("放第三鏡", active({
      frame: organize.frame,
      status: "completed",
      resultRefIds: ["a1", "a2", "a3"],
    }));
    expect(attach.frame.operation).toBe("ATTACH");
    expect(attach.frame.objectType).toBe("SHOT");
  });

  it("budget constraint language is preserved as a constraint, not a free-text side note", () => {
    const { frame } = deriveDeterministicGoalFrame("不要超過 100 點，用品質最好的可用模型完成");
    expect(frame.source).toBeUndefined();
    expect(frame.missingSlots).not.toContain("source");
    expect(frame.constraints).toContain("max_points:100");
  });

  it("fresh-eye paraphrases still resolve Drive import and shot attachment", () => {
    const a = deriveDeterministicGoalFrame("幫我從雲端硬碟丟幾張圖進專案");
    expect(a.frame.source?.type).toBe("GOOGLE_DRIVE");
    expect(a.frame.operation).toBe("IMPORT");

    const b = deriveDeterministicGoalFrame("掛到第三鏡", active({
      status: "completed",
      resultRefIds: ["x1"],
    }));
    expect(b.continuation).toBe("CONTINUE");
    expect(b.frame.operation).toBe("ATTACH");
  });

  it("先不要 aborts instead of completing the previous write", () => {
    const previous = active();
    const { frame, continuation } = deriveDeterministicGoalFrame("先不要", previous);
    expect(continuation).toBe("NEW_GOAL");
    expect(frame.constraints).toContain("abort_pending");
    expect(frame.desiredOutcome).toBe("ANSWER");
    expect(frame.operation).not.toBe("IMPORT");
  });

  it("runtime-blocked generate_media is unsupported instead of a fake completion", () => {
    const { frame } = deriveDeterministicGoalFrame("幫我生成一張圖");
    const match = matchAssistantCapabilityForGoal(frame, { blockedCapabilityIds: ["generate_media"] });
    if (match.capabilityId === "generate_media") {
      expect(match.status).toBe("unsupported");
    }
  });

  it.each([
    ["列出我的專案", "LIST", "PROJECT"],
    ["幫我列出專案", "LIST", "PROJECT"],
    ["可以幫我建立任務嗎？", "CREATE", "TASK"],
    ["有幾個專案？", "COUNT", "PROJECT"],
    ["安排明天下午三點", "CREATE", "SCHEDULE"],
    ["最近匯入什麼", "READ", "ASSET"],
    ["把那些放第三鏡", "ATTACH", "SHOT"],
    ["list projects", "LIST", "PROJECT"],
    ["幫我 list 所有專案", "LIST", "PROJECT"],
  ] as const)("fuzz %s", (utterance, operation, objectType) => {
    const { frame } = deriveDeterministicGoalFrame(utterance);
    expect(frame.operation).toBe(operation);
    expect(frame.objectType).toBe(objectType);
  });

  it("negation and correction do not invent a completed import", () => {
    const previous = active();
    const corrected = deriveDeterministicGoalFrame("不是 Drive，是 Photos", previous);
    expect(corrected.continuation).toBe("CORRECT");
    expect(corrected.frame.source?.type).toBe("GOOGLE_PHOTOS");
    const match = matchAssistantCapabilityForGoal(corrected.frame);
    expect(match.status).toBe("unsupported");
    expect(match.evidenceScope).toBe("REMOTE_SOURCE");
  });

  it("typo-tolerant short confirm stays on the same goal", () => {
    const previous = active({ status: "waiting_confirmation" });
    const confirmed = deriveDeterministicGoalFrame("對", previous);
    expect(confirmed.continuation).toBe("CONFIRM");
    expect(confirmed.frame.continuationOfGoalId).toBe(previous.goalId);
  });
});
