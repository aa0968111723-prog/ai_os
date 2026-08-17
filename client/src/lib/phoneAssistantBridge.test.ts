import { beforeEach, describe, expect, it } from "vitest";
import type { AssistantActionResult } from "@shared/assistantActions";
import {
  clearPhoneAssistantTurn,
  getPhoneAssistantTurn,
  publishPhoneAssistantTurn,
  resetPhoneAssistantBridgeForTest,
} from "./phoneAssistantBridge";

const verified: AssistantActionResult = {
  type: "create_task",
  taskIds: ["0f8fad5b-d9cb-469f-a165-70867728950e"],
  count: 1,
  projectId: "1f8fad5b-d9cb-469f-a165-70867728950e",
  verification: { status: "verified", message: "已讀回 1 件任務" },
};

const unverified: AssistantActionResult = {
  ...verified,
  taskIds: ["2f8fad5b-d9cb-469f-a165-70867728950e"],
  verification: { status: "unverified", message: "讀回失敗" },
};

beforeEach(() => resetPhoneAssistantBridgeForTest());

describe("phoneAssistantBridge", () => {
  it("未驗證的收據進不了投影——手機卡片會把它讀成「已完成」", () => {
    publishPhoneAssistantTurn({
      scope: "group", scopeId: "g1", running: false, updatedAt: 1,
      results: [verified, unverified],
    });
    expect(getPhoneAssistantTurn("group", "g1")?.results).toEqual([verified]);
  });

  it("每個 scope 只留最後一輪：這是看板，不是對話歷史", () => {
    publishPhoneAssistantTurn({ scope: "group", scopeId: "g1", answer: "第一輪", running: false, updatedAt: 1 });
    publishPhoneAssistantTurn({ scope: "group", scopeId: "g1", answer: "第二輪", running: false, updatedAt: 2 });
    expect(getPhoneAssistantTurn("group", "g1")?.answer).toBe("第二輪");
  });

  it("組與專案是兩個獨立的 scope，不會互相蓋掉", () => {
    publishPhoneAssistantTurn({ scope: "group", scopeId: "g1", answer: "組級", running: false, updatedAt: 1 });
    publishPhoneAssistantTurn({ scope: "project", scopeId: "p1", answer: "專案級", running: false, updatedAt: 1 });
    expect(getPhoneAssistantTurn("group", "g1")?.answer).toBe("組級");
    expect(getPhoneAssistantTurn("project", "p1")?.answer).toBe("專案級");
  });

  it("事件流有上限——手機不留一份完整 log 在記憶體裡", () => {
    publishPhoneAssistantTurn({
      scope: "group", scopeId: "g1", running: true, updatedAt: 1,
      events: Array.from({ length: 200 }, (_, i) => ({
        eventId: `e${i}`, runId: "r", timestamp: "", type: "tool.completed",
        status: "ok", title: `步驟 ${i}`, phase: "step", text: "",
      })) as never,
    });
    const events = getPhoneAssistantTurn("group", "g1")?.events ?? [];
    expect(events.length).toBeLessThanOrEqual(60);
    expect(events.at(-1)?.title).toBe("步驟 199");
  });

  it("清除只影響那一個 scope（換專案不該把組級投影一起清掉）", () => {
    publishPhoneAssistantTurn({ scope: "group", scopeId: "g1", answer: "組級", running: false, updatedAt: 1 });
    publishPhoneAssistantTurn({ scope: "project", scopeId: "p1", answer: "專案級", running: false, updatedAt: 1 });
    clearPhoneAssistantTurn("project", "p1");
    expect(getPhoneAssistantTurn("project", "p1")).toBeUndefined();
    expect(getPhoneAssistantTurn("group", "g1")?.answer).toBe("組級");
  });

  it("沒有 scopeId 時回 undefined，不會誤拿到別人的那一輪", () => {
    publishPhoneAssistantTurn({ scope: "group", scopeId: "g1", answer: "組級", running: false, updatedAt: 1 });
    expect(getPhoneAssistantTurn("group", undefined)).toBeUndefined();
  });
});
