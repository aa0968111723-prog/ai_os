import { describe, expect, it } from "vitest";
import {
  canStopAgentRunStatus,
  canonicalizeAgentQuestionAnswer,
  isAgentRunActiveForHud,
  isLeftoverUnstartedHudRun,
  resolveAgentQuestionOption,
  resolveOrAskAgentQuestion,
  type AgentQuestionDefinition,
} from "./agentQuestions";

const options = [
  { id: "project-a", label: "百日夢嶼", description: "18 鏡" },
  { id: "project-b", label: "挑戰營回顧", description: "12 鏡" },
  { id: "project-c", label: "北藝回顧影片", description: "24 鏡" },
];

const projectQuestion: AgentQuestionDefinition = {
  questionType: "entity_picker",
  title: "選擇專案",
  description: "請選擇這次要處理哪一個專案。",
  required: true,
  options,
  allowCustom: false,
  context: { reason: "找到多個候選專案，缺少 projectId。", slot: "projectId", entityType: "project" },
};

describe("agent question option resolution", () => {
  it("maps ids, real labels and natural-language ordinals to a frozen option id", () => {
    expect(resolveAgentQuestionOption("project-b", options).optionId).toBe("project-b");
    expect(resolveAgentQuestionOption("北藝那個", options).optionId).toBe("project-c");
    expect(resolveAgentQuestionOption("第二個", options).optionId).toBe("project-b");
  });

  it("does not accept an entity id invented by the client", () => {
    expect(() => canonicalizeAgentQuestionAnswer(projectQuestion, "made-up-project"))
      .toThrow("不存在或已失效");
  });

  it("asks again when a natural-language answer is ambiguous", () => {
    const duplicated = [
      { id: "a", label: "回顧影片 A" },
      { id: "b", label: "回顧影片 B" },
    ];
    expect(resolveAgentQuestionOption("回顧影片", duplicated)).toEqual({ ambiguous: true });
  });
});

describe("resolution rules", () => {
  it("uses explicit context without asking", () => {
    expect(resolveOrAskAgentQuestion({
      currentValue: "project-b",
      candidates: options,
      question: projectQuestion,
    })).toEqual({ kind: "resolved", value: "project-b", source: "context" });
  });

  it("auto-resolves exactly one trusted candidate", () => {
    expect(resolveOrAskAgentQuestion({
      candidates: [options[0]],
      question: projectQuestion,
    })).toEqual({ kind: "resolved", value: "project-a", source: "only_candidate" });
  });

  it("asks when there are multiple choices or a high-risk confirmation", () => {
    expect(resolveOrAskAgentQuestion({ candidates: options, question: projectQuestion }).kind).toBe("question");
    expect(resolveOrAskAgentQuestion({
      candidates: [options[0]],
      question: { ...projectQuestion, questionType: "confirm", context: { reason: "即將正式發布", highRisk: true } },
      highRisk: true,
    }).kind).toBe("question");
  });
});

describe("answer validation", () => {
  it("requires an explicit boolean for confirmations", () => {
    const confirm: AgentQuestionDefinition = {
      questionType: "confirm",
      title: "確認發布",
      description: "即將公開發布影片。",
      required: true,
      options: [],
      allowCustom: false,
      context: { reason: "正式發布是高風險外部操作。", highRisk: true },
    };
    expect(canonicalizeAgentQuestionAnswer(confirm, true).value).toBe(true);
    expect(() => canonicalizeAgentQuestionAnswer(confirm, "好")).toThrow("明確選擇");
  });

  it("deduplicates validated multi-select ids", () => {
    const multi: AgentQuestionDefinition = { ...projectQuestion, questionType: "multi_select" };
    expect(canonicalizeAgentQuestionAnswer(multi, ["project-a", "第一個", "project-b"]).value)
      .toEqual(["project-a", "project-b"]);
  });

  it("file questions accept only durable asset ids, never file bytes or names", () => {
    const file: AgentQuestionDefinition = {
      questionType: "file", title: "選擇檔案", description: "請帶入素材", required: true,
      options: [], allowCustom: false, context: { reason: "執行需要素材", slot: "assetIds", entityType: "asset" },
    };
    const id = "123e4567-e89b-42d3-a456-426614174000";
    expect(canonicalizeAgentQuestionAnswer(file, [id, id]).value).toEqual([id]);
    expect(() => canonicalizeAgentQuestionAnswer(file, ["movie.mp4"])).toThrow("尚未安全保存");
  });
});

describe("HUD 停 persists leftover awaiting_approval", () => {
  it("can stop every HUD-active status, including leftover 0/N 待你過目", () => {
    expect(canStopAgentRunStatus("awaiting_approval")).toBe(true);
    expect(isAgentRunActiveForHud("awaiting_approval")).toBe(true);
    expect(canStopAgentRunStatus("running")).toBe(true);
    expect(canStopAgentRunStatus("waiting")).toBe(true);
    expect(canStopAgentRunStatus("stopped")).toBe(false);
    expect(canStopAgentRunStatus("discarded")).toBe(false);
    expect(canStopAgentRunStatus("done")).toBe(false);
  });

  it("treats 0/6 第 N 鏡生成畫面 as leftover even if status drifted", () => {
    expect(isLeftoverUnstartedHudRun({
      status: "awaiting_approval",
      doneSteps: 0,
      totalSteps: 6,
      currentStepNote: "第 1 鏡「小華躺在床上」生成畫面",
    })).toBe(true);
    expect(isLeftoverUnstartedHudRun({
      status: "waiting",
      doneSteps: 0,
      totalSteps: 6,
      currentStepNote: "第 1 鏡「小華躺在床上」生成畫面",
    })).toBe(true);
    expect(isLeftoverUnstartedHudRun({
      status: "running",
      doneSteps: 2,
      totalSteps: 6,
      currentStepNote: "為第 3 鏡生成畫面",
    })).toBe(false);
  });
});
