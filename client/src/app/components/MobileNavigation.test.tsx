import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MobileNavigation } from "./MobileNavigation";
import { DESTINATIONS } from "../navigation/navigationItems";

/** 助手是 lazy 載入的真元件，會打 trpc——整支 api 換成假的（站內慣例） */
/**
 * 全站助手面板會 lazy-load 組代理總指揮面板，而那個元件自帶六支 teamAssistant 查詢
 *（commandLevel／campaigns／planCampaign／approve／discard／stop／resume）。
 *
 * 本檔測的是導航的 aria 契約，campaign 另有專屬測試（GroupCampaignPanel.test.tsx）。
 * 不 stub 的話它會在 Suspense 解析**之後**才炸——而那時本檔的測試早已跑完，
 * 於是 vitest 把這個 unhandled error 記到「當下正在跑的下一個測試檔」頭上：
 * 訊息指向 MobileNavigation、堆疊卻在 GroupCampaignPanel，兩邊單獨跑又都是綠的。
 * 這正是它先前在完整套件下紅、單獨跑卻過的原因。
 */
vi.mock("../../features/group-campaign/GroupCampaignPanel", () => ({
  GroupCampaignPanel: () => <div aria-label="組代理總指揮 stub" />,
}));

vi.mock("../../api", () => {
  const mutation = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, reset: vi.fn(), error: null, data: undefined });
  return {
    trpc: {
      useUtils: () => ({}),
      teamAssistant: { ask: { useMutation: mutation } },
    },
  };
});

describe("MobileNavigation", () => {
  afterEach(() => window.history.replaceState(null, "", "/"));

  it("keeps daily destinations and secondary tools reachable", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/planner");
    render(<MobileNavigation />);

    expect(screen.getByRole("navigation", { name: "主要功能" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "今日" })).toHaveAttribute("href", "/dashboard");
    expect(screen.getByRole("link", { name: "專案" })).toHaveAttribute("href", "/dashboard#projects");
    // 正中央的球不再是導航連結——它開啟全站 AI 助手（見下方專屬案例）
    expect(screen.queryByRole("link", { name: /AI/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "筆記排程" })).toHaveAttribute("aria-current", "page");
    await user.click(screen.getByRole("button", { name: "更多" }));
    expect(screen.getByRole("complementary", { name: "更多功能" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /私訊/ })).toHaveAttribute("href", "/chat");
    expect(screen.getByRole("link", { name: /怎麼用/ })).toHaveAttribute("href", "/help");
  });

  it("names every destination exactly as the shared catalog does（同一頁不再有第二個名字）", async () => {
    const user = userEvent.setup();
    render(<MobileNavigation />);
    await user.click(screen.getByRole("button", { name: "更多" }));

    // 面板收日常會用到的頁面，名稱一律取自 DESTINATIONS（同一頁不得有第二個名字）
    for (const key of ["studio", "community", "chat", "help", "models", "downloads"] as const) {
      const d = DESTINATIONS[key];
      expect(screen.getByRole("link", { name: new RegExp(d.label) })).toHaveAttribute("href", d.href);
    }
    // 資料庫／外部資料／MCP 刻意不在這裡：三者已改為情境化入口
    //（資料在專案頁就地加，進階設定走 /settings 的「進階與相關功能」）。
    // 路由與深連結仍然有效，只是不再出現在手機的頁面總表裡。
    for (const key of ["databases", "mcp", "integrations"] as const) {
      expect(screen.queryByRole("link", { name: new RegExp(DESTINATIONS[key].label) })).not.toBeInTheDocument();
    }
    // 舊的第二套名字不得復活
    expect(screen.queryByText("使用說明")).not.toBeInTheDocument();
    expect(screen.queryByText("外部資料")).not.toBeInTheDocument();
  });

  it("highlights exactly one dashboard tab per hash（今日／專案互斥）", () => {
    window.history.replaceState(null, "", "/dashboard");
    const { unmount } = render(<MobileNavigation />);
    expect(screen.getByRole("link", { name: "今日" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "專案" })).not.toHaveAttribute("aria-current");
    unmount();

    window.history.replaceState(null, "", "/dashboard#projects");
    render(<MobileNavigation />);
    expect(screen.getByRole("link", { name: "專案" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "今日" })).not.toHaveAttribute("aria-current");
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

    expect(anchors).toEqual(expect.arrayContaining(["projects"]));
    for (const anchor of anchors) expect(launchpad).toContain(`id="${anchor}"`);
  });

  it("正中央的球開啟全站 AI 助手，不是導航連結", async () => {
    // 這顆球原本只是 /dashboard#ai-work 的捲動錨點——按下去跳回今日工作台捲到
    // 「繼續創作」那一格（那一格本來就在 dashboard 上，捲一下就到）。
    // 現在它是助手入口：aria 契約要正確，否則讀屏使用者不知道按下去會開東西。
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/planner");
    render(<MobileNavigation groupId="11111111-1111-4111-8111-111111111111" />);

    const orb = screen.getByRole("button", { name: "AI 助手" });
    expect(orb).toHaveAttribute("aria-haspopup", "dialog");
    expect(orb).toHaveAttribute("aria-expanded", "false");
    expect(orb).toHaveAttribute("aria-controls", "global-assistant-sheet");

    await user.click(orb);
    expect(orb).toHaveAttribute("aria-expanded", "true");
    expect(await screen.findByRole("dialog", { name: "AI 助手" })).toBeInTheDocument();
    // 面板上的可見標題與範圍 chip 已改為只留輸入框與感知光；助手的身分與範圍
    // 改由對話框的 aria-label（上一行）承擔，那才是讀屏真正會念的東西。
    expect(await screen.findByLabelText("向 AI 助手提問")).toBeVisible();
  });

  it("沒有選定的組時，助手講清楚為什麼不能用（而不是給一個沒反應的輸入框）", async () => {
    const user = userEvent.setup();
    render(<MobileNavigation groupId="" />);
    await user.click(screen.getByRole("button", { name: "AI 助手" }));
    expect(await screen.findByText(/還沒有選定的組/)).toBeVisible();
  });

  it("keeps 專案 tab active on project detail pages", () => {
    window.history.replaceState(null, "", "/p/some-project-id");
    render(<MobileNavigation />);
    expect(screen.getByRole("link", { name: "專案" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "今日" })).not.toHaveAttribute("aria-current");
  });
});
