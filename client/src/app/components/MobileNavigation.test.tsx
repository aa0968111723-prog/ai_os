import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { MobileNavigation } from "./MobileNavigation";

describe("MobileNavigation", () => {
  afterEach(() => window.history.replaceState(null, "", "/"));

  it("keeps daily destinations and secondary tools reachable", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/planner");
    render(<MobileNavigation />);

    expect(screen.getByRole("navigation", { name: "主要功能" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "今日" })).toHaveAttribute("href", "/dashboard");
    expect(screen.getByRole("link", { name: "專案" })).toHaveAttribute("href", "/dashboard#projects");
    expect(screen.getByRole("link", { name: "AI 工作" })).toHaveAttribute("href", "/dashboard#ai-work");
    expect(screen.getByRole("link", { name: "排程" })).toHaveAttribute("aria-current", "page");
    await user.click(screen.getByRole("button", { name: "更多" }));
    expect(screen.getByRole("complementary", { name: "更多功能" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /資料庫/ })).toHaveAttribute("href", "/databases");
    expect(screen.getByRole("link", { name: /私訊/ })).toHaveAttribute("href", "/chat");
    expect(screen.getByRole("link", { name: /使用說明/ })).toHaveAttribute("href", "/help");
  });

  it("highlights exactly one dashboard tab per hash（今日／專案／AI 工作互斥）", () => {
    window.history.replaceState(null, "", "/dashboard");
    const { unmount } = render(<MobileNavigation />);
    expect(screen.getByRole("link", { name: "今日" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "專案" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "AI 工作" })).not.toHaveAttribute("aria-current");
    unmount();

    window.history.replaceState(null, "", "/dashboard#projects");
    render(<MobileNavigation />);
    expect(screen.getByRole("link", { name: "專案" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "今日" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "AI 工作" })).not.toHaveAttribute("aria-current");
  });

  it("switches dashboard tabs without a full page reload from other routes", async () => {
    // 帶 hash 的分頁原本是原生 <a>：wouter 不攔，跨 pathname 點擊＝整頁重載
    //（重跑 bootstrap、重抓 chunk）。修正後走 pushState——jsdom 裡若還是原生導航，
    // location 不會變（jsdom 不實作跨頁導航），此斷言就會抓到回歸。
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/planner");
    render(<MobileNavigation />);
    await user.click(screen.getByRole("link", { name: "專案" }));
    expect(window.location.pathname).toBe("/dashboard");
    expect(window.location.hash).toBe("#projects");
  });

  it("keeps 專案 tab active on project detail pages", () => {
    window.history.replaceState(null, "", "/p/some-project-id");
    render(<MobileNavigation />);
    expect(screen.getByRole("link", { name: "專案" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "今日" })).not.toHaveAttribute("aria-current");
  });
});
