/**
 * 作業台「AI 工作與團隊分析」卡（S1：待我裁決收件匣＋健康度語意）。
 *
 * 這張卡原本的第一屏是五個計數加一句「目前不需要立即處理的代理阻塞」，
 * 於是新組打開只看得到五個 0——而同一頁其實已經查到分鏡送審／生成待核的筆數。
 * 這裡測的就是那個修法：三種「等人決定」的來源合流、卡最久的排前面、
 * 代理計畫可就地裁決、其餘導去專案頁，以及「沒東西可分析」不再講成「分析結果良好」。
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type React from "react";
import { buildDecisionInbox, Launchpad } from "./Launchpad";

/** 泛用 trpc 樁：任何 `trpc.a.b.useQuery()` 都回 queryData 裡以路徑登記的值 */
const h = vi.hoisted(() => {
  const queryData = new Map<string, unknown>();
  const mutations: Array<{ path: string; input: unknown }> = [];
  let root: Record<string, unknown>;
  const makeNode = (path: string): Record<string, unknown> => {
    const base: Record<string, unknown> = {
      useQuery: () => ({
        data: queryData.get(path),
        isLoading: false,
        isError: false,
        error: null,
        refetch: () => {},
      }),
      useMutation: () => ({
        mutate: (input: unknown) => { mutations.push({ path, input }); },
        mutateAsync: async (input: unknown) => { mutations.push({ path, input }); return {}; },
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
        // toString/valueOf/constructor 等必須維持原樣，否則字串化與相等比較會壞掉
        if (prop === "then" || prop === "toJSON" || prop in Object.prototype) return undefined;
        if (!cache.has(prop)) cache.set(prop, makeNode(path ? `${path}.${prop}` : prop));
        return cache.get(prop);
      },
    }) as Record<string, unknown>;
  };
  root = makeNode("");
  return { queryData, mutations, root };
});

vi.mock("../api", () => ({ trpc: h.root }));

vi.mock("wouter", () => ({
  Link: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children?: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
  useLocation: () => ["/", () => {}],
}));

vi.mock("../components/Icon", () => ({ Icon: () => null }));

/** 真的 ConfirmButton 有二次確認面板；這裡只驗「按下去會呼叫哪支 mutation」 */
vi.mock("../components/interactions", () => ({
  ConfirmButton: ({ children, onConfirm, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { onConfirm?: () => void; children?: React.ReactNode }) => (
    <button type="button" onClick={() => void onConfirm?.()} {...props}>{children}</button>
  ),
}));

vi.mock("../components/FirstRunGuide", () => ({ FirstRunGuide: () => null }));
vi.mock("../components/InstallAppBanner", () => ({ InstallAppBanner: () => null }));

const GROUP = "11111111-1111-4111-8111-111111111111";
const NOW = Date.parse("2026-07-30T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

const run = (over: Partial<Record<string, unknown>> = {}) => ({
  id: "run-1", projectId: "p1", projectTitle: "招生短片", goal: "把腳本拆成分鏡",
  status: "awaiting_approval", doneSteps: 0, totalSteps: 4, estPoints: 12,
  updatedAt: daysAgo(1), userId: "u1", userName: "阿光", error: null, currentStepNote: null,
  ...over,
});

function seed(opts: {
  runs?: Array<Record<string, unknown>>;
  summary?: Record<string, unknown>;
  totalRuns?: number;
  pending?: Array<Record<string, unknown>>;
}) {
  const runs = opts.runs ?? [];
  h.queryData.set("auth.me", {
    user: { id: "u1", name: "阿光" },
    groups: [{ groupId: GROUP, role: "leader" }],
  });
  h.queryData.set("projects.list", [
    { id: "p1", title: "招生短片", kind: "short", ownerId: "u1", status: "active", updatedAt: daysAgo(1) },
    { id: "p2", title: "社課回顧", kind: "short", ownerId: "u1", status: "active", updatedAt: daysAgo(2) },
  ]);
  h.queryData.set("options.byGroup", []);
  h.queryData.set("approvals.pendingSummary", {
    projects: opts.pending ?? [],
    totalPendingApprovals: 0,
    totalAwaitingGenerations: 0,
  });
  h.queryData.set("teamAssistant.agentOverview", {
    runs,
    totalRuns: opts.totalRuns ?? runs.length,
    listLimit: 30,
    summary: {
      running: 0, waiting: 0, awaitingApproval: 0, failedRecent: 0, doneRecent: 0,
      stoppedRecent: 0, active: 0, activeProjects: 0,
      hasRuns: runs.length > 0, health: runs.length > 0 ? "attention" : "idle",
      ...opts.summary,
    },
  });
}

/** 收件匣區塊（用 aria-label 定位，不依賴版面結構） */
const inbox = () => screen.getByLabelText("待我裁決");

describe("buildDecisionInbox（三來源合流純函式）", () => {
  it("只收 awaiting_approval 的代理計畫；其他狀態不是「等人決定」", () => {
    const items = buildDecisionInbox(
      [
        run({ id: "a", status: "awaiting_approval" }),
        run({ id: "b", status: "running" }),
        run({ id: "c", status: "failed" }),
        run({ id: "d", status: "done" }),
      ] as never,
      [],
    );
    expect(items.map((i) => i.key)).toEqual(["agent-a"]);
  });

  it("卡最久的排最前面（跨三種來源一起排）", () => {
    const items = buildDecisionInbox(
      [run({ id: "a", updatedAt: daysAgo(2) })] as never,
      [{
        projectId: "p2", projectTitle: "社課回顧",
        pendingApprovals: 3, awaitingGenerations: 1,
        oldestPendingApprovalAt: daysAgo(9),
        oldestAwaitingGenerationAt: daysAgo(1),
      }],
    );
    expect(items.map((i) => i.key)).toEqual(["scene-p2", "agent-a", "generation-p2"]);
  });

  it("沒有時間戳的排最後，不會插隊到卡最久的前面", () => {
    const items = buildDecisionInbox(
      [] as never,
      [
        { projectId: "p1", projectTitle: "A", pendingApprovals: 1, awaitingGenerations: 0, oldestPendingApprovalAt: null },
        { projectId: "p2", projectTitle: "B", pendingApprovals: 1, awaitingGenerations: 0, oldestPendingApprovalAt: daysAgo(5) },
      ],
    );
    expect(items.map((i) => i.projectId)).toEqual(["p2", "p1"]);
  });

  it("計數為 0 的來源不產生列（避免「0 個分鏡等你裁決」這種鬼待辦）", () => {
    const items = buildDecisionInbox(
      [] as never,
      [{ projectId: "p1", projectTitle: "A", pendingApprovals: 0, awaitingGenerations: 0 }],
    );
    expect(items).toEqual([]);
  });
});

describe("團隊分析卡：待我裁決收件匣", () => {
  beforeEach(() => {
    h.queryData.clear();
    h.mutations.length = 0;
  });

  it("代理計畫、分鏡送審、生成待核三種來源都出現在同一份收件匣", () => {
    seed({
      runs: [run({ updatedAt: daysAgo(3) })],
      summary: { awaitingApproval: 1, active: 1, activeProjects: 1, health: "attention" },
      pending: [{
        projectId: "p2", pendingApprovals: 2, awaitingGenerations: 1,
        oldestPendingApprovalAt: daysAgo(8), oldestAwaitingGenerationAt: daysAgo(1),
      }],
    });
    render(<Launchpad groupId={GROUP} />);
    const box = within(inbox());
    expect(box.getByText("計畫待核")).toBeInTheDocument();
    expect(box.getByText("分鏡送審")).toBeInTheDocument();
    expect(box.getByText("生成待核")).toBeInTheDocument();
    expect(box.getByText("2 個分鏡等你裁決")).toBeInTheDocument();
    expect(box.getByText("1 筆生成等你核准")).toBeInTheDocument();
    expect(box.getByText("3 件")).toBeInTheDocument();
    // 卡最久（8 天）的分鏡排第一
    expect(box.getByText("卡了 8 天")).toBeInTheDocument();
  });

  it("只有代理計畫可就地核准／放棄；分鏡與生成導去專案頁（不看內容不能盲簽）", async () => {
    seed({
      runs: [run()],
      summary: { awaitingApproval: 1, active: 1, health: "attention" },
      pending: [{ projectId: "p2", pendingApprovals: 1, awaitingGenerations: 0, oldestPendingApprovalAt: daysAgo(2) }],
    });
    render(<Launchpad groupId={GROUP} />);
    const box = within(inbox());
    expect(box.getAllByRole("link", { name: "前往處理 →" })).toHaveLength(1);
    await userEvent.click(box.getByRole("button", { name: "核准" }));
    expect(h.mutations).toEqual([{ path: "agents.approve", input: { runId: "run-1" } }]);
    await userEvent.click(box.getByRole("button", { name: "放棄" }));
    expect(h.mutations[1]).toEqual({ path: "agents.discard", input: { runId: "run-1" } });
  });

  it("收件匣為空時說「沒有等你決定的事項」，不是五個 0", () => {
    seed({ runs: [], pending: [] });
    render(<Launchpad groupId={GROUP} />);
    expect(within(inbox()).getByText(/沒有等你決定的事項/)).toBeInTheDocument();
  });

  it("超過上限只列前 6 件，並誠實說明還有幾件", () => {
    seed({
      runs: [],
      pending: Array.from({ length: 8 }, (_, i) => ({
        projectId: `px-${i}`, pendingApprovals: 1, awaitingGenerations: 0,
        oldestPendingApprovalAt: daysAgo(i + 1),
      })),
    });
    render(<Launchpad groupId={GROUP} />);
    const box = within(inbox());
    expect(box.getAllByText(/個分鏡等你裁決/)).toHaveLength(6);
    expect(box.getByText(/還有 2 件/)).toBeInTheDocument();
  });

  it("查不到標題的專案仍會列出（不靜靜吃掉一件待辦）", () => {
    seed({
      runs: [],
      pending: [{ projectId: "99999999-aaaa-bbbb-cccc-dddddddddddd", pendingApprovals: 1, awaitingGenerations: 0, oldestPendingApprovalAt: daysAgo(1) }],
    });
    render(<Launchpad groupId={GROUP} />);
    expect(within(inbox()).getByText("專案 99999999")).toBeInTheDocument();
  });
});

describe("團隊分析卡：健康度語意與筆數誠實度", () => {
  beforeEach(() => {
    h.queryData.clear();
    h.mutations.length = 0;
  });

  it("從沒發起過計畫 → 顯示「尚未啟用」與起手式，而不是「狀態穩定」", () => {
    seed({ runs: [], pending: [] });
    render(<Launchpad groupId={GROUP} />);
    expect(screen.getByText("尚未啟用")).toBeInTheDocument();
    expect(screen.queryByText("狀態穩定")).not.toBeInTheDocument();
    expect(screen.getByText(/還沒有 AI 執行計畫/)).toBeInTheDocument();
  });

  it("有計畫但都靜止 → 顯示「狀態穩定」（與尚未啟用區分）", () => {
    seed({
      runs: [run({ status: "done" })],
      summary: { doneRecent: 1, hasRuns: true, health: "healthy" },
    });
    render(<Launchpad groupId={GROUP} />);
    expect(screen.getByText("狀態穩定")).toBeInTheDocument();
  });

  it("清單被 limit 截斷時，筆數用全組總數並講明只顯示前 30 筆", () => {
    seed({
      runs: [run({ status: "done" })],
      totalRuns: 214,
      summary: { doneRecent: 45, hasRuns: true, health: "healthy" },
    });
    render(<Launchpad groupId={GROUP} />);
    expect(screen.getByText(/（214 筆）/)).toBeInTheDocument();
    expect(screen.getByText(/清單只顯示最近 30 筆（全組共 214 筆）/)).toBeInTheDocument();
  });

  it("近七日有被停止的計畫時會說出來（不再消失在五個數字之間）", () => {
    seed({
      runs: [run({ status: "stopped" })],
      summary: { stoppedRecent: 3, hasRuns: true, health: "healthy" },
    });
    render(<Launchpad groupId={GROUP} />);
    expect(screen.getByText(/近七日另有 3 筆被停止/)).toBeInTheDocument();
  });
});
