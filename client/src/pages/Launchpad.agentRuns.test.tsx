/**
 * 作業台接上 agentOverview 的 runs。
 *
 * 舊行為：Launchpad 只從 agentOverview 取 summary 的三個數字，回傳的 runs 陣列整個丟掉——
 * 使用者看得到「AI 正在處理 3 份計畫」，卻不知道是哪個案、誰的事、失敗的為什麼失敗。
 * 這裡守的是接線本身：runs 有內容就要在首頁看得到並點得進去，正常時不佔版面。
 */
import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type React from "react";
import { Launchpad } from "./Launchpad";

/** 泛用 trpc 樁：任何 `trpc.a.b.useQuery()` 都回 queryData 裡以路徑登記的值 */
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
      useMutation: (opts?: { onSuccess?: (d: unknown) => void }) => ({
        mutate: (input: unknown) => {
          bag.mutations.push({ path, input });
          void opts?.onSuccess?.({});
        },
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

const summary = {
  running: 1, waiting: 0, awaitingApproval: 0, failedRecent: 1, doneRecent: 0,
  stoppedRecent: 0, active: 1, activeProjects: 1, hasRuns: true, health: "attention",
};

function agentRun(over: Record<string, unknown> = {}) {
  return {
    id: "r1",
    projectId: "p1",
    projectTitle: "挑戰營回顧影片",
    goal: "把三支素材剪成一支三分鐘見證",
    status: "running",
    doneSteps: 2,
    totalSteps: 5,
    estPoints: 40,
    updatedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    userId: "u2",
    userName: "阿光",
    error: null,
    currentStepNote: null,
    ...over,
  };
}

function seed(runs: Array<Record<string, unknown>>) {
  h.queryData.clear();
  h.mutations.length = 0;
  h.queryData.set("auth.me", { user: { id: "u1", name: "小敏" }, groups: [{ groupId: GROUP, role: "leader" }] });
  h.queryData.set("projects.list", []);
  h.queryData.set("options.byGroup", []);
  h.queryData.set("generation.pendingSummary", { projects: [], totalAwaitingGenerations: 0 });
  h.queryData.set("teamAssistant.agentOverview", { runs, totalRuns: runs.length, listLimit: 30, summary });
}

describe("作業台：AI 代理執行狀況", () => {
  beforeEach(() => {
    h.queryData.clear();
    h.mutations.length = 0;
  });

  it("agentOverview 回的 runs 會出現在工作台，且點得進對應專案", () => {
    seed([agentRun({ projectId: "p7", currentStepNote: "生成第 2 段旁白" })]);
    render(<Launchpad groupId={GROUP} />);
    const card = screen.getByRole("region", { name: "需要注意的 AI 工作" });
    expect(within(card).getByRole("link")).toHaveAttribute("href", "/p/p7");
    expect(within(card).getByText("目前：生成第 2 段旁白")).toBeInTheDocument();
    expect(card).toHaveTextContent("阿光 發起");
  });

  it("失敗的把錯誤摘要帶到首頁——不必自己去問「怎麼停了」", () => {
    seed([agentRun({ status: "failed", error: "配音模型額度用盡" })]);
    render(<Launchpad groupId={GROUP} />);
    const card = screen.getByRole("region", { name: "需要注意的 AI 工作" });
    expect(within(card).getByText(/失敗原因：配音模型額度用盡/)).toBeInTheDocument();
  });

  it("全部正常時不在工作台佔一張卡", () => {
    seed([agentRun({ status: "done" })]);
    render(<Launchpad groupId={GROUP} />);
    expect(screen.queryByRole("region", { name: "需要注意的 AI 工作" })).toBeNull();
    expect(screen.getByText(/沒有卡住或待你處理的計畫/)).toBeInTheDocument();
  });
});
