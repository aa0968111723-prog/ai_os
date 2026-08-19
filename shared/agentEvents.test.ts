import { describe, expect, it } from "vitest";
import {
  buildAgentWorkSteps,
  formatDuration,
  formatResultSummary,
  isAgentEvent,
  queryGoalLabel,
  roundAcquiredSourcesDescription,
  roundThinkingTitle,
  summarizeAgentEvents,
  type AgentEvent,
} from "./agentEvents";

function makeEvent(over: Partial<AgentEvent> & Pick<AgentEvent, "type" | "title">): AgentEvent {
  return {
    eventId: over.eventId ?? `e-${over.title}`,
    runId: "run-1",
    timestamp: "2026-08-09T00:00:00.000Z",
    status: "ok",
    phase: "step",
    text: over.title,
    ...over,
  } as AgentEvent;
}

describe("summarizeAgentEvents", () => {
  it("沒有事件時全部是 0——不補任何預設步驟", () => {
    expect(summarizeAgentEvents([])).toEqual({
      toolCalls: 0,
      sourcesRead: 0,
      itemsRead: 0,
      actionsCompleted: 0,
      failures: 0,
      waiting: false,
      currentTitle: undefined,
    });
  });

  it("只數真的完成的工具與來源，並把筆數加總", () => {
    const summary = summarizeAgentEvents([
      makeEvent({ type: "tool.started", title: "正在查資料庫", status: "running" }),
      makeEvent({ type: "tool.completed", title: "已讀取資料庫" }),
      makeEvent({ type: "source.read", title: "已讀取專案", resultCount: 12 }),
      makeEvent({ type: "source.read", title: "已讀取素材", resultCount: 16 }),
    ]);
    expect(summary.toolCalls).toBe(1);
    expect(summary.sourcesRead).toBe(2);
    expect(summary.itemsRead).toBe(28);
  });

  it("empty 狀態的來源不算讀成功——「查了但沒有」不是「讀到了」", () => {
    const summary = summarizeAgentEvents([
      makeEvent({ type: "source.read", title: "資料庫沒有相符的內容", status: "empty", resultCount: 0 }),
    ]);
    expect(summary.sourcesRead).toBe(0);
    expect(summary.itemsRead).toBe(0);
  });

  it("失敗與等待各自可見：卡住時使用者要知道卡在哪", () => {
    const summary = summarizeAgentEvents([
      makeEvent({ type: "tool.failed", title: "查詢失敗", status: "failed", error: "Network timeout" }),
      makeEvent({ type: "waiting.permission", title: "有 1 件動作需要你確認", status: "waiting" }),
    ]);
    expect(summary.failures).toBe(1);
    expect(summary.waiting).toBe(true);
    expect(summary.currentTitle).toBe("有 1 件動作需要你確認");
  });

  it("進行中的步驟被同一個 stepId 的完成事件取代後就不再是「目前」", () => {
    const summary = summarizeAgentEvents([
      makeEvent({ type: "tool.started", title: "正在查專案", status: "running", stepId: "s1" }),
      makeEvent({ type: "tool.completed", title: "已讀取專案", stepId: "s1" }),
    ]);
    expect(summary.currentTitle).toBeUndefined();
  });
});

describe("buildAgentWorkSteps", () => {
  it("同一個 stepId 摺疊成一列，最終狀態與計量以最後一則為準", () => {
    const steps = buildAgentWorkSteps([
      makeEvent({ type: "tool.started", title: "正在查資料庫", status: "running", stepId: "s1", toolName: "query_database" }),
      makeEvent({ type: "tool.completed", title: "已讀取資料庫", stepId: "s1", resultCount: 3, durationMs: 523 }),
    ]);
    expect(steps).toHaveLength(1);
    expect(steps[0].title).toBe("已讀取資料庫");
    expect(steps[0].status).toBe("ok");
    expect(steps[0].resultCount).toBe(3);
    expect(steps[0].durationMs).toBe(523);
    // 第二層要拿得到兩則原始事件（含工具真名）
    expect(steps[0].events).toHaveLength(2);
    expect(steps[0].events[0].toolName).toBe("query_database");
  });

  it("沒有 stepId 的事件各自成列，順序照收到的順序", () => {
    const steps = buildAgentWorkSteps([
      makeEvent({ type: "source.read", title: "已讀取專案", eventId: "a" }),
      makeEvent({ type: "source.read", title: "已讀取素材", eventId: "b" }),
    ]);
    expect(steps.map((step) => step.title)).toEqual(["已讀取專案", "已讀取素材"]);
  });
});

describe("格式化", () => {
  it("結果摘要排成「1 個專案・12 鏡分鏡」", () => {
    expect(formatResultSummary([
      { label: "專案", value: 1 },
      { label: "分鏡", value: 12, unit: "鏡" },
    ])).toBe("1 個專案・12 鏡分鏡");
    expect(formatResultSummary(undefined)).toBe("");
  });

  it("秒以下用毫秒——0.0 秒看起來像沒發生過", () => {
    expect(formatDuration(523)).toBe("523 毫秒");
    expect(formatDuration(1800)).toBe("1.8 秒");
    expect(formatDuration(undefined)).toBe("");
  });
});

describe("roundThinkingTitle（#669 U7：不同查詢要有不同工作過程標題）", () => {
  it("把使用者問的那句話收進標題——兩個不同問題不再長得一樣", () => {
    expect(roundThinkingTitle(0, "列出專案")).toBe("整理「列出專案」相關資料");
    expect(roundThinkingTitle(0, "比較專案")).toBe("整理「比較專案」相關資料");
  });

  it("第二輪以上顯示「繼續分析」語義", () => {
    expect(roundThinkingTitle(1, "列出專案")).toBe("比對「列出專案」相關資料，繼續分析");
  });

  it("只取第一個句子，避免長問題把整條軌跡撐爆", () => {
    const long = "列出專案並比較上週與本週的素材進度跟分鏡完成率，最後給我一段摘要";
    expect(queryGoalLabel(long)).toBe("列出專案並比較上週與本週的素材進度跟…");
    expect(roundThinkingTitle(0, long)).toContain("…");
  });

  it("空白或只有標點時退回通用語", () => {
    expect(queryGoalLabel("   ")).toBe("你的請求");
    expect(queryGoalLabel("？")).toBe("？");
    expect(roundThinkingTitle(0, "")).toBe("整理「你的請求」相關資料");
  });
});

describe("roundAcquiredSourcesDescription", () => {
  it("mid-run copy is 讀取中, never 已取得來源", () => {
    expect(roundAcquiredSourcesDescription(["專案全貌", "分鏡"])).toBe("讀取中：專案全貌、分鏡");
    expect(roundAcquiredSourcesDescription([])).toBeUndefined();
    expect(roundAcquiredSourcesDescription(["專案全貌", "分鏡"])).not.toMatch(/已取得/);
  });
});

describe("isAgentEvent", () => {
  it("舊協定事件（只有 phase/text）不會被誤認成新事件", () => {
    expect(isAgentEvent({ phase: "step", text: "查了素材庫(12 筆)" })).toBe(false);
  });

  it("型別與狀態必須在白名單內", () => {
    const valid = makeEvent({ type: "tool.completed", title: "已讀取" });
    expect(isAgentEvent(valid)).toBe(true);
    expect(isAgentEvent({ ...valid, type: "tool.exploded" })).toBe(false);
    expect(isAgentEvent({ ...valid, status: "vibes" })).toBe(false);
  });
});
