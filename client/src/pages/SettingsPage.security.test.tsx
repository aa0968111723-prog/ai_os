import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../api", () => ({
  trpc: {
    useUtils: () => ({
      auth: { me: { invalidate: vi.fn() } },
      sessionBoot: { bootstrap: { invalidate: vi.fn() } },
    }),
    auth: {
      me: {
        useQuery: () => ({
          data: {
            user: { name: "阿光", email: "a@example.com", avatarUrl: null },
            groups: [{ groupId: "g1" }],
          },
          isLoading: false,
        }),
      },
      updateProfile: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      setAvatar: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      clearAvatar: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      logoutAll: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    quota: {
      my: {
        useQuery: () => ({
          data: {
            totalRemaining: 80,
            weeklyQuota: 300,
            weeklyUsed: 10,
            dailyQuota: 50,
            dailyUsed: 2,
            memberBudgetRemaining: null,
            groupBudgetRemaining: null,
          },
          isLoading: false,
          error: null,
        }),
      },
    },
    push: { unsubscribe: { useMutation: () => ({ mutateAsync: vi.fn() }) } },
  },
}));

vi.mock("../pwa", () => ({
  canOfferInstall: () => false,
  isIosDevice: () => false,
  isStandaloneApp: () => true,
  promptInstall: vi.fn(),
  subscribeInstallUi: () => () => {},
}));

vi.mock("../platform/desktopBridge", () => ({ hasDesktopBridge: () => false }));

import { SettingsPage } from "./SettingsPage";

describe("SettingsPage 安全與裝置", () => {
  it("承接頭像選單移出的安全動作，並保留點數明細權威入口", () => {
    render(<SettingsPage />);
    expect(screen.getByRole("heading", { name: "點數明細" })).toBeInTheDocument();
    expect(screen.getByText(/目前剩餘/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "改密碼" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "通知設定與裝置連結" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /匯出我的個人資料/ })).toHaveAttribute("href", "/api/me/export");
    expect(screen.getByRole("button", { name: "登出全部裝置" })).toBeInTheDocument();
    expect(screen.queryByText(/請由頂欄右上角的使用者選單/)).not.toBeInTheDocument();
  });
});
