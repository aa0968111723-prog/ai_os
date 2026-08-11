import { describe, expect, it } from "vitest";
import {
  classifyStepFailureMessage,
  coerceAgentFailureReason,
  failureReasonFromLegacyString,
  projectFailureUserMessage,
} from "./agentFailure";

describe("legacy string failure compatibility", () => {
  it("wraps old reason strings as unknown without reverse-parsing security conclusions", () => {
    const reason = failureReasonFromLegacyString("步驟「出圖」失敗：供應商逾時");
    expect(reason.category).toBe("unknown");
    expect(reason.code).toBe("legacy_string_error");
    expect(projectFailureUserMessage(reason)).toContain("供應商逾時");
  });

  it("prefers structured reason when present", () => {
    const reason = coerceAgentFailureReason(
      {
        code: "quota_exhausted",
        category: "quota",
        userMessage: "點數不足",
        retryable: true,
        recommendedAction: "add_quota",
      },
      "some old string",
    );
    expect(reason.category).toBe("quota");
    expect(reason.recommendedAction).toBe("add_quota");
  });
});

describe("classifyStepFailureMessage", () => {
  it("classifies common observable failures", () => {
    expect(classifyStepFailureMessage("點數不足，無法預留").category).toBe("quota");
    expect(classifyStepFailureMessage("沒有權限修改此專案").category).toBe("permission");
    expect(classifyStepFailureMessage("找不到素材代號").category).toBe("reference");
  });
});
