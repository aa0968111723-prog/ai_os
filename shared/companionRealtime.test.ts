import { describe, expect, it } from "vitest";
import {
  COMPANION_WS_MESSAGE_TYPE,
  EMPTY_COMPANION_LIVE_STATE,
  companionEventNeedsRefetch,
  companionEventOrbSignals,
  parseCompanionWireEvent,
  reduceCompanionEvent,
  type CompanionWireEvent,
} from "./companionRealtime";

const event = (over: Partial<CompanionWireEvent> = {}): CompanionWireEvent => ({
  type: COMPANION_WS_MESSAGE_TYPE,
  kind: "generation_started",
  occurredAt: "2026-08-19T10:00:00.000Z",
  ...over,
});

describe("parseCompanionWireEvent", () => {
  it("認得自己的訊息", () => {
    const parsed = parseCompanionWireEvent({
      type: COMPANION_WS_MESSAGE_TYPE,
      kind: "generation_completed",
      projectId: "p1",
      occurredAt: "2026-08-19T10:00:00.000Z",
    });
    expect(parsed?.kind).toBe("generation_completed");
    expect(parsed?.projectId).toBe("p1");
  });

  it("不是這種訊息就回 null（既有 invalidate 不會被誤讀）", () => {
    expect(parseCompanionWireEvent({ type: "invalidate", scope: { kind: "scene" } })).toBeNull();
    expect(parseCompanionWireEvent(null)).toBeNull();
    expect(parseCompanionWireEvent("companion-event")).toBeNull();
  });

  it("缺必要欄位就丟掉——WS 訊息不可信", () => {
    expect(parseCompanionWireEvent({ type: COMPANION_WS_MESSAGE_TYPE, kind: "x" })).toBeNull();
    expect(parseCompanionWireEvent({ type: COMPANION_WS_MESSAGE_TYPE, occurredAt: "now" })).toBeNull();
  });

  it("數值欄位會夾範圍、字串會截長", () => {
    const parsed = parseCompanionWireEvent({
      type: COMPANION_WS_MESSAGE_TYPE,
      kind: "generation_progress",
      occurredAt: "2026-08-19T10:00:00.000Z",
      progress: 5,
      count: -3.7,
      entityLabel: "x".repeat(200),
    });
    expect(parsed?.progress).toBe(1);
    expect(parsed?.count).toBe(0);
    expect(parsed?.entityLabel?.length).toBe(40);
  });

  it("NaN 進度不會漏進狀態", () => {
    const parsed = parseCompanionWireEvent({
      type: COMPANION_WS_MESSAGE_TYPE,
      kind: "generation_progress",
      occurredAt: "2026-08-19T10:00:00.000Z",
      progress: Number.NaN,
    });
    expect(parsed?.progress).toBeUndefined();
  });
});

describe("reduceCompanionEvent", () => {
  it("開始／完成推得動計數", () => {
    let state = EMPTY_COMPANION_LIVE_STATE;
    state = reduceCompanionEvent(state, event({ kind: "generation_started", count: 3 }));
    expect(state.running).toBe(3);
    state = reduceCompanionEvent(state, event({ kind: "generation_completed", count: 2 }));
    expect(state.running).toBe(1);
    expect(state.completed).toBe(2);
  });

  it("漏收 started 之後也不會出現「-1 個生成中」", () => {
    const state = reduceCompanionEvent(
      EMPTY_COMPANION_LIVE_STATE,
      event({ kind: "generation_completed", count: 5 }),
    );
    expect(state.running).toBe(0);
  });

  it("跑完之後進度環要消失，不是停在 87%", () => {
    let state = reduceCompanionEvent(EMPTY_COMPANION_LIVE_STATE, event({ kind: "generation_started" }));
    state = reduceCompanionEvent(state, event({ kind: "generation_progress", progress: 0.87 }));
    expect(state.progress).toBe(0.87);
    state = reduceCompanionEvent(state, event({ kind: "generation_completed" }));
    expect(state.progress).toBeUndefined();
  });

  it("批次完成把跑動中的一次歸零", () => {
    let state = reduceCompanionEvent(EMPTY_COMPANION_LIVE_STATE, event({ kind: "generation_started", count: 9 }));
    state = reduceCompanionEvent(state, event({ kind: "batch_completed" }));
    expect(state.running).toBe(0);
  });

  it("失敗會累計並讓 running 退掉", () => {
    let state = reduceCompanionEvent(EMPTY_COMPANION_LIVE_STATE, event({ kind: "generation_started", count: 3 }));
    state = reduceCompanionEvent(state, event({ kind: "generation_failed", count: 3 }));
    expect(state.failed).toBe(3);
    expect(state.running).toBe(0);
  });

  it("永遠記得最後一則事件（提醒條要用）", () => {
    const state = reduceCompanionEvent(EMPTY_COMPANION_LIVE_STATE, event({ kind: "project_updated" }));
    expect(state.last?.kind).toBe("project_updated");
  });

  it("不改原本的 state（React 才看得到變化）", () => {
    const before = EMPTY_COMPANION_LIVE_STATE;
    const after = reduceCompanionEvent(before, event({ kind: "generation_started" }));
    expect(before.running).toBe(0);
    expect(after).not.toBe(before);
  });
});

describe("companionEventNeedsRefetch", () => {
  it("進度不觸發 refetch——那只是把輪詢換個名字", () => {
    expect(companionEventNeedsRefetch("generation_progress")).toBe(false);
    expect(companionEventNeedsRefetch("generation_started")).toBe(false);
  });

  it("離散的狀態轉換才回伺服器對答案", () => {
    expect(companionEventNeedsRefetch("generation_completed")).toBe(true);
    expect(companionEventNeedsRefetch("approval_required")).toBe(true);
    expect(companionEventNeedsRefetch("quota_exhausted")).toBe(true);
  });
});

describe("companionEventOrbSignals", () => {
  it("把即時狀態投影成 Orb 訊號", () => {
    const state = { running: 2, awaiting: 1, failed: 0, completed: 0, progress: 0.4 };
    expect(companionEventOrbSignals(state)).toEqual({
      executing: true,
      progress: 0.4,
      awaitingConfirmation: true,
      failed: false,
    });
  });

  it("沒有進度時不硬給一個 0", () => {
    const signals = companionEventOrbSignals(EMPTY_COMPANION_LIVE_STATE);
    expect("progress" in signals).toBe(false);
  });
});
