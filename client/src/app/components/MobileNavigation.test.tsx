import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MobileNavigation } from "./MobileNavigation";
import { DESTINATIONS, topbarNavItems } from "../navigation/navigationItems";

/** 助手是 lazy 載入的真元件，會打 trpc——整支 api 換成假的（站內慣例）。
 *
 *  面板裡不只有問答：GroupCampaignPanel 也在這張 sheet 內，且同樣 lazy 載入。
 *  它少一支就整棵樹拋 `Cannot read properties of undefined (reading 'useQuery')`，
 *  而且錯誤是在 lazy chunk resolve 之後才丟出來——表現成「面板整個不見」而不是
 *  某個欄位缺值，光看斷言訊息會誤判成 sheet 沒開。teamAssistant 這幾支要補齊。 */
vi.mock("../../api", () => {
  const mutation = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, isSuccess: false, reset: vi.fn(), error: null, data: undefined });
  const query = () => ({ data: undefined, isLoading: false, isPending: false, error: null, refetch: vi.fn() });
  return {
    trpc: {
      useUtils: () => ({}),
      computerRuntime: {
        status: { useQuery: () => ({ data: { enabled: true, browserEnabled: true, browserProvider: "mock", liveExternalWebEnabled: false }, isLoading: false, isPending: false, error: null, refetch: vi.fn(async () => ({ data: { enabled: true, browserEnabled: true, browserProvider: "mock", liveExternalWebEnabled: false } })) }) },
        createSession: { useMutation: mutation },
      },
      // 問答本體已改走 globalAssistant.ask（站級動作提議＋trace）；
      // 確認卡用 runSiteAction 與 teamAssistant 的 dispatch/command
      globalAssistant: {
        conversationState: { useQuery: query },
        ask: { useMutation: mutation },
        submitInteraction: { useMutation: mutation },
        interactionLifecycle: { useMutation: mutation },
        runSiteAction: { useMutation: mutation },
      },
      teamAssistant: {
        ask: { useMutation: mutation },
        dispatch: { useMutation: mutation },
        groupInsights: { useQuery: query },
        agentOverview: { useQuery: query },
        command: { useMutation: mutation },
        commandLevel: { useQuery: query },
        campaigns: { useQuery: query },
        planCampaign: { useMutation: mutation },
        approveCampaign: { useMutation: mutation },
        discardCampaign: { useMutation: mutation },
        stopCampaign: { useMutation: mutation },
        resumeCampaign: { useMutation: mutation },
      },
    },
  };
});

describe("MobileNavigation", () => {
  afterEach(() => window.history.replaceState(null, "", "/"));

  it("keeps a four-item primary bar and still reaches /planner from More", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/planner");
    render(<MobileNavigation />);

    const nav = screen.getByRole("navigation", { name: "主要功能" });
    expect(nav).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "今日" })).toHaveAttribute("href", "/dashboard");
    expect(screen.getByRole("link", { name: "專案" })).toHaveAttribute("href", "/dashboard#projects");
    expect(screen.getByRole("button", { name: "AI 助手" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "更多" })).toBeInTheDocument();
    // 正中央的球不再是導航連結——它開啟全站 AI 助手（見下方專屬案例）
    expect(screen.queryByRole("link", { name: /AI/ })).not.toBeInTheDocument();
    // 筆記排程不再是底欄一級；/planner 改由 More 承接，且 More 必須亮起
    expect(nav.querySelector('a[href="/planner"]')).toBeNull();
    expect(screen.getByRole("button", { name: "更多" })).toHaveClass("active");
    expect(screen.getByRole("link", { name: "今日" })).not.toHaveAttribute("aria-current");
    await user.click(screen.getByRole("button", { name: "更多" }));
    expect(screen.getByRole("complementary", { name: "更多功能" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /資料中心/ })).toHaveAttribute("href", "/databases");
    expect(screen.getByRole("link", { name: /私訊/ })).toHaveAttribute("href", "/chat");
    expect(screen.getByRole("link", { name: /說明中心/ })).toHaveAttribute("href", "/help");
    expect(screen.getByRole("button", { name: /進階工具/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /筆記排程/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /進階工具/ }));
    expect(screen.getByRole("complementary", { name: "進階工具" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /筆記排程/ })).toHaveAttribute("href", "/planner");
    expect(screen.getByRole("link", { name: /筆記排程/ })).toHaveClass("active");
  });

  it("names every destination exactly as the shared catalog does（同一頁不再有第二個名字）", async () => {
    const user = userEvent.setup();
    render(<MobileNavigation />);
    await user.click(screen.getByRole("button", { name: "更多" }));

    // 第一層只留四項；說明中心是連結（含 /models），其餘真功能在進階工具第二層
    expect(screen.getByRole("link", { name: new RegExp(DESTINATIONS.databases.label) })).toHaveAttribute("href", "/databases");
    expect(screen.getByRole("link", { name: new RegExp(DESTINATIONS.chat.label) })).toHaveAttribute("href", "/chat");
    expect(screen.getByRole("link", { name: new RegExp(DESTINATIONS.help.label) })).toHaveAttribute("href", "/help");
    expect(screen.getByRole("button", { name: /進階工具/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /怎麼用/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /筆記排程/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /模型指南/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /進階工具/ }));
    for (const key of ["planner", "studio", "community", "integrations", "mcp", "downloads"] as const) {
      const d = DESTINATIONS[key];
      expect(screen.getByRole("link", { name: new RegExp(d.label) })).toHaveAttribute("href", d.href);
    }
    expect(screen.queryByText("使用說明")).not.toBeInTheDocument();
    expect(screen.queryByText("外部資料")).not.toBeInTheDocument();
  });

  it("★ 頂欄有的去處，手機一定走得到（資料中心曾經三個選單都沒有入口）", async () => {
    // 桌機的高頻入口常駐頂欄，但 `.topbar .topbar-nav-link` 在 ≤820px 整條隱藏，
    // 而使用者選單在同一個斷點只留一句指路（AccountMenu 的 compact 分支）。
    // 也就是說：頂欄的某一項若沒有同時出現在分頁列或「更多」面板，手機上它就
    // 完全沒有入口——資料中心正是這樣消失的。這裡把它鎖成跨檔案契約。
    const user = userEvent.setup();
    render(<MobileNavigation />);
    await user.click(screen.getByRole("button", { name: "更多" }));

    // 今日在底欄；其餘頂欄去處必須能從 More 兩層走到，不能再消失
    expect(screen.getByRole("link", { name: "今日" })).toHaveAttribute("href", "/dashboard");
    const reachable = new Map<string, string>();
    reachable.set(DESTINATIONS.databases.label, DESTINATIONS.databases.href);
    reachable.set(DESTINATIONS.chat.label, DESTINATIONS.chat.href);
    reachable.set(DESTINATIONS.help.label, DESTINATIONS.help.href);
    await user.click(screen.getByRole("button", { name: /進階工具/ }));
    for (const key of ["planner", "studio", "community", "downloads"] as const) {
      reachable.set(DESTINATIONS[key].label, DESTINATIONS[key].href);
    }
    for (const item of topbarNavItems) {
      if (item.key === "dashboard") continue;
      expect(reachable.get(item.label)).toBe(item.href);
    }
  });

  it("More 第一層私訊與底欄都顯示未讀，不再依賴全站浮動氣泡", async () => {
    const user = userEvent.setup();
    render(<MobileNavigation dmUnread={4} />);
    expect(screen.getByRole("button", { name: /更多/ })).toHaveTextContent("有未讀私訊");
    await user.click(screen.getByRole("button", { name: /更多/ }));
    expect(screen.getByLabelText("4 則未讀私訊")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /私訊/ })).toHaveAttribute("href", "/chat");
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

  it("★ U10 視覺回饋契約：按壓要縮、激活要上色、鍵盤彈出時助手 sheet 要抬升", () => {
    // 底部導航的「有反應」由三條跨檔案契約組成：active 縮放（手指一按就看到）、
    // 目前分頁的 primary 色標示、以及鍵盤彈出時（全站 AI 助手 sheet 內有輸入框）
    // 底緣吃 --kb-inset 往上抬——任一條掉了，手機上就是「按了沒回饋」或「輸入框被鍵盤蓋住」。
    // 來自開放 PR #683，不得覆蓋或弱化。
    const css = readFileSync("client/src/styles.css", "utf8");
    // 按壓回饋：active 縮放，配 tap-highlight 透明＋touch-action manipulation（消 300ms 延遲）
    expect(css).toMatch(/\.mobile-nav a:active,\s+\.mobile-nav button:active \{ transform: scale\(.92\); \}/);
    expect(css).toContain("-webkit-tap-highlight-color: transparent");
    expect(css).toContain('button, a, select, summary, [role="button"] { touch-action: manipulation; }');
    // 激活回饋：目前分頁以 primary 色標示
    expect(css).toMatch(/\.mobile-nav a\.active,\s+\.mobile-nav button\.active \{ color: var\(--primary-ink\); background: var\(--primary-tint\); \}/);
    // 鍵盤回饋：手機端助手 sheet 的 bottom 吃 --kb-inset
    expect(css).toMatch(/\.menu-surface\.is-sheet \{[\s\S]*?bottom: var\(--kb-inset, 0px\)/);
    // 四項底欄：不再是五格，觸控高仍 ≥44
    expect(css).toContain("grid-template-columns: repeat(4, 1fr)");
    expect(css).not.toContain("grid-template-columns: repeat(5, 1fr)");
    expect(css).toMatch(/\.mobile-nav a,\s+\.mobile-nav button \{[\s\S]*?min-height: 50px;/);
  });
});
