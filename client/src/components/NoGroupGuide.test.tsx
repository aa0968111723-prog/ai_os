/**
 * 未入組引導卡：帳號建好了、但還沒被加進任何組別時顯示。
 *
 * 被釘住的兩件事：
 * 1. 說明「組別是什麼」＋三步驟（拿邀請連結 → 加入 → 回工作台），讓未入組
 *    使用者知道下一步該做什麼（原來的 EmptyState 只有一句「請聯絡組長」）。
 * 2. 「重新檢查」按鈕接到 onRefresh——入組後 refetch auth.me 就能直接進工作台，
 *    不必整頁重整；沒給 onRefresh（載入中）時按鈕停用。
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type React from "react";

vi.mock("wouter", () => ({
  Link: ({ href, children }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children?: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("./BrandLogo", () => ({ BrandLogo: () => null }));

import { NoGroupGuide } from "./NoGroupGuide";

describe("NoGroupGuide：內容與下一步", () => {
  it("說明組別是什麼，並列出三步驟", () => {
    render(<NoGroupGuide />);
    expect(screen.getByText(/一群夥伴共用的工作空間/)).toBeInTheDocument();
    expect(screen.getByText("拿邀請連結")).toBeInTheDocument();
    expect(screen.getByText("開啟連結加入")).toBeInTheDocument();
    expect(screen.getByText("回到工作台")).toBeInTheDocument();
  });

  it("提供「看怎麼用」連結（等待入組時最需要說明）", () => {
    render(<NoGroupGuide />);
    const help = screen.getByRole("link", { name: /看怎麼用/ });
    expect(help).toHaveAttribute("href", "/help");
  });
});

describe("NoGroupGuide：重新檢查", () => {
  it("點「重新檢查」呼叫 onRefresh", async () => {
    const onRefresh = vi.fn();
    render(<NoGroupGuide onRefresh={onRefresh} />);
    await userEvent.click(screen.getByRole("button", { name: /重新檢查/ }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("沒給 onRefresh 時按鈕停用（auth 載入中）", () => {
    render(<NoGroupGuide />);
    expect(screen.getByRole("button", { name: /重新檢查/ })).toBeDisabled();
  });
});
