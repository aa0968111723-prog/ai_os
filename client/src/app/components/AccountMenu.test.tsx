import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api", () => ({
  trpc: {
    useUtils: () => ({ auth: { me: { invalidate: vi.fn() } } }),
    quota: {
      my: {
        useQuery: () => ({
          data: {
            totalRemaining: 100,
            weeklyQuota: 300,
            weeklyUsed: 12,
            dailyQuota: 50,
            dailyUsed: 3,
            memberBudgetRemaining: null,
            groupBudgetRemaining: null,
          },
          isLoading: false,
          error: null,
        }),
      },
    },
  },
}));

import { AccountMenu } from "./AccountMenu";

const props = {
  userName: "Bruce",
  activeGroupId: "00000000-0000-4000-8000-000000000001",
  isAdmin: false,
  activeIsLeader: false,
  canSeeOrg: false,
  onLogout: vi.fn(),
  loggingOut: false,
};

/** 讓 useMatchMedia／MenuSurface 以為視窗是手機寬度（jsdom 的 matchMedia 一律回 false） */
function stubViewport(compact: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: compact,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
}

describe("AccountMenu", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("moves focus into the menu and returns it on Escape", async () => {
    const user = userEvent.setup();
    render(<AccountMenu {...props} />);

    const trigger = screen.getByRole("button", { name: "Bruce的帳號選單" });
    await user.click(trigger);
    expect(await screen.findByRole("menu", { name: "使用者選單" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /點數/ })).toHaveFocus();

    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "個人設定" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(trigger).toHaveFocus();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("第一層只留身份、點數、設定與登出，不再重複列去處或安全動作", async () => {
    stubViewport(true);
    const user = userEvent.setup();
    render(<AccountMenu {...props} />);

    await user.click(screen.getByRole("button", { name: "Bruce的帳號選單" }));
    expect(screen.getByText("組員")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /點數/ })).toHaveAttribute("href", "/settings#quota");
    expect(screen.getByRole("menuitem", { name: "個人設定" })).toHaveAttribute("href", "/settings");
    expect(screen.getByRole("menuitem", { name: /登出$/ })).toBeInTheDocument();
    expect(screen.queryByText(/請按最底下的「更多」/)).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "怎麼用" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "靈感頻道" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "共用下載" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "改密碼" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /連結手機與電腦/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /匯出我的個人資料/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /登出全部裝置/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "通訊錄" })).not.toBeInTheDocument();
  });

  it("桌機也不再把去處平鋪在頭像第一層（頂欄與更多已承接）", async () => {
    stubViewport(false);
    const user = userEvent.setup();
    render(<AccountMenu {...props} />);

    await user.click(screen.getByRole("button", { name: "Bruce的帳號選單" }));
    expect(screen.queryByRole("menuitem", { name: "怎麼用" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "靈感頻道" })).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "個人設定" })).toBeInTheDocument();
  });

  it("有管理權限才出現管理群組", async () => {
    const user = userEvent.setup();
    render(<AccountMenu {...props} isAdmin canSeeOrg />);
    await user.click(screen.getByRole("button", { name: "Bruce的帳號選單" }));
    expect(screen.getByText("管理員")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "團隊管理" })).toHaveAttribute("href", "/admin");
    expect(screen.getByRole("menuitem", { name: "通訊錄" })).toBeInTheDocument();
  });
});
