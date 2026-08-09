import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  abortAssistantRun,
  captureAssistantReturnContext,
  clearAssistantConversation,
  endAssistantRun,
  getAssistantConversation,
  registerAssistantRunController,
  recordAssistantActionResults,
  returnToAssistantConversation,
  resetAssistantRunStoreForTest,
  setAssistantConversation,
  subscribeAssistantRun,
} from "./assistantRunStore";

type Message = { role: "user" | "assistant"; text: string };

beforeEach(() => {
  resetAssistantRunStoreForTest();
});

describe("assistantRunStore", () => {
  it("未知的組回空狀態，不會意外共用別組的對話", () => {
    setAssistantConversation<Message>("g1", (previous) => ({
      ...previous,
      messages: [{ role: "user", text: "嗨" }],
    }));
    expect(getAssistantConversation<Message>("g1").messages).toHaveLength(1);
    expect(getAssistantConversation<Message>("g2").messages).toHaveLength(0);
    expect(getAssistantConversation<Message>(undefined).messages).toHaveLength(0);
  });

  /** 這條就是「換頁後 Agent Run 不會消失」——store 不隨元件卸載而清空 */
  it("執行中的 run 在元件卸載之後仍留在 store 裡", () => {
    setAssistantConversation<Message>("g1", () => ({
      messages: [{ role: "user", text: "這個專案做到哪裡" }],
      run: { runId: "run-1", events: [], sources: [], active: true, startedAt: 0 },
    }));
    // 模擬「關掉面板 → 元件卸載 → 重新開啟」：store 是模組級的，沒有任何卸載鉤子會動它
    const reopened = getAssistantConversation<Message>("g1");
    expect(reopened.run?.active).toBe(true);
    expect(reopened.messages[0].text).toBe("這個專案做到哪裡");
  });

  it("endAssistantRun 只翻 active，不丟掉已收到的事件與來源", () => {
    setAssistantConversation<Message>("g1", () => ({
      messages: [],
      run: { runId: "run-1", events: [], sources: [{ id: "s", type: "project", name: "專案", status: "ok" }], active: true, startedAt: 0 },
    }));
    endAssistantRun("g1");
    const state = getAssistantConversation<Message>("g1");
    expect(state.run?.active).toBe(false);
    expect(state.run?.sources).toHaveLength(1);
  });

  it("updater 收到的是當下最新狀態——兩個掛載中的檢視不會互相覆蓋", () => {
    setAssistantConversation<Message>("g1", (previous) => ({ ...previous, messages: [{ role: "user", text: "a" }] }));
    setAssistantConversation<Message>("g1", (previous) => ({ ...previous, messages: [...previous.messages, { role: "assistant", text: "b" }] }));
    expect(getAssistantConversation<Message>("g1").messages.map((m) => m.text)).toEqual(["a", "b"]);
  });

  it("訂閱者在狀態變動時被通知，取消訂閱後不再收到", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAssistantRun(listener);
    setAssistantConversation<Message>("g1", (previous) => ({ ...previous, messages: [{ role: "user", text: "a" }] }));
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    clearAssistantConversation("g1");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  /** 關掉面板再打開時元件是新的一份，本地 ref 會是空的——把手必須跟著執行走 */
  it("中止把手跨卸載仍有效，收尾後不再可中止", () => {
    const controller = new AbortController();
    registerAssistantRunController("g1", controller);
    expect(abortAssistantRun("g1")).toBe(true);
    expect(controller.signal.aborted).toBe(true);
    // 已經中止過（或根本沒在跑）時要誠實回 false，不假裝停了什麼
    expect(abortAssistantRun("g1")).toBe(false);
  });

  it("endAssistantRun 會清掉把手，避免下一次「停止」中止到已結束的執行", () => {
    const controller = new AbortController();
    registerAssistantRunController("g1", controller);
    endAssistantRun("g1");
    expect(abortAssistantRun("g1")).toBe(false);
    expect(controller.signal.aborted).toBe(false);
  });

  it("updater 回傳同一個物件時不通知（避免無意義的重繪）", () => {
    const listener = vi.fn();
    subscribeAssistantRun(listener);
    setAssistantConversation<Message>("g1", (previous) => previous);
    expect(listener).not.toHaveBeenCalled();
  });

  it("route change 後保留同一 conversation return context", () => {
    const first = captureAssistantReturnContext({ groupId: "g1", projectId: "p1", originRoute: "/dashboard" });
    const next = captureAssistantReturnContext({ groupId: "g1", projectId: "p1", runId: "run-1", originRoute: "/p/p1" });
    expect(next.conversationId).toBe(first.conversationId);
    expect(returnToAssistantConversation("g1", "run-1")?.originRoute).toBe("/p/p1");
    expect(getAssistantConversation<Message>("g1").messages).toEqual([]);
  });

  it("recent import results are bounded and survive component unmount semantics", () => {
    recordAssistantActionResults("g1", Array.from({ length: 7 }, (_, index) => ({
      type: "import" as const,
      source: "url" as const,
      resourceIds: [`r${index}`], assetIds: [`a${index}`], intelligenceIds: [],
      count: 1, duplicateCount: 0, needsReviewCount: 1, backgroundProcessing: true,
      verification: { status: "verified" as const, message: "ok" },
    })));
    expect(getAssistantConversation<Message>("g1").recentActionResults).toHaveLength(5);
  });
});
