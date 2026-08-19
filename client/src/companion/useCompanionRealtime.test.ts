import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COMPANION_WS_MESSAGE_TYPE } from "@shared/companionRealtime";
import { useCompanionRealtime } from "./useCompanionRealtime";

/** 極小的 WebSocket 替身：只要能開、能收訊息、能關。 */
class FakeSocket {
  static instances: FakeSocket[] = [];
  static OPEN = 1;
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  send() {}
  close() {
    this.closed = true;
    this.readyState = 3;
    this.onclose?.();
  }
  emit(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
}

const event = (over: Record<string, unknown> = {}) => ({
  type: COMPANION_WS_MESSAGE_TYPE,
  kind: "generation_started",
  occurredAt: "2026-08-19T10:00:00.000Z",
  ...over,
});

beforeEach(() => {
  FakeSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeSocket as unknown as typeof WebSocket);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("useCompanionRealtime", () => {
  it("連的是既有的組房（同一條 /ws，不是第二套 realtime）", () => {
    renderHook(() => useCompanionRealtime({ groupId: "g-1" }));
    expect(FakeSocket.instances[0].url).toContain("/ws?groupId=g-1");
  });

  it("groupId 為空時不連線", () => {
    renderHook(() => useCompanionRealtime({ groupId: "" }));
    expect(FakeSocket.instances).toHaveLength(0);
  });

  it("enabled=false 時不連線", () => {
    renderHook(() => useCompanionRealtime({ groupId: "g-1", enabled: false }));
    expect(FakeSocket.instances).toHaveLength(0);
  });

  it("事件推得動計數", () => {
    const { result } = renderHook(() => useCompanionRealtime({ groupId: "g-1" }));
    act(() => FakeSocket.instances[0].open());
    act(() => FakeSocket.instances[0].emit(event({ kind: "generation_started", count: 3 })));
    expect(result.current.live.running).toBe(3);
    act(() => FakeSocket.instances[0].emit(event({ kind: "generation_completed", count: 1 })));
    expect(result.current.live.running).toBe(2);
    expect(result.current.live.completed).toBe(1);
  });

  it("既有的 presence／invalidate 訊息一律忽略，不會誤判成 Companion 事件", () => {
    const onResync = vi.fn();
    const { result } = renderHook(() => useCompanionRealtime({ groupId: "g-1", onResync }));
    act(() => FakeSocket.instances[0].open());
    act(() => FakeSocket.instances[0].emit({ type: "invalidate", scope: { kind: "scene" } }));
    act(() => FakeSocket.instances[0].emit({ type: "presence", users: [] }));
    expect(result.current.live.running).toBe(0);
    expect(onResync).not.toHaveBeenCalled();
  });

  it("壞掉的 JSON 不會讓 hook 炸掉", () => {
    const { result } = renderHook(() => useCompanionRealtime({ groupId: "g-1" }));
    act(() => FakeSocket.instances[0].open());
    act(() => FakeSocket.instances[0].onmessage?.({ data: "{ not json" }));
    expect(result.current.live.running).toBe(0);
  });

  it("離散事件才 resync，進度事件不會把它變成輪詢", () => {
    const onResync = vi.fn();
    renderHook(() => useCompanionRealtime({ groupId: "g-1", onResync }));
    act(() => FakeSocket.instances[0].open());
    act(() => FakeSocket.instances[0].emit(event({ kind: "generation_progress", progress: 0.4 })));
    expect(onResync).not.toHaveBeenCalled();
    act(() => FakeSocket.instances[0].emit(event({ kind: "generation_completed" })));
    expect(onResync).toHaveBeenCalledTimes(1);
  });

  it("斷線後退避重連，並在重連成功時重抓權威狀態", () => {
    vi.useFakeTimers();
    const onResync = vi.fn();
    renderHook(() => useCompanionRealtime({ groupId: "g-1", onResync }));
    act(() => FakeSocket.instances[0].open());
    // 第一次連上不算重連——那時查詢正要發出
    expect(onResync).not.toHaveBeenCalled();
    act(() => FakeSocket.instances[0].close());
    act(() => { vi.advanceTimersByTime(1_100); });
    expect(FakeSocket.instances).toHaveLength(2);
    act(() => FakeSocket.instances[1].open());
    expect(onResync).toHaveBeenCalledTimes(1);
  });

  it("卸載時關閉連線，不留著背景 socket", () => {
    const { unmount } = renderHook(() => useCompanionRealtime({ groupId: "g-1" }));
    act(() => FakeSocket.instances[0].open());
    unmount();
    expect(FakeSocket.instances[0].closed).toBe(true);
  });
});
