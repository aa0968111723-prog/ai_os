import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { MobileNavigation } from "./MobileNavigation";
import { DESTINATIONS } from "../navigation/navigationItems";

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
    expect(screen.getByRole("link", { name: "筆記排程" })).toHaveAttribute("aria-current", "page");
    await user.click(screen.getByRole("button", { name: "更多" }));
    expect(screen.getByRole("complementary", { name: "更多功能" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /資料庫/ })).toHaveAttribute("href", "/databases");
    expect(screen.getByRole("link", { name: /私訊/ })).toHaveAttribute("href", "/chat");
    expect(screen.getByRole("link", { name: /怎麼用/ })).toHaveAttribute("href", "/help");
  });

  it("names every destination exactly as the shared catalog does（同一頁不再有第二個名字）", async () => {
    const user = userEvent.setup();
    render(<MobileNavigation />);
    await user.click(screen.getByRole("button", { name: "更多" }));

    // 面板收全站頁面：使用者選單在手機上不再重複列一次，因此這裡必須齊全
    for (const key of ["community", "databases", "chat", "help", "models", "mcp", "integrations", "downloads"] as const) {
      const d = DESTINATIONS[key];
      expect(screen.getByRole("link", { name: new RegExp(d.label) })).toHaveAttribute("href", d.href);
    }
    // 舊的第二套名字不得復活
    expect(screen.queryByText("使用說明")).not.toBeInTheDocument();
    expect(screen.queryByText("外部資料")).not.toBeInTheDocument();
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

  it("returns to 今日 from a hash tab on the same page", async () => {
    // 停在 /dashboard#projects 時「今日」和其他分頁同 pathname：wouter 的 location
    // 不含 hash，pushState 也不發 hashchange——分頁列因此不重繪，看起來就是「按了沒反應」。
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/dashboard#projects");
    render(<MobileNavigation />);
    await user.click(screen.getByRole("link", { name: "今日" }));

    expect(window.location.pathname).toBe("/dashboard");
    expect(window.location.hash).toBe("");
    expect(screen.getByRole("link", { name: "今日" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "專案" })).not.toHaveAttribute("aria-current");
  });

  it("keeps 專案 tab active on project detail pages", () => {
    window.history.replaceState(null, "", "/p/some-project-id");
    render(<MobileNavigation />);
    expect(screen.getByRole("link", { name: "專案" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "今日" })).not.toHaveAttribute("aria-current");
  });
});
