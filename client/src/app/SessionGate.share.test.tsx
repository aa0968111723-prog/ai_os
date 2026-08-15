/**
 * 分享連結的路由契約：/s/:token 必須在「未登入」時就渲染得出來。
 *
 * 這條路由如果掉進登入分支，外部夥伴點連結會被踢去 /login——功能等於不存在，
 * 而且從程式碼上看不出來（SessionGate 的分支很長）。所以直接對未登入狀態斷言。
 */
import { Suspense } from "react";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../pages/SharedProjectPage", () => ({
  SharedProjectPage: ({ token }: { token: string }) => <div data-testid="shared-page">token:{token}</div>,
}));
vi.mock("../pages/AcceptInvitePage", () => ({ AcceptInvitePage: () => <div /> }));
vi.mock("../pages/DesktopCompanionPage", () => ({ DesktopCompanionPage: () => <div /> }));
vi.mock("../pages/LandingPage", () => ({ LandingPage: () => <div data-testid="landing" /> }));
vi.mock("../pages/LoginPage", () => ({ LoginPage: () => <div data-testid="login" /> }));
vi.mock("./AppRoutes", () => ({
  AppRoutes: () => <div data-testid="app-routes" />,
  UngroupedRoutes: () => <div />,
}));

import { SessionGate } from "./SessionGate";

const props = {
  meLoading: false,
  meError: false,
  onRetry: () => {},
  isAdmin: false,
  activeGroupId: "",
  activeIsLeader: false,
  canSeeOrg: false,
};

const TOKEN = "a".repeat(64);

/**
 * 這三頁（分享檢視／邀請／桌面配對）在 SessionGate 內是 lazy——它們是「一輩子可能
 * 只走一次」的入口，不該躺在每個人的首屏 chunk 裡。正式環境的 Suspense 邊界由
 * AppShell 提供（fallback=RouteFallback），測試這裡補一個等價的，並改用 findBy* 等它到位。
 */
function renderGate(ui: React.ReactElement) {
  return render(<Suspense fallback={<div data-testid="route-loading" />}>{ui}</Suspense>);
}

afterEach(() => window.history.replaceState(null, "", "/"));

describe("SessionGate × 分享連結", () => {
  it("未登入也直接渲染分享頁，不被導去登入", async () => {
    window.history.replaceState(null, "", `/s/${TOKEN}`);
    renderGate(<SessionGate {...props} me={null} />);

    expect(await screen.findByTestId("shared-page")).toHaveTextContent(`token:${TOKEN}`);
    expect(screen.queryByTestId("login")).not.toBeInTheDocument();
  });

  it("session 還在載入時也不卡住——分享頁的憑證是網址，不是 cookie", async () => {
    window.history.replaceState(null, "", `/s/${TOKEN}`);
    renderGate(<SessionGate {...props} me={undefined} meLoading />);

    expect(await screen.findByTestId("shared-page")).toBeInTheDocument();
  });

  it("已登入的人開同一條連結，看到的仍是唯讀分享頁而不是完整專案頁", async () => {
    window.history.replaceState(null, "", `/s/${TOKEN}`);
    renderGate(<SessionGate {...props} me={{ user: { isSuperAdmin: false, mustChangePassword: false }, groups: [{ groupId: "g1", role: "member" }], adminTeamIds: [] }} />);

    expect(await screen.findByTestId("shared-page")).toBeInTheDocument();
    expect(screen.queryByTestId("app-routes")).not.toBeInTheDocument();
  });

  it("其他路由的行為不受影響（未登入仍走登入頁）", () => {
    window.history.replaceState(null, "", "/dashboard");
    render(<SessionGate {...props} me={null} />);

    expect(screen.queryByTestId("shared-page")).not.toBeInTheDocument();
  });
});
