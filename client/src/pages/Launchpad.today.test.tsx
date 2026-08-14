/**
 * 今天頁去重契約（全站導覽 PR 2）。
 *
 * 今天頁只回答「我現在先做什麼」：單一下一步、今日安排摘要、一個建立入口。
 * 不再把人送去排程／資料中心／私訊的重複快捷卡。
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type React from "react";
import { Launchpad } from "./Launchpad";

const h = vi.hoisted(() => {
  const bag: {
    queryData: Map<string, unknown>;
    mutations: Array<{ path: string; input: unknown }>;
    root: Record<string, unknown>;
  } = { queryData: new Map(), mutations: [], root: {} };
  let root: Record<string, unknown>;
  const makeNode = (path: string): Record<string, unknown> => {
    const base: Record<string, unknown> = {
      useQuery: () => ({
        data: bag.queryData.get(path),
        isLoading: false,
        isError: false,
        error: null,
        refetch: () => {},
      }),
      useMutation: () => ({
        mutate: (input: unknown) => bag.mutations.push({ path, input }),
        mutateAsync: async (input: unknown) => {
          bag.mutations.push({ path, input });
          return {};
        },
        isPending: false,
        error: null,
        data: undefined,
        reset: () => {},
      }),
      invalidate: () => {},
      useUtils: () => root,
    };
    const cache = new Map<string, Record<string, unknown>>();
    return new Proxy(base, {
      get(target, prop) {
        if (typeof prop !== "string") return Reflect.get(target, prop);
        if (Object.prototype.hasOwnProperty.call(target, prop)) return target[prop];
        if (prop === "then" || prop === "toJSON" || prop in Object.prototype) return undefined;
        if (!cache.has(prop)) cache.set(prop, makeNode(path ? `${path}.${prop}` : prop));
        return cache.get(prop);
      },
    }) as Record<string, unknown>;
  };
  root = makeNode("");
  bag.root = root;
  return bag;
});

vi.mock("../api", () => ({ trpc: h.root }));
vi.mock("wouter", () => ({
  Link: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children?: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
  useLocation: () => ["/", () => {}],
}));
vi.mock("../components/Icon", () => ({ Icon: () => null }));
vi.mock("../components/FirstRunGuide", () => ({ FirstRunGuide: () => null }));
vi.mock("../components/InstallAppBanner", () => ({ InstallAppBanner: () => null }));
vi.mock("../realtime", () => ({
  useCollab: () => ({ connected: false, peers: [], self: null, cursors: [], containerRef: { current: null }, onPointerMove: () => {} }),
  CursorOverlay: () => null,
}));

const GROUP = "11111111-1111-4111-8111-111111111111";

function seed(opts: { schedule?: Array<{ id: string; title: string; startsAt: Date }> } = {}) {
  h.queryData.clear();
  h.mutations.length = 0;
  h.queryData.set("auth.me", {
    user: { id: "u1", name: "阿光" },
    groups: [{ groupId: GROUP, role: "leader", teamName: "弘法團", groupName: "影音組" }],
  });
  h.queryData.set("projects.list", [{
    id: "p1", title: "既有專案", kind: "short", format: "16:9", ownerId: "u1",
    status: "active", updatedAt: new Date().toISOString(), coverAssetId: null, coverUrl: null, myProjectRole: "editor",
  }]);
  h.queryData.set("options.byGroup", []);
  h.queryData.set("generation.pendingSummary", { projects: [], totalAwaitingGenerations: 0 });
  h.queryData.set("teamAssistant.agentOverview", {
    runs: [], totalRuns: 0, listLimit: 30,
    summary: { running: 0, waiting: 0, awaitingApproval: 0, failedRecent: 0, doneRecent: 0, stoppedRecent: 0, active: 0, activeProjects: 0, hasRuns: false, health: "idle" },
  });
  h.queryData.set("schedule.list", { items: opts.schedule ?? [] });
}

describe("今天頁去重", () => {
  beforeEach(() => {
    h.queryData.clear();
    h.mutations.length = 0;
  });

  it("不再出現安排今天／整理資料／聯絡夥伴快捷入口", () => {
    seed();
    render(<Launchpad groupId={GROUP} />);
    expect(screen.queryByRole("navigation", { name: "常用工具" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /安排今天/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /整理資料/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /聯絡夥伴/ })).not.toBeInTheDocument();
  });

  it("只有一個建立新專案入口，且下一步與今日安排都在", () => {
    seed();
    render(<Launchpad groupId={GROUP} />);
    expect(screen.getAllByRole("button", { name: "建立新專案" })).toHaveLength(1);
    expect(screen.getByRole("link", { name: /繼續工作/ })).toHaveAttribute("href", "/p/p1");
    expect(screen.getByRole("heading", { name: "今日安排" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /完整排程/ })).toHaveAttribute("href", "/planner");
  });

  it("今日安排接入既有 schedule.list，並保留 /planner deep link", () => {
    const startsAt = new Date();
    startsAt.setHours(10, 0, 0, 0);
    seed({ schedule: [{ id: "s1", title: "晨會對稿", startsAt }] });
    render(<Launchpad groupId={GROUP} />);
    const item = screen.getAllByRole("link").find((el) => el.getAttribute("href") === "/planner?focus=schedule-s1");
    expect(item).toBeTruthy();
    expect(item).toHaveTextContent("晨會對稿");
  });
});
