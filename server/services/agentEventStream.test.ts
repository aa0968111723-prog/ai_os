import { describe, expect, it, vi } from "vitest";
import { AgentEventStream } from "./agentEventStream";

describe("AgentEventStream", () => {
  it("每一則事件都帶舊協定的 phase/text——新伺服器不會讓舊前端變成空白", () => {
    const stream = new AgentEventStream("run-1");
    stream.emit({ type: "tool.started", title: "正在查資料庫" });
    stream.emit({ type: "tool.completed", title: "已讀取資料庫" });
    const [started, completed] = stream.snapshotEvents();
    expect(started.phase).toBe("lookup");
    expect(started.text).toBe("正在查資料庫");
    expect(completed.phase).toBe("step");
  });

  it("耗時是 startStep→finishStep 的實測差值，不是呼叫端估的", () => {
    vi.useFakeTimers();
    try {
      const stream = new AgentEventStream("run-1");
      const stepId = stream.startStep({ type: "tool.started", title: "正在查資料庫" });
      vi.advanceTimersByTime(1800);
      stream.finishStep(stepId, { type: "tool.completed", title: "已讀取資料庫" });
      const events = stream.snapshotEvents();
      expect(events[0].durationMs).toBeUndefined(); // started 不填耗時
      expect(events[1].durationMs).toBe(1800);
      expect(events[1].stepId).toBe(events[0].stepId);
    } finally {
      vi.useRealTimers();
    }
  });

  it("狀態依型別推導：started 是進行中、failed 是失敗、waiting 是等待", () => {
    const stream = new AgentEventStream("run-1");
    stream.emit({ type: "action.started", title: "正在建立任務" });
    stream.emit({ type: "tool.failed", title: "查詢失敗" });
    stream.emit({ type: "waiting.permission", title: "需要你確認" });
    expect(stream.snapshotEvents().map((event) => event.status)).toEqual(["running", "failed", "waiting"]);
  });

  it("resultCount 0 會保留（真的是 0 筆），未提供則不出現在事件上", () => {
    const stream = new AgentEventStream("run-1");
    stream.emit({ type: "tool.completed", title: "查了資料庫", resultCount: 0 });
    stream.emit({ type: "tool.completed", title: "查了模型目錄" });
    const [withCount, withoutCount] = stream.snapshotEvents();
    expect(withCount.resultCount).toBe(0);
    expect("resultCount" in withoutCount).toBe(false);
  });

  it("同一筆來源被讀第二次時以最新計量取代，不會重複列出", () => {
    const stream = new AgentEventStream("run-1");
    stream.addSource({ id: "database:x", type: "database", name: "素材庫", itemCount: 3, status: "ok" });
    stream.addSource({ id: "database:x", type: "database", name: "素材庫", itemCount: 12, status: "ok" });
    expect(stream.snapshotSources()).toEqual([
      { id: "database:x", type: "database", name: "素材庫", itemCount: 12, status: "ok" },
    ]);
  });

  it("下游 sink 丟例外不會讓問答本身失敗（串流端斷線是常態）", () => {
    const stream = new AgentEventStream("run-1", () => { throw new Error("客戶端已斷線"); });
    expect(() => stream.emit({ type: "agent.started", title: "開始" })).not.toThrow();
    expect(stream.snapshotEvents()).toHaveLength(1);
  });

  it("eventId 在同一次 run 內唯一且帶 runId 前綴", () => {
    const stream = new AgentEventStream("run-abc");
    stream.emit({ type: "agent.started", title: "a" });
    stream.emit({ type: "agent.completed", title: "b" });
    const ids = stream.snapshotEvents().map((event) => event.eventId);
    expect(new Set(ids).size).toBe(2);
    expect(ids.every((id) => id.startsWith("run-abc:"))).toBe(true);
  });
});
