import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

  it("points every dashboard hash tab at an anchor that exists", () => {
    // 「AI 工作」曾指向全庫都沒有的 #ai-work：分頁會亮起，但 scrollToAnchorWhenReady
    // 輪詢 3 秒後放棄，畫面完全不動＝另一種「按了沒反應」。錨點是跨檔案契約，
    // 只看 MobileNavigation 看不出壞掉，這裡直接對 Launchpad 的原始碼驗。
    window.history.replaceState(null, "", "/dashboard");
    render(<MobileNavigation />);
    // 註解裡提到的 id 不算數（否則一句說明就能讓斷言恆真）——先把註解剝掉再驗
    const launchpad = readFileSync(resolve(process.cwd(), "client/src/pages/Launchpad.tsx"), "utf8")
      .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");

    const anchors = screen
      .getAllByRole("link")
      .map((link) => link.getAttribute("href") ?? "")
      .filter((href) => href.startsWith("/dashboard#"))
      .map((href) => href.split("#")[1]);

    expect(anchors).toEqual(expect.arrayContaining(["projects", "ai-work"]));
    for (const anchor of anchors) expect(launchpad).toContain(`id="${anchor}"`);
  });

  it("keeps 專案 tab active on project detail pages", () => {
    window.history.replaceState(null, "", "/p/some-project-id");
    render(<MobileNavigation />);
    expect(screen.getByRole("link", { name: "專案" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "今日" })).not.toHaveAttribute("aria-current");
  });
});
