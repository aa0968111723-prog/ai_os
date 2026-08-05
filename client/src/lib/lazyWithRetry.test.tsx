/**
 * 路由 lazy 的韌性：chunk 抓不到不該讓整個 App 變成「畫面出了點狀況」。
 */
import { Component, Suspense, type ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lazyWithRetry } from "./lazyWithRetry";

const Hello = () => <p>載入成功</p>;

/** 正式環境的 lazy 一定包在 ErrorBoundary 下；測試要照抄，錯誤才有人接。 */
class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <p>已攔截</p> : this.props.children; }
}

const mount = (C: React.ComponentType) =>
  render(<Boundary><Suspense fallback={<p>載入中</p>}><C /></Suspense></Boundary>);
const chunkError = () => new Error("Failed to fetch dynamically imported module: /assets/ProjectPage-abc.js");

let replace: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  replace = vi.fn();
  window.sessionStorage.clear();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { href: "https://a.test/project/p-1", replace },
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("lazyWithRetry", () => {
  it("renders normally when the import succeeds", async () => {
    const C = lazyWithRetry(async () => ({ default: Hello }));
    mount(C);
    expect(await screen.findByText("載入成功")).toBeTruthy();
  });

  /** 單純的網路抖動：第二次就成功，使用者不該看到任何錯誤畫面。 */
  it("recovers from a transient chunk failure without reloading", async () => {
    let calls = 0;
    const C = lazyWithRetry(async () => {
      calls += 1;
      if (calls === 1) throw chunkError();
      return { default: Hello };
    });
    mount(C);
    expect(await screen.findByText("載入成功", undefined, { timeout: 3000 })).toBeTruthy();
    expect(calls).toBe(2);
    expect(replace).not.toHaveBeenCalled();
  });

  /** 部署換版後舊 hash 檔消失：重試也救不回來，要繞過快取重載換新的 index.html。 */
  it("forces a cache-busting reload when retries keep failing on a chunk error", async () => {
    const C = lazyWithRetry(async () => { throw chunkError(); });
    mount(C);
    await vi.waitFor(() => expect(replace).toHaveBeenCalledTimes(1), { timeout: 3000 });
    expect(String(replace.mock.calls[0]![0])).toMatch(/_r=\d+/);
  });

  /** 真的壞掉時不能無限重整——重載過一次就放行給 ErrorBoundary 顯示詳情。 */
  it("does not reload twice within the cooldown", async () => {
    window.sessionStorage.setItem("aios.chunkReloadedAt", String(Date.now()));
    const C = lazyWithRetry(async () => { throw chunkError(); });
    mount(C);
    expect(await screen.findByText("已攔截", undefined, { timeout: 3000 })).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
  });

  /** 一般的程式 bug 不是 chunk 問題，不該偷偷重整把 bug 藏起來。 */
  it("never reloads for a non-chunk error", async () => {
    const C = lazyWithRetry(async () => { throw new TypeError("wv.themes.filter is not a function"); });
    mount(C);
    expect(await screen.findByText("已攔截", undefined, { timeout: 3000 })).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
  });
});
