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
import { buildDecisionInbox, dueLabel, Launchpad, mergeTeamHealth } from "./Launchpad";

/** 泛用 trpc 樁：任何 `trpc.a.b.useQuery()` 都回 queryData 裡以路徑登記的值 */
const h = vi.hoisted(() => {
  const bag: { queryData: Map<string, unknown>; mutations: Array<{ path: string; input: unknown }>; root: Record<string, unknown>; askReply: Record<string, unknown> } =
    { queryData: new Map(), mutations: [], root: {}, askReply: {} };
  const queryData = bag.queryData;
  const mutations = bag.mutations;
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
      useMutation: (opts?: { onSuccess?: (d: unknown) => void }) => ({
        mutate: (input: unknown, callOpts?: { onSuccess?: (d: unknown) => void }) => {
          mutations.push({ path, input });
          const reply = path === "teamAssistant.ask" ? bag.askReply : {};
          void opts?.onSuccess?.(reply);
          void callOpts?.onSuccess?.(reply);
        },
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
  Object.assign(bag, { queryData, mutations, root });
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
  insights?: Record<string, unknown> | null;
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
  if (opts.insights !== null) {
    h.queryData.set("teamAssistant.groupInsights", {
      status: "healthy", activeRuns: 0, waitingRuns: 0, openTasks: 0, overdueTasks: 0,
      recentFailures: 0, unresolvedInformation: 0, risks: 0,
      blockers: [], results: [], workItems: [],
      truncated: { runs: false, tasks: false, results: false, workItems: false },
      byProject: [], people: [], pendingApprovalTasks: [], peopleTruncated: false,
      ...opts.insights,
    });
  }
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

  it("用過代理但收件匣為空 → 說「都清空了」，不是五個 0", () => {
    seed({ runs: [run({ status: "done" })], summary: { hasRuns: true, health: "healthy" }, pending: [] });
    render(<Launchpad groupId={GROUP} />);
    expect(within(inbox()).getByText(/都清空了/)).toBeInTheDocument();
  });

  it("從沒用過代理且收件匣為空 → 引導去起手式，而不是「都清空了」", () => {
    seed({ runs: [], pending: [] });
    render(<Launchpad groupId={GROUP} />);
    expect(within(inbox()).getByText(/挑一個起手式/)).toBeInTheDocument();
    expect(within(inbox()).queryByText(/都清空了/)).not.toBeInTheDocument();
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

describe("S2：人類核准節點與「誰卡住了」", () => {
  beforeEach(() => {
    h.queryData.clear();
    h.mutations.length = 0;
  });

  it("人類核准節點是第四種待裁決來源，可就地核准／退回", async () => {
    seed({
      runs: [],
      insights: {
        openTasks: 2, overdueTasks: 1,
        pendingApprovalTasks: [{
          taskId: "task-9", projectId: "p2", projectTitle: "社課回顧",
          title: "確認旁白稿", dueAt: daysAgo(4), assigneeId: "u1", assigneeName: "阿光", runId: "run-2",
        }],
      },
    });
    render(<Launchpad groupId={GROUP} />);
    const box = within(inbox());
    expect(box.getByText("人員核准")).toBeInTheDocument();
    expect(box.getByText("確認旁白稿")).toBeInTheDocument();
    expect(box.getByText("卡了 4 天")).toBeInTheDocument();

    await userEvent.click(box.getByRole("button", { name: "核准" }));
    expect(h.mutations).toEqual([{ path: "tasks.decideApproval", input: { id: "task-9", decision: "approve" } }]);
    await userEvent.click(box.getByRole("button", { name: "退回" }));
    expect(h.mutations[1]).toEqual({ path: "tasks.decideApproval", input: { id: "task-9", decision: "reject" } });
  });

  it("四種來源一起依卡最久排序（人員核准不會固定黏在某一段）", () => {
    const items = buildDecisionInbox(
      [run({ id: "a", updatedAt: daysAgo(2) })] as never,
      [{ projectId: "p2", projectTitle: "社課回顧", pendingApprovals: 1, awaitingGenerations: 0, oldestPendingApprovalAt: daysAgo(1) }],
      [{ taskId: "t9", projectId: "p2", projectTitle: "社課回顧", title: "確認旁白稿", dueAt: daysAgo(9) }],
    );
    expect(items.map((i) => i.key)).toEqual(["task-t9", "agent-a", "scene-p2"]);
  });

  it("「誰卡住了」把未結任務歸到人與專案；未指派獨立顯示", () => {
    seed({
      runs: [],
      insights: {
        openTasks: 4, overdueTasks: 2,
        people: [
          { userId: "u1", name: "阿光", openTasks: 3, overdueTasks: 2, earliestDueAt: daysAgo(5) },
          { userId: null, name: null, openTasks: 1, overdueTasks: 0, earliestDueAt: null },
        ],
        byProject: [
          { projectId: "p2", projectTitle: "社課回顧", blockers: 3, criticalBlockers: 1, openTasks: 2, overdueTasks: 1, activeRuns: 1 },
        ],
      },
    });
    render(<Launchpad groupId={GROUP} />);
    const stuck = within(screen.getByLabelText("誰卡住了"));
    expect(stuck.getByText("阿光")).toBeInTheDocument();
    expect(stuck.getByText("尚未指派")).toBeInTheDocument();
    expect(stuck.getByText(/3 項・2 逾期/)).toBeInTheDocument();
    expect(stuck.getByText("社課回顧")).toBeInTheDocument();
    expect(stuck.getByText(/1 項嚴重・3 項阻塞/)).toBeInTheDocument();
    expect(stuck.getByText(/4 項人員任務進行中・2 項逾期/)).toBeInTheDocument();
  });

  it("沒有人員任務也沒有阻塞時整段不渲染（空區塊只佔版面）", () => {
    seed({ runs: [], insights: {} });
    render(<Launchpad groupId={GROUP} />);
    expect(screen.queryByLabelText("誰卡住了")).not.toBeInTheDocument();
  });

  it("分析資料被上限截斷時要講出來（否則會被當成全貌）", () => {
    seed({
      runs: [],
      insights: {
        openTasks: 300,
        people: [{ userId: "u1", name: "阿光", openTasks: 300, overdueTasks: 12, earliestDueAt: daysAgo(9) }],
        truncated: { runs: false, tasks: true, results: false, workItems: false },
      },
    });
    render(<Launchpad groupId={GROUP} />);
    expect(within(screen.getByLabelText("誰卡住了")).getByText(/資料量已達分析上限/)).toBeInTheDocument();
  });
});

describe("mergeTeamHealth（代理健康度 ＋ 人員阻塞）", () => {
  it("取較嚴重的一邊，並標記是不是人員面推上去的", () => {
    expect(mergeTeamHealth("healthy", "blocked")).toEqual({ health: "blocked", fromPeople: true });
    expect(mergeTeamHealth("blocked", "healthy")).toEqual({ health: "blocked", fromPeople: false });
    expect(mergeTeamHealth("attention", "attention")).toEqual({ health: "attention", fromPeople: false });
  });

  it("沒發起過計畫但有人員任務逾期 → 不再顯示「尚未啟用」", () => {
    expect(mergeTeamHealth("idle", "blocked")).toEqual({ health: "blocked", fromPeople: true });
    expect(mergeTeamHealth("idle", "healthy")).toEqual({ health: "idle", fromPeople: false });
  });

  it("缺值時當作 healthy（洞察還在載入不該讓徽章亂跳）", () => {
    expect(mergeTeamHealth(undefined, undefined)).toEqual({ health: "healthy", fromPeople: false });
    expect(mergeTeamHealth("attention", undefined)).toEqual({ health: "attention", fromPeople: false });
  });
});

describe("dueLabel（到期日人話，未來與過去都要對）", () => {
  const now = Date.parse("2026-07-30T12:00:00Z");
  it("未來的日期不能講成「N 分鐘前」", () => {
    expect(dueLabel(new Date(now + 2 * 86_400_000), now)).toBe("2 天後到期");
    expect(dueLabel(new Date(now), now)).toBe("今天到期");
    expect(dueLabel(new Date(now - 9 * 86_400_000), now)).toBe("逾期 9 天");
  });
  it("沒有值或無效值回 null（呼叫端不顯示）", () => {
    expect(dueLabel(null, now)).toBeNull();
    expect(dueLabel(undefined, now)).toBeNull();
    expect(dueLabel("不是日期", now)).toBeNull();
  });
});

describe("健康度與人員阻塞不再自相矛盾（實機曾出現：狀態穩定旁列著兩項逾期）", () => {
  beforeEach(() => {
    h.queryData.clear();
    h.mutations.length = 0;
  });

  it("代理面穩定但人員面 blocked → 徽章改為「有阻塞」並指向「誰卡住了」", () => {
    seed({
      runs: [run({ status: "done" })],
      summary: { doneRecent: 1, hasRuns: true, health: "healthy" },
      insights: {
        status: "blocked", openTasks: 3, overdueTasks: 2,
        people: [{ userId: "u1", name: "阿光", openTasks: 2, overdueTasks: 2, earliestDueAt: daysAgo(9) }],
        byProject: [{ projectId: "p1", projectTitle: "招生短片", blockers: 3, criticalBlockers: 2, openTasks: 3, overdueTasks: 2, activeRuns: 0 }],
      },
    });
    render(<Launchpad groupId={GROUP} />);
    expect(screen.getByText("有阻塞")).toBeInTheDocument();
    expect(screen.queryByText("狀態穩定")).not.toBeInTheDocument();
    expect(screen.getByText(/AI 停在那裡等人/)).toBeInTheDocument();
  });
});

describe("S3：代理產出與計畫疑慮", () => {
  beforeEach(() => {
    h.queryData.clear();
    h.mutations.length = 0;
  });

  it("列出代理已產出的東西，每一項都連回產生它的那一步", () => {
    seed({
      runs: [],
      insights: {
        groupResults: [
          { type: "scene", id: "sc-1", label: "第一鏡：法會全景", runId: "run-7", stepId: "s1", projectId: "p1", projectTitle: "招生短片" },
          { type: "note", id: "n-1", label: "訪談重點", runId: "run-8", stepId: "s3", projectId: "p2", projectTitle: "社課回顧" },
        ],
      },
    });
    render(<Launchpad groupId={GROUP} />);
    const box = within(screen.getByLabelText("代理產出與計畫疑慮"));
    expect(box.getByText("2 項")).toBeInTheDocument();
    expect(box.getByText("分鏡")).toBeInTheDocument();
    expect(box.getByText("筆記")).toBeInTheDocument();
    expect(box.getByRole("link", { name: /第一鏡：法會全景/ }))
      .toHaveAttribute("href", "/p/p1?focus=agent-run-run-7");
    expect(box.getByRole("link", { name: /訪談重點/ }))
      .toHaveAttribute("href", "/p/p2?focus=agent-run-run-8");
  });

  it("待補資訊與風險不再只是兩個數字，講得出去哪份計畫處理", () => {
    seed({
      runs: [],
      insights: {
        unresolvedInformation: 3, risks: 1,
        planConcerns: [
          { runId: "run-2", projectId: "p2", projectTitle: "社課回顧", goal: "補一鏡旁白", missingInformation: 2, risks: 1 },
          { runId: "run-1", projectId: "p1", projectTitle: "招生短片", goal: "拆分鏡", missingInformation: 1, risks: 0 },
        ],
      },
    });
    render(<Launchpad groupId={GROUP} />);
    const box = within(screen.getByLabelText("代理產出與計畫疑慮"));
    expect(box.getByText(/待補資訊 3・風險 1/)).toBeInTheDocument();
    expect(box.getByRole("link", { name: /社課回顧｜補一鏡旁白/ }))
      .toHaveAttribute("href", "/p/p2?focus=agent-run-run-2");
    expect(box.getByText("待補 2・風險 1")).toBeInTheDocument();
    expect(box.getByText("待補 1")).toBeInTheDocument();
  });

  it("沒有產出也沒有疑慮時整段不渲染", () => {
    seed({ runs: [], insights: {} });
    render(<Launchpad groupId={GROUP} />);
    expect(screen.queryByLabelText("代理產出與計畫疑慮")).not.toBeInTheDocument();
  });

  it("產出達顯示上限時要講出來（否則會被當成全部產出）", () => {
    seed({
      runs: [],
      insights: {
        groupResults: [{ type: "scene", id: "sc-1", label: "第一鏡", runId: "r1", projectId: "p1", projectTitle: "招生短片" }],
        truncated: { runs: false, tasks: false, results: true, workItems: false },
      },
    });
    render(<Launchpad groupId={GROUP} />);
    expect(within(screen.getByLabelText("代理產出與計畫疑慮")).getByText(/已達顯示上限/)).toBeInTheDocument();
  });
});

describe("S4：空組起手式與派工參數", () => {
  beforeEach(() => {
    h.queryData.clear();
    h.mutations.length = 0;
  });

  const withPlaybooks = () => {
    h.queryData.set("agents.listRoles", {
      roles: [],
      playbooks: [
        { id: "playbook.storyboard.v1", roleId: "role.storyboard", version: 1, title: "分鏡助理", goalTemplate: "把知識庫腳本拆成分鏡", suggestedKinds: [] },
        { id: "playbook.creation.short.v1", roleId: "role.creation", version: 1, title: "快速開拍", goalTemplate: "先出一版可看的成品", suggestedKinds: [] },
        { id: "playbook.director.v1", roleId: "role.director", version: 1, title: "計畫統籌", goalTemplate: "釐清目標與缺資訊", suggestedKinds: [] },
        { id: "playbook.qa.v1", roleId: "role.qa", version: 1, title: "不該出現的第四個", goalTemplate: "x", suggestedKinds: [] },
      ],
    });
  };

  it("從沒用過代理 → 出現三個起手式與專案下拉", () => {
    withPlaybooks();
    seed({ runs: [], pending: [] });
    render(<Launchpad groupId={GROUP} />);
    const box = within(screen.getByLabelText("起手式"));
    expect(box.getByRole("button", { name: /分鏡助理/ })).toBeInTheDocument();
    expect(box.getByRole("button", { name: /快速開拍/ })).toBeInTheDocument();
    expect(box.getByRole("button", { name: /計畫統籌/ })).toBeInTheDocument();
    // 只挑三個，第四個不列（起手式是降低門檻，不是把選擇成本原封不動還回去）
    expect(box.queryByRole("button", { name: /不該出現的第四個/ })).not.toBeInTheDocument();
    expect(box.getByLabelText("要在哪個專案發起")).toBeInTheDocument();
  });

  it("已用過代理就不再佔版面", () => {
    withPlaybooks();
    seed({ runs: [run({ status: "done" })], summary: { hasRuns: true, health: "healthy" } });
    render(<Launchpad groupId={GROUP} />);
    expect(screen.queryByLabelText("起手式")).not.toBeInTheDocument();
  });

  it("按下起手式會帶著 playbookId 派工到選中的專案", async () => {
    withPlaybooks();
    seed({ runs: [], pending: [] });
    render(<Launchpad groupId={GROUP} />);
    const box = within(screen.getByLabelText("起手式"));
    await userEvent.click(box.getByRole("button", { name: /分鏡助理/ }));
    expect(h.mutations).toEqual([{
      path: "teamAssistant.dispatch",
      input: { groupId: GROUP, projectId: "p1", goal: "把知識庫腳本拆成分鏡", playbookId: "playbook.storyboard.v1" },
    }]);
  });

  it("換專案後派工到換過的那個專案", async () => {
    withPlaybooks();
    seed({ runs: [], pending: [] });
    render(<Launchpad groupId={GROUP} />);
    const box = within(screen.getByLabelText("起手式"));
    await userEvent.selectOptions(box.getByLabelText("要在哪個專案發起"), "p2");
    await userEvent.click(box.getByRole("button", { name: /快速開拍/ }));
    expect(h.mutations[0]).toMatchObject({ path: "teamAssistant.dispatch", input: { projectId: "p2" } });
  });

  it("沒有可派的專案時不渲染起手式（避免按了才發現沒地方去）", () => {
    withPlaybooks();
    seed({ runs: [], pending: [] });
    h.queryData.set("projects.list", []);
    render(<Launchpad groupId={GROUP} />);
    expect(screen.queryByLabelText("起手式")).not.toBeInTheDocument();
  });
});

describe("S5：組彙總 AI 的決策軌跡", () => {
  beforeEach(() => {
    h.queryData.clear();
    h.mutations.length = 0;
  });

  /** ask 是 mutation：讓它回一個固定答案，驗畫面怎麼呈現 */
  const askReturning = (reply: Record<string, unknown>) => {
    h.askReply = reply;
  };

  it("顯示依據與用到的上下文標籤（不是 chain-of-thought）", async () => {
    seed({ runs: [], pending: [] });
    askReturning({
      answer: "「招生短片」卡最久。",
      steps: ["查了全組阻塞(2 項)"],
      dispatches: [],
      canDispatch: true,
      rationale: "依阻塞清單，兩件逾期都集中在同一案。",
      contextUsed: ["阻塞與人員負荷", "專案現況"],
      degraded: false,
    });
    render(<Launchpad groupId={GROUP} />);
    await userEvent.type(screen.getByLabelText("組彙總 AI"), "哪個案子卡住了？");
    await userEvent.click(screen.getByRole("button", { name: "詢問" }));
    expect(await screen.findByText(/依據：依阻塞清單/)).toBeInTheDocument();
    expect(screen.getByText("阻塞與人員負荷")).toBeInTheDocument();
    expect(screen.getByText("專案現況")).toBeInTheDocument();
  });

  it("阻塞資料讀不到時明確警示——不講的話這個回答看起來與完整資料下的沒有兩樣", async () => {
    seed({ runs: [], pending: [] });
    askReturning({
      answer: "目前看起來還好。",
      steps: [], dispatches: [], canDispatch: false,
      rationale: undefined, contextUsed: ["專案現況"], degraded: true,
    });
    render(<Launchpad groupId={GROUP} />);
    await userEvent.type(screen.getByLabelText("組彙總 AI"), "有人卡住嗎？");
    await userEvent.click(screen.getByRole("button", { name: "詢問" }));
    expect(await screen.findByText(/沒能讀到阻塞與人員任務資料/)).toBeInTheDocument();
  });

  it("沒有 rationale／contextUsed 時不渲染空殼", async () => {
    seed({ runs: [], pending: [] });
    askReturning({ answer: "簡短回答。", steps: [], dispatches: [], canDispatch: false, contextUsed: [], degraded: false });
    render(<Launchpad groupId={GROUP} />);
    await userEvent.type(screen.getByLabelText("組彙總 AI"), "隨便問問");
    await userEvent.click(screen.getByRole("button", { name: "詢問" }));
    expect(await screen.findByText("簡短回答。")).toBeInTheDocument();
    expect(screen.queryByText(/^依據：/)).not.toBeInTheDocument();
    expect(screen.queryByText(/沒能讀到阻塞/)).not.toBeInTheDocument();
  });
});
