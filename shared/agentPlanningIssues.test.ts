import { describe, expect, it } from "vitest";
import {
  classifyMissingInformation,
  collectPlanningIssues,
  firstBlockingPlanningIssue,
  needsForcedClarification,
  planningIssueToQuestion,
} from "./agentPlanningIssues";

describe("needsForcedClarification", () => {
  it("is true only when at least one issue is blocking", () => {
    expect(needsForcedClarification([])).toBe(false);
    expect(needsForcedClarification([
      { code: "missing_required_field", userMessage: "風格偏好", blocking: false },
    ])).toBe(false);
    expect(needsForcedClarification([
      { code: "missing_required_field", userMessage: "缺場景", blocking: true },
    ])).toBe(true);
  });
});

describe("classifyMissingInformation", () => {
  it("maps each blocking class from free-text patterns", () => {
    expect(classifyMissingInformation("步驟開始時間缺少含時區的確切日期時間（收到「下週五」）").code)
      .toBe("ambiguous_date_time");
    expect(classifyMissingInformation("找不到團隊成員代號「member9」").code)
      .toBe("unresolved_reference");
    expect(classifyMissingInformation("有多個可能的場景候選，無法唯一決定").code)
      .toBe("ambiguous_reference");
    expect(classifyMissingInformation("需要重新登入 Adobe 權限").code)
      .toBe("permission_required");
    expect(classifyMissingInformation("刪除範圍不清楚，會覆寫既有分鏡").code)
      .toBe("destructive_scope_unclear");
    expect(classifyMissingInformation("此動作會扣點，需明確確認成本").code)
      .toBe("cost_confirmation_required");
    expect(classifyMissingInformation("不支援的步驟 kind").code)
      .toBe("unsupported_step_kind");
    expect(classifyMissingInformation("請提供腳本正文").code)
      .toBe("missing_required_field");
  });

  it("marks classified free-text issues as blocking", () => {
    expect(classifyMissingInformation("找不到素材代號「asset99」").blocking).toBe(true);
  });
});

describe("collectPlanningIssues", () => {
  it("merges explicit issues with missingInformation and de-dupes", () => {
    const issues = collectPlanningIssues({
      planningIssues: [{
        code: "unresolved_reference",
        userMessage: "找不到素材代號「asset99」",
        blocking: true,
        reference: "asset99",
      }],
      missingInformation: [
        "找不到素材代號「asset99」",
        "請提供腳本正文",
      ],
    });
    expect(issues).toHaveLength(2);
    expect(needsForcedClarification(issues)).toBe(true);
    expect(firstBlockingPlanningIssue(issues)?.code).toBe("unresolved_reference");
  });

  it("keeps pre-change plans with only missingInformation readable", () => {
    const issues = collectPlanningIssues({
      planningIssues: undefined,
      missingInformation: ["活動日期尚未提供"],
    });
    expect(issues[0]?.blocking).toBe(true);
  });
});

describe("planningIssueToQuestion", () => {
  it("builds a date question for ambiguous dates", () => {
    const q = planningIssueToQuestion({
      code: "ambiguous_date_time",
      userMessage: "『下週五』會影響排程結果",
      blocking: true,
    });
    expect(q.questionType).toBe("date");
    expect(q.context.phase).toBe("planning");
    expect(q.context.planningIssueCode).toBe("ambiguous_date_time");
    expect(q.allowCustom).toBe(true);
  });

  it("builds a picker from trusted candidates only", () => {
    const q = planningIssueToQuestion({
      code: "ambiguous_reference",
      userMessage: "找到兩個可能符合的場景",
      blocking: true,
      entityType: "scene",
      candidates: [
        { id: "scene-a", label: "SCENE 03・午後咖啡店" },
        { id: "scene-b", label: "SCENE 08・雨夜咖啡店" },
      ],
    }, { clarificationRound: 2 });
    expect(q.questionType).toBe("scene_picker");
    expect(q.options).toHaveLength(2);
    expect(q.context.clarificationRound).toBe(2);
    expect(q.context.facts?.some((f) => f.includes("重新規劃"))).toBe(true);
  });
});
