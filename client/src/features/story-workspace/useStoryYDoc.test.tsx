/**
 * Story 共編 client 綁定：用假 WebSocket 驗三件會壞得無聲的事——
 *  1. 未連上時 applyLocal 回 false（呼叫端要走舊 autosave，不能兩頭都不存）。
 *  2. 收到 sync → active；收到 update → onRemote 帶正確的 caret 轉換器。
 *  3. 本地差量會以 {type:"update"} 送出（不送就是「只有自己看得到自己打的字」）。
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StrictMode } from "react";
import * as Y from "yjs";
import { useStoryYDoc } from "./useStoryYDoc";

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static OPEN = 1;
  readyState = 0;
  url: string;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
  /** 測試用：模擬伺服器端 */
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  receive(msg: unknown) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}

function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

const PROJECT = "11111111-1111-1111-1111-111111111111";

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeWebSocket as unknown as typeof WebSocket);
});
afterEach(() => vi.unstubAllGlobals());

describe("useStoryYDoc", () => {
  it("未連上：active=false、applyLocal 回 false——呼叫端必須走舊 autosave", () => {
    const { result } = renderHook(() =>
      useStoryYDoc({ projectId: PROJECT, enabled: true, onRemote: vi.fn() }),
    );
    expect(result.current.active).toBe(false);
    expect(result.current.applyLocal("有人打字了")).toBe(false);
  });

  it("sync → active=true 且 onRemote 帶入伺服器內容；之後的遠端 update 帶 caret 轉換器", async () => {
    const onRemote = vi.fn();
    const { result } = renderHook(() =>
      useStoryYDoc({ projectId: PROJECT, enabled: true, onRemote }),
    );
    const ws = FakeWebSocket.instances[0]!;
    expect(ws.url).toContain(`/ws-doc?doc=story:${PROJECT}`);

    // 伺服器 sync：完整快照
    const server = new Y.Doc();
    server.getText("content").insert(0, "下雨了。");
    act(() => {
      ws.open();
      ws.receive({ type: "sync", u: b64(Y.encodeStateAsUpdate(server)) });
    });
    await waitFor(() => expect(result.current.active).toBe(true));
    expect(onRemote).toHaveBeenCalledWith("下雨了。", expect.any(Function));

    // 夥伴在開頭插入——增量 update 進來
    onRemote.mockClear();
    const beforeVector = Y.encodeStateVector(server);
    server.getText("content").insert(0, "【第一場】");
    act(() => {
      ws.receive({ type: "update", u: b64(Y.encodeStateAsUpdate(server, beforeVector)) });
    });
    expect(onRemote).toHaveBeenCalledTimes(1);
    const [next, transform] = onRemote.mock.calls[0]!;
    expect(next).toBe("【第一場】下雨了。");
    // 我的游標原本在「下雨了。」的 2：開頭插入 5 個字 → 新位置 7
    expect(transform(2)).toBe(7);
  });

  it("本地差量以 {type:'update'} 送出，且伺服器套用後內容一致", async () => {
    const onRemote = vi.fn();
    const { result } = renderHook(() =>
      useStoryYDoc({ projectId: PROJECT, enabled: true, onRemote }),
    );
    const ws = FakeWebSocket.instances[0]!;
    const server = new Y.Doc();
    act(() => {
      ws.open();
      ws.receive({ type: "sync", u: b64(Y.encodeStateAsUpdate(server)) });
    });
    await waitFor(() => expect(result.current.active).toBe(true));

    act(() => {
      expect(result.current.applyLocal("我打的第一句")).toBe(true);
    });
    const sentUpdates = ws.sent.map((s) => JSON.parse(s)).filter((m) => m.type === "update");
    expect(sentUpdates.length).toBeGreaterThan(0);
    // 伺服器套用送出的增量後，兩端一致——這就是「任何人的字都不會消失」的傳輸前半段
    for (const m of sentUpdates) Y.applyUpdate(server, Buffer.from(m.u, "base64"));
    expect(server.getText("content").toString()).toBe("我打的第一句");
  });

  it("斷線：active 退回 false、peers 清空——幽靈 caret 比沒有 caret 更誤導", async () => {
    const { result } = renderHook(() =>
      useStoryYDoc({ projectId: PROJECT, enabled: true, onRemote: vi.fn() }),
    );
    const ws = FakeWebSocket.instances[0]!;
    const server = new Y.Doc();
    act(() => {
      ws.open();
      ws.receive({ type: "sync", u: b64(Y.encodeStateAsUpdate(server)) });
      ws.receive({ type: "awareness", a: { userId: "u-wei", name: "韋澔", color: "#7a6ea8", cursor: 3 } });
    });
    await waitFor(() => expect(result.current.peers.size).toBe(1));
    act(() => ws.close());
    await waitFor(() => expect(result.current.active).toBe(false));
    expect(result.current.peers.size).toBe(0);
  });

  it("StrictMode 雙掛載：第一條被中止的 socket 遲到的 onclose 不得清掉活連線", async () => {
    // 實機雙瀏覽器抓到的回歸：畫面顯示「共編中」、字卻一個都送不出去。
    // 瀏覽器的 close 事件是**非同步**的——這裡讓 close() 只改 readyState，
    // onclose 由測試稍後補發，重現「第二條連上之後第一條的 onclose 才到」。
    class SlowCloseWebSocket extends FakeWebSocket {
      close() {
        this.readyState = 3;
      }
    }
    vi.stubGlobal("WebSocket", SlowCloseWebSocket as unknown as typeof WebSocket);
    const { result } = renderHook(
      () => useStoryYDoc({ projectId: PROJECT, enabled: true, onRemote: vi.fn() }),
      { wrapper: StrictMode },
    );
    // StrictMode：掛載→卸載→再掛載 = 兩條 socket；第一條已被 close（onclose 未到）
    expect(FakeWebSocket.instances.length).toBe(2);
    const [stale, live] = FakeWebSocket.instances as [FakeWebSocket, FakeWebSocket];

    const server = new Y.Doc();
    act(() => {
      live.open();
      live.receive({ type: "sync", u: b64(Y.encodeStateAsUpdate(server)) });
    });
    await waitFor(() => expect(result.current.active).toBe(true));

    // 第一條 socket 的 onclose 這時才遲到——不得動到活連線的狀態
    act(() => stale.onclose?.());
    expect(result.current.active).toBe(true);
    act(() => {
      expect(result.current.applyLocal("字要送得出去")).toBe(true);
    });
    expect(live.sent.map((s) => JSON.parse(s)).some((m) => m.type === "update")).toBe(true);
  });

  it("awareness 帶夥伴的名字顏色與 caret；gone 即移除", async () => {
    const { result } = renderHook(() =>
      useStoryYDoc({ projectId: PROJECT, enabled: true, onRemote: vi.fn() }),
    );
    const ws = FakeWebSocket.instances[0]!;
    act(() => {
      ws.open();
      ws.receive({ type: "awareness", a: { userId: "u-wei", name: "韋澔", color: "#7a6ea8", cursor: 3, selectionEnd: 5 } });
    });
    await waitFor(() => expect(result.current.peers.get("u-wei")).toMatchObject({ name: "韋澔", color: "#7a6ea8", cursor: 3 }));
    act(() => ws.receive({ type: "awareness", a: { userId: "u-wei", gone: true } }));
    await waitFor(() => expect(result.current.peers.size).toBe(0));
  });
});
