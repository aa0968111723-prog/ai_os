import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useVoiceInput } from "./useVoiceInput";

/**
 * 原生語音路徑的行為測試。
 *
 * Android WebView 沒有 webkitSpeechRecognition——APK 裡的語音**只有**這條
 * 原生路徑。這裡用假的 window.Capacitor.Plugins.AiosSpeech 驗證：
 * 模式選擇、逐字稿事件流、rms 餵音量、stopAsync 等最終結果與逾時退路。
 */

type Listener = (payload: Record<string, unknown>) => void;

function installFakePlugin() {
  const listeners = new Map<string, Listener>();
  const removed: string[] = [];
  const plugin = {
    start: vi.fn(() => Promise.resolve()),
    stop: vi.fn(() => Promise.resolve()),
    addListener: vi.fn((event: string, callback: Listener) => {
      listeners.set(event, callback);
      return Promise.resolve({ remove: () => { removed.push(event); } });
    }),
  };
  (window as unknown as { Capacitor?: unknown }).Capacitor = { Plugins: { AiosSpeech: plugin } };
  const emit = (event: string, payload: Record<string, unknown>) => {
    act(() => { listeners.get(event)?.(payload); });
  };
  return { plugin, emit, removed };
}

afterEach(() => {
  delete (window as unknown as { Capacitor?: unknown }).Capacitor;
});

describe("useVoiceInput（native 模式）", () => {
  it("plugin 在場＝supported，start 走 plugin 而不是 Web Speech", async () => {
    const { plugin } = installFakePlugin();
    const { result } = renderHook(() => useVoiceInput());
    expect(result.current.supported).toBe(true);
    await act(async () => { result.current.start(); });
    expect(plugin.start).toHaveBeenCalledWith({ language: "zh-TW" });
    expect(result.current.status).toBe("listening");
  });

  it("partialResult 逐字稿即時顯示；rms 餵音量圈（不另開 getUserMedia）", async () => {
    const { emit } = installFakePlugin();
    const { result } = renderHook(() => useVoiceInput());
    await act(async () => { result.current.start(); });
    emit("partialResult", { transcript: "我的動畫做到" });
    expect(result.current.transcript).toBe("我的動畫做到");
    emit("rms", { level: 0.6 });
    expect(result.current.amplitude).toBe(0.6);
    // 超界要夾住：Java 端正規化只是近似
    emit("rms", { level: 4 });
    expect(result.current.amplitude).toBe(1);
  });

  it("stopAsync 等引擎的最終結果——比最後一段 partial 準", async () => {
    const { plugin, emit } = installFakePlugin();
    const { result } = renderHook(() => useVoiceInput());
    await act(async () => { result.current.start(); });
    emit("partialResult", { transcript: "把失敗的重" });
    let said: Promise<string>;
    await act(async () => {
      said = result.current.stopAsync();
      await Promise.resolve();
    });
    expect(plugin.stop).toHaveBeenCalled();
    emit("result", { transcript: "把失敗的重跑" });
    await expect(said!).resolves.toBe("把失敗的重跑");
  });

  it("最終結果逾時（800ms）就用最後的 partial——不讓使用者以為沒送出去", async () => {
    vi.useFakeTimers();
    try {
      const { emit } = installFakePlugin();
      const { result } = renderHook(() => useVoiceInput());
      await act(async () => { result.current.start(); });
      emit("partialResult", { transcript: "繼續下一幕" });
      let said: Promise<string>;
      await act(async () => {
        said = result.current.stopAsync();
        await Promise.resolve();
      });
      await act(async () => { vi.advanceTimersByTime(900); });
      await expect(said!).resolves.toBe("繼續下一幕");
    } finally {
      vi.useRealTimers();
    }
  });

  it("state 事件誠實轉狀態：denied 就是 denied，不假裝在聽", async () => {
    const { emit } = installFakePlugin();
    const { result } = renderHook(() => useVoiceInput());
    await act(async () => { result.current.start(); });
    emit("state", { status: "denied" });
    expect(result.current.status).toBe("denied");
  });

  it("unmount 收乾淨：plugin.stop＋移除所有 listener（麥克風紅點不能留）", async () => {
    const { plugin, removed } = installFakePlugin();
    const { result, unmount } = renderHook(() => useVoiceInput());
    await act(async () => { result.current.start(); });
    unmount();
    expect(plugin.stop).toHaveBeenCalled();
    expect(removed).toEqual(expect.arrayContaining(["partialResult", "result", "rms", "state"]));
  });
});

describe("useVoiceInput（無任何語音來源）", () => {
  it("plugin 與 Web Speech 都沒有＝unsupported，UI 退回打字", () => {
    const { result } = renderHook(() => useVoiceInput());
    expect(result.current.supported).toBe(false);
    expect(result.current.status).toBe("unsupported");
  });
});
