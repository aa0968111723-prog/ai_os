import { describe, expect, it } from "vitest";
import { ASSISTANT_CAPABILITIES, canDirectlyExecuteCapability, classifyAssistantRequest } from "./assistantExecution";

describe("assistant execution fast path", () => {
  it.each([
    ["這個專案目前卡在哪裡？", "ASK"],
    ["社評", "ASK"],
    ["幫我建立一則會議筆記", "ACT"],
    ["請把這件事建立成任務", "ACT"],
    ["如何建立任務？", "ASK"],
    ["幫我規劃六鏡腳本", "PLAN"],
    ["持續監控失敗的生成並提醒我", "WATCH"],
  ] as const)("classifies %s as %s", (message, expected) => {
    expect(classifyAssistantRequest(message).intent).toBe(expected);
  });

  it("only directly runs allow-listed reversible writes for explicit ACT", () => {
    const act = classifyAssistantRequest("幫我建立一則筆記");
    expect(canDirectlyExecuteCapability(act, "add_note")).toBe(true);
    expect(canDirectlyExecuteCapability(act, "create_task")).toBe(true);
    expect(canDirectlyExecuteCapability(act, "add_schedule_item")).toBe(false);
    expect(canDirectlyExecuteCapability(act, "send_dm")).toBe(false);
    expect(canDirectlyExecuteCapability(act, "create_project")).toBe(false);

    const ask = classifyAssistantRequest("如何建立一則筆記？");
    expect(canDirectlyExecuteCapability(ask, "add_note")).toBe(false);
  });

  it("maps every required AIOS capability domain to real read/write policy", () => {
    const domains = new Set(ASSISTANT_CAPABILITIES.map((item) => item.domain));
    expect(domains).toEqual(new Set([
      "PROJECT", "TASK", "NOTE", "STORYBOARD", "SCRIPT", "ASSET",
      "DATABASE", "SCHEDULE", "MEMBER", "COLLABORATION", "GENERATION",
    ]));
    expect(ASSISTANT_CAPABILITIES.filter((item) => item.access === "WRITE").every((item) => item.risk !== "READ")).toBe(true);
  });
});
