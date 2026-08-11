import { describe, expect, it } from "vitest";
import { applyAgentQuestionAnswerToRun, assertAgentQuestionAnswerOwner } from "./agentQuestionCore";

describe("answer question ACL", () => {
  it("allows only the user who owns both the run and the pending question", () => {
    expect(() => assertAgentQuestionAnswerOwner({ authUserId: "u1", runUserId: "u1", questionUserId: "u1" })).not.toThrow();
    expect(() => assertAgentQuestionAnswerOwner({ authUserId: "u2", runUserId: "u1", questionUserId: "u1" })).toThrow("不屬於");
    expect(() => assertAgentQuestionAnswerOwner({ authUserId: "u1", runUserId: "u1", questionUserId: "u2" })).toThrow("不屬於");
  });
});

describe("applyAgentQuestionAnswerToRun", () => {
  it("fills the context slot and resumes the same suspended step", () => {
    const result = applyAgentQuestionAnswerToRun({
      run: {
        currentStep: 0,
        contextSlots: { projectId: "project-a" },
        steps: [{
          id: "make-shot",
          kind: "update_scene",
          note: "更新指定分鏡",
          status: "waiting",
          requiredSlots: ["sceneId"],
        }],
      },
      question: {
        stepId: "make-shot",
        questionType: "scene_picker",
        context: { reason: "找到多個分鏡。", slot: "sceneId", entityType: "scene" },
      },
      canonicalAnswer: {
        value: "scene-b",
        selectedOptionIds: ["scene-b"],
        displayValue: "第二鏡",
      },
    });
    expect(result.status).toBe("running");
    expect(result.phase).toBe("execution");
    expect(result.contextSlots).toEqual({ projectId: "project-a", sceneId: "scene-b" });
    expect(result.steps[0]).toMatchObject({ status: "pending", targetSceneId: "scene-b" });
  });

  it("planning-phase answers never resume running — they stash clarifications for replan", () => {
    const result = applyAgentQuestionAnswerToRun({
      run: {
        currentStep: 0,
        contextSlots: { planningClarificationRound: 0 },
        steps: [{ id: "s1", kind: "create_note", note: "草稿", status: "pending" }],
      },
      question: {
        stepId: null,
        questionType: "date",
        context: {
          reason: "日期無法唯一決定",
          phase: "planning",
          planningIssueCode: "ambiguous_date_time",
        },
      },
      canonicalAnswer: {
        value: "2026-08-15",
        selectedOptionIds: [],
        displayValue: "2026-08-15",
      },
    });
    expect(result.phase).toBe("planning");
    expect(result.status).toBe("awaiting_approval");
    expect(result.contextSlots.planningClarificationRound).toBe(1);
    expect(result.contextSlots.planningClarifications).toContain("2026-08-15");
    expect(result.steps[0]?.status).toBe("pending");
  });

  it("binds a shot picker answer to the current executable scene target", () => {
    const result = applyAgentQuestionAnswerToRun({
      run: {
        currentStep: 0,
        contextSlots: { projectId: "project-a" },
        steps: [{ id: "shot", kind: "generate", note: "生成指定鏡頭", status: "waiting", requiredSlots: ["shotId"] }],
      },
      question: {
        stepId: "shot",
        questionType: "shot_picker",
        context: { reason: "找到多個鏡頭。", slot: "shotId", entityType: "shot" },
      },
      canonicalAnswer: { value: "shot-b", selectedOptionIds: ["shot-b"], displayValue: "第二鏡" },
    });
    expect(result.contextSlots.shotId).toBe("shot-b");
    expect(result.steps[0]).toMatchObject({ status: "pending", targetSceneId: "shot-b" });
  });

  it("separates a rejected high-risk confirmation from clarification and stops pending work", () => {
    const result = applyAgentQuestionAnswerToRun({
      run: {
        currentStep: 0,
        contextSlots: {},
        steps: [
          { id: "publish", kind: "request_approval", note: "正式發布", status: "waiting" },
          { id: "notify", kind: "create_note", note: "發布後通知", status: "pending", dependsOn: ["publish"] },
        ],
      },
      question: {
        stepId: "publish",
        questionType: "confirm",
        context: { reason: "正式發布是高風險外部操作。", highRisk: true },
      },
      canonicalAnswer: { value: false, selectedOptionIds: [], displayValue: "取消" },
    });
    expect(result.status).toBe("stopped");
    expect(result.steps.map((step) => step.status)).toEqual(["stopped", "stopped"]);
  });
});
