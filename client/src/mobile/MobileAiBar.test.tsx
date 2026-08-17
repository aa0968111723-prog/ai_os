import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const composed: string[] = [];
const opened: string[] = [];

vi.mock("../lib/assistantCompose", () => ({
  composeToAssistant: (text: string) => composed.push(text),
  useAssistantComposeListener: () => {},
  openAssistantSurface: () => opened.push("assistant"),
  useAssistantOpenListener: () => {},
}));

const navigate = vi.fn();
vi.mock("wouter", () => ({ useLocation: () => ["/p/p1", navigate] }));

import { MobileAiBar } from "./MobileAiBar";
import {
  publishPhoneAssistantTurn,
  resetPhoneAssistantBridgeForTest,
} from "../lib/phoneAssistantBridge";
import {
  registerAssistantFocus,
  registerAssistantPage,
  resetAssistantContextForTest,
} from "../lib/assistantContext";

const SHOT_A = "0f8fad5b-d9cb-469f-a165-70867728950e";
const SHOT_B = "1f8fad5b-d9cb-469f-a165-70867728950e";

const send = (value: string) => {
  const input = screen.getByLabelText("跟 Aios 說一句話");
  fireEvent.change(input, { target: { value } });
  fireEvent.submit(input.closest("form")!);
};

beforeEach(() => {
  composed.length = 0;
  opened.length = 0;
  navigate.mockClear();
  resetPhoneAssistantBridgeForTest();
  resetAssistantContextForTest();
});

describe("手機 AI 控制面：上下文膠囊", () => {
  it("沒有焦點時不顯示膠囊——第一屏已經印過專案名了", () => {
    render(<MobileAiBar groupId="g1" projectId="p1" projectTitle="百日夢島" statusLine="8 鏡完成 3 鏡" />);
    expect(screen.queryByLabelText("目前工作對象")).not.toBeInTheDocument();
  });

  it("打開某一鏡之後，膠囊把「哪個專案的哪一鏡」講出來，且不含 uuid", () => {
    registerAssistantPage({ pageType: "storyboard", projectId: "p1", projectTitle: "百日夢島" });
    registerAssistantFocus({ entityType: "shot", entityId: SHOT_A, entityLabel: "第 3 鏡" });
    render(<MobileAiBar groupId="g1" projectId="p1" projectTitle="百日夢島" />);
    const capsule = screen.getByLabelText("目前工作對象");
    expect(capsule).toHaveTextContent("百日夢島");
    expect(capsule).toHaveTextContent("第 3 鏡");
    expect(capsule.textContent ?? "").not.toContain(SHOT_A);
  });
});

describe("手機 AI 控制面：送出仍走既有接縫", () => {
  it("送出的是補完上下文的同一句話，而且只經由 composeToAssistant", () => {
    render(<MobileAiBar groupId="g1" projectId="p1" projectTitle="百日夢島" />);
    send("把第二幕改成晚上");
    expect(composed).toEqual(["在「百日夢島」：把第二幕改成晚上"]);
    // 沒有任何 mutation、沒有直接執行：這個元件只會 compose
    expect(opened).toEqual([]);
  });
});

describe("手機 AI 控制面：模糊刪除目標不准猜（Flow F）", () => {
  it("兩個合理對象時攔下來，且一個字都沒送出去", () => {
    registerAssistantPage({ pageType: "storyboard", projectId: "p1", projectTitle: "百日夢島" });
    registerAssistantFocus({ entityType: "shot", entityId: SHOT_A, entityLabel: "第 3 鏡" });
    render(<MobileAiBar groupId="g1" projectId="p1" projectTitle="百日夢島" />);
    send("刪掉這個");
    expect(composed).toEqual([]);
    expect(screen.getByText("要刪掉哪一個？")).toBeInTheDocument();
  });

  it("選了對象之後才送出，而且句子裡帶著使用者自己選的那個名字", () => {
    registerAssistantPage({ pageType: "storyboard", projectId: "p1", projectTitle: "百日夢島" });
    registerAssistantFocus({ entityType: "shot", entityId: SHOT_A, entityLabel: "第 3 鏡" });
    render(<MobileAiBar groupId="g1" projectId="p1" projectTitle="百日夢島" />);
    send("刪掉這個");
    fireEvent.click(screen.getByRole("button", { name: "第 3 鏡" }));
    expect(composed).toEqual(["刪掉這個——我指的是「第 3 鏡」"]);
  });

  it("「先不要」之後站上沒有留下任何痕跡", () => {
    registerAssistantPage({ pageType: "storyboard", projectId: "p1", projectTitle: "百日夢島" });
    registerAssistantFocus({ entityType: "shot", entityId: SHOT_A, entityLabel: "第 3 鏡" });
    render(<MobileAiBar groupId="g1" projectId="p1" projectTitle="百日夢島" />);
    send("刪掉這個");
    fireEvent.click(screen.getByRole("button", { name: "先不要" }));
    expect(composed).toEqual([]);
    expect(screen.queryByText("要刪掉哪一個？")).not.toBeInTheDocument();
  });

  it("多選時每一筆都是候選——不會默默只刪第一個", () => {
    registerAssistantPage({ pageType: "storyboard", projectId: "p1", projectTitle: "百日夢島" });
    registerAssistantFocus({ entityType: "shot", entityLabel: "分鏡", selectedEntityIds: [SHOT_A, SHOT_B] });
    render(<MobileAiBar groupId="g1" projectId="p1" projectTitle="百日夢島" />);
    send("刪掉這些");
    expect(composed).toEqual([]);
    expect(screen.getByText(/目前有 2 個可能的對象/)).toBeInTheDocument();
  });
});

describe("手機 AI 控制面：工作卡只反映權威狀態", () => {
  it("進行中顯示真的發生過的階段，沒有百分比", () => {
    publishPhoneAssistantTurn({
      scope: "project", scopeId: "p1", running: true, updatedAt: 1,
      events: [{
        eventId: "e1", runId: "r1", stepId: "s1", timestamp: "", type: "tool.completed",
        status: "ok", title: "分析 6 鏡", resultCount: 6, phase: "step", text: "",
      }] as never,
    });
    render(<MobileAiBar groupId="g1" projectId="p1" projectTitle="百日夢島" />);
    expect(screen.getByText("分析 6 鏡")).toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  it("有待確認提議時是「待確認」，即使助手的文字說已經做完了", () => {
    publishPhoneAssistantTurn({
      scope: "project", scopeId: "p1", running: false, updatedAt: 1,
      answer: "我已經把第二幕改成夜晚了。",
      pendingProposals: [{ id: "a0", label: "更新第二幕：時間 → 夜晚" }],
    });
    render(<MobileAiBar groupId="g1" projectId="p1" projectTitle="百日夢島" />);
    expect(screen.getByText("待確認")).toBeInTheDocument();
    expect(screen.getByText("更新第二幕：時間 → 夜晚")).toBeInTheDocument();
  });

  it("付費提議的按鈕標出費用，按下去只是回到既有確認卡（不代按）", () => {
    publishPhoneAssistantTurn({
      scope: "project", scopeId: "p1", running: false, updatedAt: 1,
      pendingProposals: [{ id: "a0", label: "生成 3 個候選", capabilityId: "generate_media" }],
    });
    render(<MobileAiBar groupId="g1" projectId="p1" projectTitle="百日夢島" />);
    expect(screen.getByText("需點數")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /查看內容與費用/ }));
    expect(opened).toEqual(["assistant"]);
    expect(composed).toEqual([]);
  });

  it("部分成功顯示 2/3，而且是 alert（使用者真的需要知道）", () => {
    publishPhoneAssistantTurn({
      scope: "project", scopeId: "p1", running: false, updatedAt: 1,
      events: [
        { eventId: "e1", runId: "r", stepId: "a1", timestamp: "", type: "action.completed", status: "ok", title: "加入角色", phase: "step", text: "" },
        { eventId: "e2", runId: "r", stepId: "a2", timestamp: "", type: "action.completed", status: "ok", title: "建立分鏡", phase: "step", text: "" },
        { eventId: "e3", runId: "r", stepId: "a3", timestamp: "", type: "action.failed", status: "failed", title: "生成候選", phase: "step", text: "" },
        { eventId: "e4", runId: "r", stepId: "z", timestamp: "", type: "agent.completed", status: "ok", title: "完成", phase: "done", text: "" },
      ] as never,
    });
    render(<MobileAiBar groupId="g1" projectId="p1" projectTitle="百日夢島" />);
    expect(screen.getByText("完成 2 / 3")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("部分完成");
  });

  it("專案 scope 的那一輪優先於組級（使用者正在等的是這一個）", () => {
    publishPhoneAssistantTurn({ scope: "group", scopeId: "g1", answer: "組級舊回覆", running: false, updatedAt: 1 });
    publishPhoneAssistantTurn({ scope: "project", scopeId: "p1", answer: "專案級新回覆", running: false, updatedAt: 2 });
    render(<MobileAiBar groupId="g1" projectId="p1" projectTitle="百日夢島" />);
    expect(screen.getByText("專案級新回覆")).toBeInTheDocument();
    expect(screen.queryByText("組級舊回覆")).not.toBeInTheDocument();
  });

  it("沒有任何一輪時完全不畫卡（首屏不多一塊空白）", () => {
    render(<MobileAiBar groupId="g1" projectId="p1" projectTitle="百日夢島" />);
    expect(document.querySelector(".m-card")).toBeNull();
  });
});
