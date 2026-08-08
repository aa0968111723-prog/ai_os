/**
 * 區塊級錯誤邊界：一區掛了不能整頁死。
 *
 * 測試重點不是「降級卡長什麼樣」，而是降級邊界本身的三個承諾：
 * 1. 正常 render 就是無痕包裹（children 原樣出現，頁面上看不出多了一層）
 * 2. 子樹 render 爆掉 → 只顯示該區降級卡，錯誤不往上冒到 window（不碰全站 ErrorBoundary）
 * 3. 降級卡給得出可行動的下一步：重新整理（chunk 失敗是不同文案）
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { SectionErrorBoundary } from "./SectionErrorBoundary";

function Boom({ msg = "boom!" }: { msg?: string }): ReactNode {
  throw new Error(msg);
}

/** 正常子樹：驗證無痕包裹 */
function Fine() {
  return <p>正常內容</p>;
}

beforeEach(() => {
  // 壓掉 React 預期中的 error console 噪音（錯誤邊界「攔下」本來就會印 log）
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("SectionErrorBoundary", () => {
  it("正常時是無痕包裹：children 原樣渲染", () => {
    render(
      <SectionErrorBoundary title="故事">
        <Fine />
      </SectionErrorBoundary>,
    );
    expect(screen.getByText("正常內容")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("子樹 render 錯誤 → 只降級該區，錯誤不冒到 window", () => {
    const onWindowError = vi.fn();
    window.addEventListener("error", onWindowError);
    render(
      <SectionErrorBoundary title="故事">
        <Boom />
      </SectionErrorBoundary>,
    );
    // 降級卡出現，帶區域名稱
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("故事區塊暫時無法顯示")).toBeInTheDocument();
    // 錯誤被邊界攔住：window 沒有收到 uncaught error
    expect(onWindowError).not.toHaveBeenCalled();
    window.removeEventListener("error", onWindowError);
  });

  it("降級卡提供「重新整理」與可回報的錯誤詳情", async () => {
    const user = userEvent.setup();
    // jsdom 的 navigator.clipboard 是唯讀 getter；用 defineProperty 掛 mock
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    render(
      <SectionErrorBoundary title="製作">
        <Boom msg="render 爆了" />
      </SectionErrorBoundary>,
    );
    expect(screen.getByRole("button", { name: "重新整理" })).toBeInTheDocument();
    // 錯誤詳情可展開，看得到可複製的訊息
    await user.click(screen.getByText("錯誤詳情（回報時請附上）"));
    expect(screen.getByText(/render 爆了/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "複製錯誤詳情" }));
    expect(screen.getByText("已複製 ✓")).toBeInTheDocument();
  });

  it("chunk 載入失敗走不同文案（網路不穩）", () => {
    class ChunkBoom extends Error {
      name = "ChunkLoadError";
      constructor() { super("Loading chunk 123 failed"); }
    }
    function BoomChunk(): ReactNode { throw new ChunkBoom(); }
    render(
      <SectionErrorBoundary title="分鏡">
        <BoomChunk />
      </SectionErrorBoundary>,
    );
    expect(screen.getByText("分鏡區塊暫時無法顯示")).toBeInTheDocument();
    expect(screen.getByText(/程式檔沒有載入完成/)).toBeInTheDocument();
  });
});
