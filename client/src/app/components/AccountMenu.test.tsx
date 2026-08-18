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
            groupId: "00000000-0000-4000-8000-000000000001",
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
  onChangePw: vi.fn(),
  onNotifSettings: vi.fn(),
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

    const trigger = screen.getByRole("button", { name: /Bruce/ });
    await user.click(trigger);
    expect(await screen.findByRole("menu", { name: "使用者選單" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "怎麼用" })).toHaveFocus();

    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "模型指南" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(trigger).toHaveFocus();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("手機上不再重複列一次頁面入口（那些收在底部分頁列的「更多」）", async () => {
    stubViewport(true);
    const user = userEvent.setup();
    render(<AccountMenu {...props} />);

    await user.click(screen.getByRole("button", { name: /Bruce/ }));
    // 去處全歸「更多」面板：帳號選單只剩身分／點數／管理／帳號動作
    expect(screen.queryByRole("menuitem", { name: "怎麼用" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "靈感頻道" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "共用下載" })).not.toBeInTheDocument();
    expect(screen.getByText(/請按最底下的「更多」/)).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /登出$/ })).toBeInTheDocument();
  });

  it("桌機沒有底部分頁列，頁面入口仍留在選單裡", async () => {
    stubViewport(false);
    const user = userEvent.setup();
    render(<AccountMenu {...props} />);

    await user.click(screen.getByRole("button", { name: /Bruce/ }));
    expect(screen.getByRole("menuitem", { name: "怎麼用" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "靈感頻道" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "共用下載" })).toBeInTheDocument();
  });
});
