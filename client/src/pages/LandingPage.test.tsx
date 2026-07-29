import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LandingPage } from "./LandingPage";

describe("LandingPage", () => {
  it("explains the product and provides one clear login destination", () => {
    render(<LandingPage />);

    expect(screen.getByRole("heading", { level: 1, name: /把想法，變成團隊真正能完成的計畫/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /從一句目標，到可追蹤的完整執行/ })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /登入|進入工作台/ }).every((link) => link.getAttribute("href") === "/login")).toBe(true);
  });

  it("makes trust and agent activity visible without claiming private reasoning", () => {
    render(<LandingPage />);

    expect(screen.getByText(/查得到 AI 使用的專案資料與來源/)).toBeInTheDocument();
    expect(screen.getByText(/重要操作先核准/)).toBeInTheDocument();
    expect(screen.getByLabelText("AI 執行計畫範例")).toHaveTextContent("等待團隊確認");
    expect(document.body.textContent).not.toMatch(/思考過程|chain-of-thought/i);
  });
});
