/**
 * 作業台「組代理總指揮」卡（S1：待我裁決收件匣＋健康度語意）。
 *
 * 這張卡原本的第一屏是五個計數加一句「目前不需要立即處理的代理阻塞」，
 * 於是新組打開只看得到五個 0——而同一頁其實已經查到分鏡送審／生成待核的筆數。
 * 這裡測的就是那個修法：三種「等人決定」的來源合流、卡最久的排前面、
 * 代理計畫可就地裁決、其餘導去專案頁，以及「沒東西可分析」不再講成「分析結果良好」。
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type React from "react";
import {
  buildDecisionInbox,
  buildTeamQuestionSuggestions,
  campaignRefetchInterval,
  canDecideRun,
  dueLabel,
  Launchpad,
  mergeTeamHealth,
} from "./Launchpad";

/** 泛用 trpc 樁：任何 `trpc.a.b.useQuery()` 都回 queryData 裡以路徑登記的值 */
const h = vi.hoisted(() => {
  const bag: {
    queryData: Map<string, unknown>;
    mutations: Array<{ path: string; input: unknown }>;
    root: Record<string, unknown>;
    askReply: Record<string, unknown>;
    /** mutateAsync 的回傳值（依 tRPC 路徑登記）：有些畫面會把回傳的人話結果直接顯示出來，
     *  例如指令執行完按鈕換成「✓ 已核准…」。固定回 {} 的話那條路徑永遠測不到。 */
    mutationReply: Map<string, unknown>;
    /** 查詢的「載入中／失敗」狀態（依 tRPC 路徑登記）。
     *  沒有這個的話，所有查詢永遠是「已載入且成功」，於是「查不到時畫面說了什麼謊」
     *  這一整類問題——空手顯示「還沒有計畫」、權限讀不到顯示成沒有權限——一條都測不到。 */
    queryState: Map<string, { isLoading?: boolean; error?: { message: string } }>;
    /** 被按過「再試一次」的查詢路徑：驗重試鈕真的接到那一支查詢，而不是接了個空函式 */
    refetches: string[];
    /** mutation 的錯誤（依 tRPC 路徑登記）：驗「哪一個動作失敗了」有沒有講對。
     *  固定 error: null 的話，四支 mutation 共用一句錯誤訊息的問題永遠測不出來。 */
    mutationError: Map<string, { message: string }>;
    /** 被 reset() 過的 mutation 路徑：tRPC 的 error 會一直留到 reset()，
     *  所以「上一個動作的舊錯誤有沒有清掉」只能從有沒有真的呼叫 reset 來驗。 */
    resets: string[];
    /** 要 reject 的 mutation 與它的錯誤（依路徑）：驗動作有沒有接住 rejection。
     *  永遠 resolve 的話，沒包 try/catch 的按鈕在測試裡看起來一樣正常。
     *  reject 的同時也把錯誤登記進 mutationError，比照 tRPC「失敗後 error 就留著」的行為。 */
    mutationRejects: Map<string, { message: string }>;
  } = {
    queryData: new Map(), mutations: [], root: {}, askReply: {}, mutationReply: new Map(),
    queryState: new Map(), refetches: [], mutationError: new Map(),
    resets: [], mutationRejects: new Map(),
  };
  const queryData = bag.queryData;
  const mutations = bag.mutations;
  let root: Record<string, unknown>;
  const makeNode = (path: string): Record<string, unknown> => {
    const base: Record<string, unknown> = {
      useQuery: () => {
        const st = bag.queryState.get(path);
        return {
          data: queryData.get(path),
          isLoading: st?.isLoading ?? false,
          isError: !!st?.error,
          error: st?.error ?? null,
          refetch: () => { bag.refetches.push(path); },
        };
      },
      useMutation: (opts?: { onSuccess?: (d: unknown) => void }) => ({
        mutate: (input: unknown, callOpts?: { onSuccess?: (d: unknown) => void }) => {
          mutations.push({ path, input });
          const reply = path === "teamAssistant.ask" ? bag.askReply : {};
          void opts?.onSuccess?.(reply);
          void callOpts?.onSuccess?.(reply);
        },
        mutateAsync: async (input: unknown) => {
          mutations.push({ path, input });
          const rejection = bag.mutationRejects.get(path);
          if (rejection) { bag.mutationError.set(path, rejection); throw rejection; }
          return bag.mutationReply.get(path) ?? {};
        },
        isPending: false,
        error: bag.mutationError.get(path) ?? null,
        data: undefined,
        reset: () => { bag.resets.push(path); bag.mutationError.delete(path); },
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
  // 只有 root 是後來才建出來的（makeNode 要先定義），其餘欄位一開始就在 bag 上，寫回去等於原地賦值
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

/** 真的 ConfirmButton 有二次確認面板；這裡只驗「按下去會呼叫哪支 mutation」 */
vi.mock("../components/interactions", () => ({
  ConfirmButton: ({ children, onConfirm, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { onConfirm?: () => void; children?: React.ReactNode }) => (
    <button type="button" onClick={() => void onConfirm?.()} {...props}>{children}</button>
  ),
}));

vi.mock("../components/FirstRunGuide", () => ({ FirstRunGuide: () => null }));
vi.mock("../components/InstallAppBanner", () => ({ InstallAppBanner: () => null }));
// 全組 presence／游標走真的 WebSocket＋react-query client；這支測的是團隊卡內容，
// 不架 QueryClientProvider，比照 ../api 直接換成靜態替身。
vi.mock("../realtime", () => ({
  useCollab: () => ({
    connected: false,
    peers: [],
    self: null,
    cursors: [],
    containerRef: { current: null },
    onPointerMove: () => {},
  }),
  CursorOverlay: () => null,
}));

const GROUP = "11111111-1111-4111-8111-111111111111";
/* NOW 必須取真實現在而非寫死日期：元件用 Date.now() 與 Math.floor 算「卡了 N 天」，
 * 寫死日期的 fixture 每過一天斷言就全部位移（CI 於 2026-07-31 實際紅過一次）。
 * daysAgo(n) 以執行當下為基準，floor 後永遠恰好是 n 天。 */
const NOW = Date.now();
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

/**
 * 把時鐘也釘在 NOW 上。
 *
 * 資料是相對 NOW 造的，但「卡了 N 天」是元件在 render 當下用真實時間算的——兩個基準一分開，
 * 這些斷言就只在 NOW 之後那 24 小時內成立，之後每過一天所有天數就整體 +1（實測 daysAgo(4)
 * 被算成「卡了 5 天」）。這不是偶發的 flake，是會定時引爆、之後永遠紅著的測試。
 * 只假造 Date、不碰計時器：userEvent 與 React 仍需要真的 setTimeout 才能正常運作。
 */
beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterAll(() => {
  vi.useRealTimers();
});

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
  // 載入／失敗狀態預設全清：它會跨測試殘留，而殘留的方向是「上一個測試登記的逾時
  // 讓下一個測試的畫面整塊消失」，那種紅燈查起來會指向完全無關的地方。
  h.queryState.clear();
  h.refetches.length = 0;
  h.mutationError.clear();
  h.resets.length = 0;
  h.mutationRejects.clear();
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
      blockers: [], blockersTotal: 0, results: [], workItems: [],
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

describe("組代理總指揮：待我裁決收件匣", () => {
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

describe("組代理總指揮：健康度語意與筆數誠實度", () => {
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
    // 收合列摘要用「N 筆計畫」；展開後的說明仍講清清單上限
    expect(screen.getByText(/214 筆計畫/)).toBeInTheDocument();
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

describe("S5：組代理總指揮的決策軌跡", () => {
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
    await userEvent.type(screen.getByLabelText("問總指揮"), "哪個案子卡住了？");
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
    await userEvent.type(screen.getByLabelText("問總指揮"), "有人卡住嗎？");
    await userEvent.click(screen.getByRole("button", { name: "詢問" }));
    expect(await screen.findByText(/沒能讀到阻塞與人員任務資料/)).toBeInTheDocument();
  });

  it("沒有 rationale／contextUsed 時不渲染空殼", async () => {
    seed({ runs: [], pending: [] });
    askReturning({ answer: "簡短回答。", steps: [], dispatches: [], canDispatch: false, contextUsed: [], degraded: false });
    render(<Launchpad groupId={GROUP} />);
    await userEvent.type(screen.getByLabelText("問總指揮"), "隨便問問");
    await userEvent.click(screen.getByRole("button", { name: "詢問" }));
    expect(await screen.findByText("簡短回答。")).toBeInTheDocument();
    expect(screen.queryByText(/^依據：/)).not.toBeInTheDocument();
    expect(screen.queryByText(/沒能讀到阻塞/)).not.toBeInTheDocument();
  });
});

describe("就地裁決的權限與專案頁同一條規則", () => {
  beforeEach(() => {
    h.queryData.clear();
    h.mutations.length = 0;
  });

  it("canDecideRun：組長恆可；組員只能裁自己發起的", () => {
    expect(canDecideRun({ ownerId: "someone-else" }, true, "u1")).toBe(true);
    expect(canDecideRun({ ownerId: "u1" }, false, "u1")).toBe(true);
    expect(canDecideRun({ ownerId: "someone-else" }, false, "u1")).toBe(false);
    // 還沒拿到自己的 id 時保守：不給按（寧可多一次點擊，也不要按了才吃 FORBIDDEN）
    expect(canDecideRun({ ownerId: "u1" }, false, undefined)).toBe(false);
    expect(canDecideRun({ ownerId: null }, false, "u1")).toBe(false);
  });

  it("組員看到別人發起的計畫 → 給深連結而不是必定失敗的「核准」鈕", () => {
    seed({
      runs: [run({ userId: "someone-else" })],
      summary: { awaitingApproval: 1, active: 1, health: "attention" },
    });
    h.queryData.set("auth.me", {
      user: { id: "u1", name: "阿光" },
      groups: [{ groupId: GROUP, role: "member" }],
    });
    render(<Launchpad groupId={GROUP} />);
    const box = within(inbox());
    expect(box.queryByRole("button", { name: "核准" })).not.toBeInTheDocument();
    expect(box.getByRole("link", { name: "前往處理 →" })).toBeInTheDocument();
  });

  it("組員看到自己發起的計畫 → 可就地核准", () => {
    seed({
      runs: [run({ userId: "u1" })],
      summary: { awaitingApproval: 1, active: 1, health: "attention" },
    });
    h.queryData.set("auth.me", {
      user: { id: "u1", name: "阿光" },
      groups: [{ groupId: GROUP, role: "member" }],
    });
    render(<Launchpad groupId={GROUP} />);
    expect(within(inbox()).getByRole("button", { name: "核准" })).toBeInTheDocument();
  });
});

describe("阻塞清單截斷時的誠實度", () => {
  beforeEach(() => {
    h.queryData.clear();
    h.mutations.length = 0;
  });

  it("明細被上限截斷、依專案統計是全量時，要把兩個數字的關係講清楚", () => {
    seed({
      runs: [],
      insights: {
        openTasks: 60, overdueTasks: 60,
        blockers: Array.from({ length: 50 }, (_, i) => ({ severity: "warning", type: "overdue_task", label: `逾期 ${i}` })),
        blockersTotal: 71,
        people: [{ userId: "u1", name: "阿光", openTasks: 60, overdueTasks: 60, earliestDueAt: daysAgo(30) }],
        byProject: [{ projectId: "p1", projectTitle: "招生短片", blockers: 71, criticalBlockers: 0, openTasks: 60, overdueTasks: 60, activeRuns: 0 }],
      },
    });
    render(<Launchpad groupId={GROUP} />);
    expect(within(screen.getByLabelText("誰卡住了")).getByText(/共 71 項阻塞（明細只列前 50 項/)).toBeInTheDocument();
  });

  it("沒有截斷時不多嘴", () => {
    seed({
      runs: [],
      insights: {
        openTasks: 2, overdueTasks: 1,
        blockers: [{ severity: "warning", type: "overdue_task", label: "逾期 1" }],
        blockersTotal: 1,
        people: [{ userId: "u1", name: "阿光", openTasks: 2, overdueTasks: 1, earliestDueAt: daysAgo(2) }],
        byProject: [{ projectId: "p1", projectTitle: "招生短片", blockers: 1, criticalBlockers: 0, openTasks: 2, overdueTasks: 1, activeRuns: 0 }],
      },
    });
    render(<Launchpad groupId={GROUP} />);
    expect(within(screen.getByLabelText("誰卡住了")).queryByText(/明細只列前/)).not.toBeInTheDocument();
  });
});

describe("建議問句：問總指揮", () => {
  const S = buildTeamQuestionSuggestions;
  const empty = { runs: [], people: [], planConcerns: [], pending: [] };
  const mkRun = (o: Partial<{ projectId: string; projectTitle: string; status: string; error: string | null; goal: string }>) =>
    ({ projectId: "p1", projectTitle: "招生短片", status: "running", error: null, goal: "拆分鏡", ...o });

  it("不再出現卡片正上方就已經回答的問題", () => {
    const all = S({
      ...empty,
      runs: [mkRun({ status: "failed", error: "供應商逾時" })],
      people: [{ userId: "u1", name: "阿光", openTasks: 3, overdueTasks: 2 }],
      pending: [{ projectTitle: "社課回顧", pendingApprovals: 3, awaitingGenerations: 1 }],
    }).map((s) => s.text).join("\n");
    // 這三句的答案就在「誰卡住了」與「待我裁決」裡，問了只是重述
    expect(all).not.toContain("哪個案子卡住了");
    expect(all).not.toContain("哪些專案有分鏡在等審核");
    expect(all).not.toContain("哪個專案該優先推進");
  });

  it("指名道姓地問，而不是四句對誰都一樣的罐頭問句", () => {
    const out = S({ ...empty, runs: [mkRun({ status: "failed", projectTitle: "招生短片", error: "供應商逾時" })] });
    expect(out[0].text).toContain("「招生短片」");
    expect(out[0].text).toContain("為什麼失敗");
    // tooltip 要講出這句是被什麼觸發的
    expect(out[0].why).toContain("供應商逾時");
  });

  it("依急迫性排序：失敗 → 逾期的人 → 待核成本 → 缺資訊 → 待審內容", () => {
    const out = S({
      runs: [mkRun({ status: "failed", projectId: "pf", projectTitle: "失敗案" })],
      people: [{ userId: "u1", name: "阿光", openTasks: 3, overdueTasks: 2 }],
      planConcerns: [{ projectTitle: "缺資訊案", missingInformation: 2, risks: 0 }],
      pending: [{ projectTitle: "待審案", pendingApprovals: 3, awaitingGenerations: 1 }],
    });
    expect(out.map((s) => s.id)).toEqual(["failed:pf", "person:u1", "gen:待審案", "concern:缺資訊案"]);
    expect(out).toHaveLength(4);
  });

  it("未指派的逾期任務講成「沒人認領」，不會顯示成 null", () => {
    const out = S({ ...empty, people: [{ userId: null, name: null, openTasks: 1, overdueTasks: 1 }] });
    expect(out[0].text).toContain("沒人認領的任務");
    expect(out[0].text).not.toContain("null");
  });

  it("組很安靜時給通用的深入問題，不會空手", () => {
    const out = S(empty);
    expect(out).toHaveLength(3);
    expect(out.every((s) => s.id.startsWith("fallback:"))).toBe(true);
    expect(out[0].text).toContain("優先推進哪個案子");
    expect(out[0].why).toContain("沒有需要追問的異常");
  });

  it("兜底句是補位時，tooltip 不會謊稱「沒有異常」（同排第一句明明就指出了異常）", () => {
    const out = S({ ...empty, pending: [{ projectTitle: "招生短片", pendingApprovals: 3, awaitingGenerations: 0 }] });
    expect(out[0].id).toBe("scene:招生短片");
    const filler = out.find((s) => s.id.startsWith("fallback:"))!;
    expect(filler.why).toContain("上面幾句才是針對這個組現在的狀況");
    expect(filler.why).not.toContain("沒有");
  });

  it("狀態很多時不超過 4 句（不變成另一種選項牆）", () => {
    const out = S({
      runs: [mkRun({ status: "failed", projectId: "pf" }), mkRun({ status: "running", projectId: "pr" })],
      people: [
        { userId: "u1", name: "阿光", openTasks: 3, overdueTasks: 2 },
        { userId: "u2", name: "小美", openTasks: 2, overdueTasks: 1 },
      ],
      planConcerns: [{ projectTitle: "A", missingInformation: 2, risks: 1 }],
      pending: [{ projectTitle: "B", pendingApprovals: 3, awaitingGenerations: 2 }],
    });
    expect(out).toHaveLength(4);
    expect(new Set(out.map((s) => s.id)).size).toBe(4);
  });

  it("沒有逾期的人不會被拿來當建議（只挑真的有異常的）", () => {
    const out = S({ ...empty, people: [{ userId: "u1", name: "阿光", openTasks: 5, overdueTasks: 0 }] });
    expect(out.every((s) => !s.id.startsWith("person:"))).toBe(true);
  });
});

describe("組代理總指揮入口一體化", () => {
  beforeEach(() => {
    h.queryData.clear();
    h.mutations.length = 0;
  });

  it("外層叫「組代理總指揮」，不再嵌「團隊分析／全組代理」第二套標題", () => {
    seed({ runs: [], pending: [] });
    render(<Launchpad groupId={GROUP} />);
    expect(screen.getByRole("heading", { name: "組代理總指揮" })).toBeInTheDocument();
    expect(document.querySelector('[data-fb="組代理總指揮"]')).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "團隊分析" })).not.toBeInTheDocument();
    expect(screen.queryByText("全組代理")).not.toBeInTheDocument();
    expect(screen.getByText(/裁決待辦、看誰卡住、跨專案調度、派工與追問/)).toBeInTheDocument();
  });

  it("標籤與說明講清楚它的職責是「鑽進去查」，不是覆述儀表板", () => {
    seed({ runs: [], pending: [] });
    render(<Launchpad groupId={GROUP} />);
    expect(screen.getByLabelText("問總指揮")).toBeInTheDocument();
    expect(screen.getByText(/現況看數字；這裡鑽進分鏡全文、生成紀錄/)).toBeInTheDocument();
  });

  it("誰卡住／執行計畫合在「全組現況」同一個收合區", () => {
    seed({
      runs: [run({ status: "running" })],
      summary: { running: 1, active: 1, hasRuns: true, health: "attention" },
      insights: {
        openTasks: 2, overdueTasks: 1,
        people: [{ userId: "u1", name: "阿光", openTasks: 2, overdueTasks: 1, earliestDueAt: daysAgo(2) }],
        byProject: [{ projectId: "p1", projectTitle: "招生短片", blockers: 1, criticalBlockers: 0, openTasks: 2, overdueTasks: 1, activeRuns: 1 }],
        blockers: [{ severity: "warning", type: "overdue_task", label: "逾期 1" }],
        blockersTotal: 1,
      },
    });
    render(<Launchpad groupId={GROUP} />);
    expect(screen.getByRole("button", { name: /全組現況/ })).toBeInTheDocument();
    expect(screen.getByLabelText("誰卡住了")).toBeInTheDocument();
    expect(screen.getByLabelText("執行計畫")).toBeInTheDocument();
    expect(screen.queryByText("組執行計畫動態")).not.toBeInTheDocument();
  });

  it("建議問句會指名真實的專案（證明它讀了這個組的資料）", () => {
    seed({
      runs: [run({ status: "failed", projectTitle: "招生短片", error: "供應商逾時" })],
      summary: { failedRecent: 1, hasRuns: true, health: "attention" },
    });
    render(<Launchpad groupId={GROUP} />);
    const btn = screen.getByRole("button", { name: /「招生短片」的代理為什麼失敗/ });
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveAttribute("title", expect.stringContaining("供應商逾時"));
  });

  it("點建議問句只帶入輸入框，不會直接送出（免費但仍是使用者按下才問）", async () => {
    seed({
      runs: [run({ status: "failed", projectTitle: "招生短片", error: "供應商逾時" })],
      summary: { failedRecent: 1, hasRuns: true, health: "attention" },
    });
    render(<Launchpad groupId={GROUP} />);
    await userEvent.click(screen.getByRole("button", { name: /為什麼失敗/ }));
    expect(screen.getByLabelText("問總指揮"))
      .toHaveValue("「招生短片」的代理為什麼失敗？要改什麼才不會再失敗？");
    expect(h.mutations.filter((m) => m.path === "teamAssistant.ask")).toHaveLength(0);
  });
});

/* ────────────────────────────────────────────────────────────────
   L3 跨專案調度（TeamCommanderBlock）

   這一區與卡片其他區塊的差別是它會「自己下令」：核准子計畫、花點、改人員任務。
   所以測的重點不是版面好不好看，而是三件會出事的事——
   沒權限的人不該看到入口、按鈕不該出現在錯的狀態、提議送出去的形狀不能被前端動過。
   ──────────────────────────────────────────────────────────────── */

/** 總指揮區塊（用 aria-label 定位，不依賴版面結構） */
const commander = () => screen.getByLabelText("跨專案調度");

/** 一份典型的組級調度計畫：四步、已完成一步、等在人工關卡 */
const campaign = (over: Partial<Record<string, unknown>> = {}) => ({
  id: "camp-1",
  groupId: GROUP,
  userId: "u1",
  goal: "把三個待審的案子推到可交付",
  summary: "先派兩案、盯著子計畫、卡住就找人",
  status: "awaiting_approval",
  budgetPoints: 100,
  spentPoints: 0,
  error: null,
  steps: [
    { id: "s1", kind: "dispatch", title: "在招生短片開一份分鏡計畫", note: "", status: "done", result: "已建立" },
    { id: "s2", kind: "watch", title: "盯著分鏡計畫", note: "", status: "running" },
    { id: "s3", kind: "wait_for_human", title: "等阿光確認旁白", note: "", status: "waiting" },
    { id: "s4", kind: "report", title: "回報結論", note: "", status: "pending" },
  ],
  createdAt: daysAgo(1),
  updatedAt: daysAgo(0),
  ...over,
});

/**
 * 在既有 seed 之上補「我的指令等級」與「這個組的調度計畫」。
 *
 * levelState／campaignsState 讓測試能演出「查詢還在跑」與「查詢失敗」——
 * 這一區最貴的兩個謊（把載入中講成「還沒有計畫」、把讀不到權限講成「沒有權限」）
 * 只有在那兩種狀態下才看得到。
 */
function seedCommander(opts: {
  level?: string;
  campaigns?: Array<Record<string, unknown>>;
  levelState?: { isLoading?: boolean; error?: { message: string } };
  campaignsState?: { isLoading?: boolean; error?: { message: string } };
  /** 我在這個組的角色（預設組長）：組員只動得了自己發起的調度計畫 */
  role?: "leader" | "member";
  myUserId?: string;
}) {
  seed({ runs: [], pending: [] });
  if (opts.role === "member") {
    h.queryData.set("auth.me", {
      user: { id: opts.myUserId ?? "u1", name: "阿光" },
      groups: [{ groupId: GROUP, role: "member" }],
    });
  } else if (opts.myUserId) {
    h.queryData.set("auth.me", {
      user: { id: opts.myUserId, name: "阿光" },
      groups: [{ groupId: GROUP, role: "leader" }],
    });
  }
  if (opts.level !== undefined) h.queryData.set("teamAssistant.commandLevel", opts.level);
  h.queryData.set("teamAssistant.campaigns", opts.campaigns ?? []);
  if (opts.levelState) h.queryState.set("teamAssistant.commandLevel", opts.levelState);
  if (opts.campaignsState) h.queryState.set("teamAssistant.campaigns", opts.campaignsState);
}

describe("L3 跨專案調度：誰看得到、什麼狀態給什麼鈕", () => {
  beforeEach(() => {
    h.queryData.clear();
    h.mutations.length = 0;
    h.mutationReply.clear();
  });

  it.each(["none", "dispatch"])(
    "指令等級 %s 又沒有任何計畫 → 整塊不渲染（不給一塊按不動的空框佔版面）",
    (level) => {
      seedCommander({ level });
      render(<Launchpad groupId={GROUP} />);
      expect(screen.queryByLabelText("跨專案調度")).not.toBeInTheDocument();
    },
  );

  it("沒有發起權但組內已有計畫 → 仍要看得到（別人下的令不能對這個人隱形）", () => {
    seedCommander({ level: "supervise", campaigns: [campaign({ status: "running" })] });
    render(<Launchpad groupId={GROUP} />);
    const box = within(commander());
    expect(box.getByText("執行中")).toBeInTheDocument();
    // 看得到不等於發得動：沒有 command 等級就不給「排調度計畫」的入口
    expect(box.queryByLabelText("要組代理達成什麼")).not.toBeInTheDocument();
    expect(box.queryByRole("button", { name: "排調度計畫" })).not.toBeInTheDocument();
  });

  it("有 command 等級 → 出現「排調度計畫」表單；目標不足 5 字時按鈕按不下去", async () => {
    seedCommander({ level: "command" });
    render(<Launchpad groupId={GROUP} />);
    const box = within(commander());
    const goal = box.getByLabelText("要組代理達成什麼");
    const btn = box.getByRole("button", { name: "排調度計畫" });
    // 空目標：後端 zod 也會擋，但讓人按下去才吃錯誤是白跑一趟
    expect(btn).toBeDisabled();
    await userEvent.type(goal, "推四案");
    expect(btn).toBeDisabled();
    await userEvent.type(goal, "到可交付");
    expect(btn).toBeEnabled();
  });

  it("填了目標與授權後送出的就是那兩個值（授權 0 以外的數字不能在路上被吃掉）", async () => {
    seedCommander({ level: "command" });
    render(<Launchpad groupId={GROUP} />);
    const box = within(commander());
    await userEvent.type(box.getByLabelText("要組代理達成什麼"), "把三個待審的案子推到可交付");
    await userEvent.clear(box.getByLabelText("自動核准授權（點）"));
    await userEvent.type(box.getByLabelText("自動核准授權（點）"), "250");
    await userEvent.click(box.getByRole("button", { name: "排調度計畫" }));
    expect(h.mutations).toEqual([{
      path: "teamAssistant.planCampaign",
      input: { groupId: GROUP, goal: "把三個待審的案子推到可交付", budgetPoints: 250 },
    }]);
  });

  it("待核准：列出狀態、進度與已自動核准點數，並給核准／放棄（還沒開跑就不該有「停止」）", async () => {
    seedCommander({ level: "command", campaigns: [campaign()] });
    render(<Launchpad groupId={GROUP} />);
    const box = within(commander());
    expect(box.getByText("待核准")).toBeInTheDocument();
    // skipped 不算在分母；這份四步都要做，所以是 1/4。
    // 兩個點數都要帶「估」：它們是估點不是實扣，這一區曾是全卡唯一沒標的地方。
    expect(box.getByText("1/4 步・已自動核准 估 0 點／授權 估 100 點")).toBeInTheDocument();

    await userEvent.click(box.getByRole("button", { name: "核准" }));
    expect(h.mutations).toEqual([{ path: "teamAssistant.approveCampaign", input: { runId: "camp-1" } }]);
    await userEvent.click(box.getByRole("button", { name: "放棄" }));
    expect(h.mutations[1]).toEqual({ path: "teamAssistant.discardCampaign", input: { runId: "camp-1" } });
    expect(box.queryByRole("button", { name: "停止" })).not.toBeInTheDocument();
  });

  it("執行中：只給停止——核准／放棄出現在這裡等於讓人重按一份已經在花點的計畫", () => {
    seedCommander({ level: "command", campaigns: [campaign({ status: "running", spentPoints: 30 })] });
    render(<Launchpad groupId={GROUP} />);
    const box = within(commander());
    expect(box.getByText("1/4 步・已自動核准 估 30 點／授權 估 100 點")).toBeInTheDocument();
    expect(box.getByRole("button", { name: "停止" })).toBeInTheDocument();
    expect(box.queryByRole("button", { name: "核准" })).not.toBeInTheDocument();
    expect(box.queryByRole("button", { name: "放棄" })).not.toBeInTheDocument();
    expect(box.queryByRole("button", { name: /^繼續/ })).not.toBeInTheDocument();
  });

  it("等待人員：給「繼續」與加授權輸入框，送出時把加的點數一起帶上", async () => {
    seedCommander({ level: "command", campaigns: [campaign({ status: "waiting", spentPoints: 100 })] });
    render(<Launchpad groupId={GROUP} />);
    const box = within(commander());
    expect(box.getByText("等待人員")).toBeInTheDocument();
    const add = box.getByLabelText(/加多少自動核准授權/);
    await userEvent.clear(add);
    await userEvent.type(add, "40");
    await userEvent.click(box.getByRole("button", { name: /^繼續/ }));
    expect(h.mutations).toEqual([{
      path: "teamAssistant.resumeCampaign",
      input: { runId: "camp-1", addBudgetPoints: 40 },
    }]);
  });

  it("等待人員也還能停止（卡在人工關卡的計畫本來就該收得掉）", () => {
    seedCommander({ level: "command", campaigns: [campaign({ status: "waiting" })] });
    render(<Launchpad groupId={GROUP} />);
    expect(within(commander()).getByRole("button", { name: "停止" })).toBeInTheDocument();
  });

  it("已結束的計畫不再給任何動作鈕（完成的計畫按「繼續」只會吃 PRECONDITION_FAILED）", () => {
    seedCommander({ level: "command", campaigns: [campaign({ status: "done", spentPoints: 88 })] });
    render(<Launchpad groupId={GROUP} />);
    const box = within(commander());
    expect(box.getByText("完成")).toBeInTheDocument();
    for (const name of ["核准", "放棄", "停止"]) {
      expect(box.queryByRole("button", { name })).not.toBeInTheDocument();
    }
    expect(box.queryByRole("button", { name: /^繼續/ })).not.toBeInTheDocument();
  });

  it("點目標可展開步驟；每一步帶著種類與狀態 class（樣式靠這個分色，狀態錯就看不出哪一步炸了）", async () => {
    seedCommander({
      level: "command",
      campaigns: [campaign({
        status: "running",
        steps: [
          { id: "s1", kind: "dispatch", title: "在招生短片開一份分鏡計畫", note: "", status: "done", result: "已建立" },
          { id: "s2", kind: "watch", title: "盯著分鏡計畫", note: "", status: "failed", error: "子計畫重試三次仍失敗" },
          { id: "s3", kind: "wait_for_human", title: "等阿光確認旁白", note: "", status: "waiting" },
          { id: "s4", kind: "report", title: "回報結論", note: "", status: "skipped" },
        ],
      })],
    });
    render(<Launchpad groupId={GROUP} />);
    const box = within(commander());
    // 沒展開前不該把整份步驟攤在列表裡（一組計畫十二步會把卡片洗版）
    expect(box.queryByText(/派工｜在招生短片開一份分鏡計畫/)).not.toBeInTheDocument();

    await userEvent.click(box.getByRole("button", { name: "把三個待審的案子推到可交付" }));
    expect(box.getByText("派工｜在招生短片開一份分鏡計畫——已建立")).toHaveClass("team-commander__step", "is-done");
    expect(box.getByText("盯進度｜盯著分鏡計畫——子計畫重試三次仍失敗")).toHaveClass("team-commander__step", "is-failed");
    expect(box.getByText("等待人員｜等阿光確認旁白")).toHaveClass("team-commander__step", "is-waiting");
    expect(box.getByText("結論｜回報結論")).toHaveClass("team-commander__step", "is-skipped");
    // skipped 不算分母：三步要做、一步已完成
    expect(box.getByText("1/3 步・已自動核准 估 0 點／授權 估 100 點")).toBeInTheDocument();
  });
});

/* ────────────────────────────────────────────────────────────────
   總指揮區塊的「畫面不准說謊」：載入中／載入失敗／權限讀不到／多份計畫互不干擾。

   這一整組測的都是同一件事——當程式其實不知道答案時，畫面有沒有假裝知道。
   每一條後面都跟著一筆真的會發生的損失（雙倍派工、授權加錯份、按了必失敗的鈕）。
   ──────────────────────────────────────────────────────────────── */
describe("L3 跨專案調度：載入中與載入失敗不能長成「還沒有計畫」", () => {
  beforeEach(() => {
    h.queryData.clear();
    h.mutations.length = 0;
    h.mutationReply.clear();
    h.queryState.clear();
    h.refetches.length = 0;
  });

  it("調度計畫還在載入 → 說「載入中」，不准說「還沒有組代理調度計畫」", () => {
    // 空手講成「還沒有」的實際後果：其實有一份 running 的計畫正在派工，
    // 組長據此重排第二份，兩份同時對同一批專案派工又各自自動核准 → 點數雙倍支出。
    seedCommander({ level: "command", campaignsState: { isLoading: true } });
    render(<Launchpad groupId={GROUP} />);
    const box = within(commander());
    expect(box.getByText(/調度計畫載入中/)).toBeInTheDocument();
    expect(box.queryByText(/還沒有組代理調度計畫/)).not.toBeInTheDocument();
  });

  it("調度計畫載入失敗 → 說失敗並給「再試一次」，重試真的接到那支查詢", async () => {
    seedCommander({ level: "command", campaignsState: { error: { message: "逾時" } } });
    render(<Launchpad groupId={GROUP} />);
    const box = within(commander());
    expect(box.getByRole("alert")).toHaveTextContent(/調度計畫載入失敗/);
    expect(box.queryByText(/還沒有組代理調度計畫/)).not.toBeInTheDocument();
    await userEvent.click(box.getByRole("button", { name: "再試一次" }));
    expect(h.refetches).toContain("teamAssistant.campaigns");
  });

  it("沒有發起權、但計畫清單還在載入 → 整塊不准消失（消失＝謊稱這組什麼都沒有）", () => {
    seedCommander({ level: "none", campaignsState: { isLoading: true } });
    render(<Launchpad groupId={GROUP} />);
    expect(within(commander()).getByText(/調度計畫載入中/)).toBeInTheDocument();
  });

  it("指揮權還在查 → 講「正在確認權限」，不是無聲消失也不是假裝沒有權限", () => {
    seedCommander({ levelState: { isLoading: true }, campaigns: [] });
    render(<Launchpad groupId={GROUP} />);
    const box = within(commander());
    expect(box.getByText(/正在確認你的指揮權限/)).toBeInTheDocument();
    // 還沒確認完就不給發起入口（給了才是真的危險）
    expect(box.queryByRole("button", { name: "排調度計畫" })).not.toBeInTheDocument();
  });

  it("指揮權查詢失敗 → 明講「不代表你沒有權限」，並能重試", async () => {
    seedCommander({ levelState: { error: { message: "500" } }, campaigns: [] });
    render(<Launchpad groupId={GROUP} />);
    const box = within(commander());
    expect(box.getByText(/這不代表你沒有權限/)).toBeInTheDocument();
    await userEvent.click(box.getByRole("button", { name: "再試一次" }));
    expect(h.refetches).toContain("teamAssistant.commandLevel");
  });

  it("兩者都載完、確實沒權限也沒計畫 → 才可以整塊收掉", () => {
    seedCommander({ level: "none", campaigns: [] });
    render(<Launchpad groupId={GROUP} />);
    expect(screen.queryByLabelText("跨專案調度")).not.toBeInTheDocument();
  });
});

describe("L3 跨專案調度：加授權輸入框以計畫為單位（跨列共用會把點數加到別份計畫上）", () => {
  beforeEach(() => {
    h.queryData.clear();
    h.mutations.length = 0;
    h.mutationReply.clear();
    h.queryState.clear();
  });

  const twoWaiting = () => [
    campaign({ id: "camp-1", goal: "把三個待審的案子推到可交付", status: "waiting" }),
    campaign({ id: "camp-2", goal: "補齊社課回顧的旁白", status: "waiting" }),
  ];

  it("在 A 列輸入的點數不會出現在 B 列，送出的也是 A 的數字", async () => {
    seedCommander({ level: "command", campaigns: twoWaiting() });
    render(<Launchpad groupId={GROUP} />);
    const box = within(commander());
    const addA = box.getByLabelText(/為「把三個待審的案子推到/);
    const addB = box.getByLabelText(/為「補齊社課回顧的旁白/);
    await userEvent.clear(addA);
    await userEvent.type(addA, "200");
    // B 那格必須原封不動——共用 state 時它會跟著變成 200，按下 B 就是白送 200 點授權
    expect(addB).toHaveValue(0);

    await userEvent.click(box.getByRole("button", { name: /^繼續執行「補齊社課回顧的旁白」/ }));
    expect(h.mutations).toEqual([{
      path: "teamAssistant.resumeCampaign",
      input: { runId: "camp-2", addBudgetPoints: 0 },
    }]);
  });

  it("按鈕點名是哪一份調度計畫（一排同名的「繼續」等於逼人靠位置猜）", async () => {
    seedCommander({ level: "command", campaigns: twoWaiting() });
    render(<Launchpad groupId={GROUP} />);
    const box = within(commander());
    const addA = box.getByLabelText(/為「把三個待審的案子推到/);
    await userEvent.clear(addA);
    await userEvent.type(addA, "200");
    // 可見文字與無障礙名稱都要帶著那份計畫的目標與加了幾點
    const btnA = box.getByRole("button", { name: /^繼續執行「把三個待審的案子推到/ });
    expect(btnA).toHaveAccessibleName(/加授權 估 200 點$/);
    expect(btnA).toHaveTextContent(/^繼續「把三個待審的案子推到/);
    expect(btnA).toHaveTextContent("（+估 200 點）");
    await userEvent.click(btnA);
    expect(h.mutations).toEqual([{
      path: "teamAssistant.resumeCampaign",
      input: { runId: "camp-1", addBudgetPoints: 200 },
    }]);
  });
});

describe("L3 跨專案調度：停止／放棄照後端「發起人或組長以上」露出", () => {
  beforeEach(() => {
    h.queryData.clear();
    h.mutations.length = 0;
    h.mutationReply.clear();
    h.queryState.clear();
  });

  it("組員看別人發起的計畫：不給停止／放棄（按下去只會吃 FORBIDDEN，看起來像系統壞掉）", () => {
    seedCommander({
      level: "command",
      role: "member",
      myUserId: "u9",
      campaigns: [campaign({ status: "running", userId: "u1" })],
    });
    render(<Launchpad groupId={GROUP} />);
    const box = within(commander());
    // 看得到別人的計畫（不能對他隱形），但動不了
    expect(box.getByText("執行中")).toBeInTheDocument();
    expect(box.queryByRole("button", { name: "停止" })).not.toBeInTheDocument();
  });

  it("組員看自己發起的計畫：停止照給（後端放行的就該露出來）", () => {
    seedCommander({
      level: "command",
      role: "member",
      myUserId: "u9",
      campaigns: [campaign({ status: "running", userId: "u9" })],
    });
    render(<Launchpad groupId={GROUP} />);
    expect(within(commander()).getByRole("button", { name: "停止" })).toBeInTheDocument();
  });

  it("組員看別人待核准的計畫：核准與放棄都不露出", () => {
    seedCommander({
      level: "command",
      role: "member",
      myUserId: "u9",
      campaigns: [campaign({ status: "awaiting_approval", userId: "u1" })],
    });
    render(<Launchpad groupId={GROUP} />);
    const box = within(commander());
    expect(box.queryByRole("button", { name: "核准" })).not.toBeInTheDocument();
    expect(box.queryByRole("button", { name: "放棄" })).not.toBeInTheDocument();
  });

  it("組長看別人發起的計畫：停止照給（組長本來就管得動全組）", () => {
    seedCommander({ level: "command", campaigns: [campaign({ status: "running", userId: "u7" })] });
    render(<Launchpad groupId={GROUP} />);
    expect(within(commander()).getByRole("button", { name: "停止" })).toBeInTheDocument();
  });

  it("只有 supervise 等級的發起人：能放棄自己的計畫，但不能核准（核准要 command）", () => {
    seedCommander({
      level: "supervise",
      role: "member",
      myUserId: "u9",
      campaigns: [campaign({ status: "awaiting_approval", userId: "u9" })],
    });
    render(<Launchpad groupId={GROUP} />);
    const box = within(commander());
    expect(box.getByRole("button", { name: "放棄" })).toBeInTheDocument();
    expect(box.queryByRole("button", { name: "核准" })).not.toBeInTheDocument();
  });
});

describe("L3 跨專案調度：waiting 要講清楚在等什麼、下一步是什麼", () => {
  beforeEach(() => {
    h.queryData.clear();
    h.mutations.length = 0;
    h.mutationReply.clear();
    h.queryState.clear();
  });

  /** 預算停手：watch 步驟卡在 waiting，成因是子計畫估點超出授權 */
  const budgetWaiting = (over: Record<string, unknown> = {}) => campaign({
    status: "waiting",
    budgetPoints: 0,
    spentPoints: 0,
    steps: [
      { id: "s1", kind: "dispatch", title: "在招生短片開一份分鏡計畫", note: "", status: "done", result: "已建立" },
      {
        id: "s2", kind: "watch", title: "盯著分鏡計畫", note: "", status: "waiting",
        error: "子計畫估 40 點，超出本次授權（已用 0／0 點）",
      },
    ],
    ...over,
  });

  it("預算停手：講明是授權不夠，並指出「加授權」或「自己去核准那份子計畫」兩條路", () => {
    seedCommander({ level: "command", campaigns: [budgetWaiting()] });
    render(<Launchpad groupId={GROUP} />);
    const box = within(commander());
    expect(box.getByText(/等你決定授權：「盯著分鏡計畫」/)).toHaveTextContent("子計畫估 40 點，超出本次授權");
    expect(box.getByText(/等你決定授權/)).toHaveTextContent(/自己到那個專案核准那份子計畫/);
  });

  it("預算停手且沒填點數：明講按了會停在同一步（不然使用者會按第二次、第三次然後說鈕壞了）", async () => {
    seedCommander({ level: "command", campaigns: [budgetWaiting()] });
    render(<Launchpad groupId={GROUP} />);
    const box = within(commander());
    expect(box.getByText(/下一輪還是會停在同一步/)).toBeInTheDocument();
    // 填了點數，這句提示就該消失
    await userEvent.clear(box.getByLabelText(/加多少自動核准授權/));
    await userEvent.type(box.getByLabelText(/加多少自動核准授權/), "50");
    expect(box.queryByText(/下一輪還是會停在同一步/)).not.toBeInTheDocument();
  });

  it("人工關卡：講在等誰做什麼，且不出現「加授權」那句（加點解決不了人工關卡）", () => {
    seedCommander({
      level: "command",
      campaigns: [campaign({
        status: "waiting",
        steps: [
          { id: "s1", kind: "wait_for_human", title: "等阿光確認旁白", note: "旁白稿要本人點頭", status: "waiting" },
        ],
      })],
    });
    render(<Launchpad groupId={GROUP} />);
    const box = within(commander());
    expect(box.getByText(/等人處理：「等阿光確認旁白」/)).toHaveTextContent("旁白稿要本人點頭");
    expect(box.queryByText(/等你決定授權/)).not.toBeInTheDocument();
    expect(box.queryByText(/下一輪還是會停在同一步/)).not.toBeInTheDocument();
  });
});

describe("L3 跨專案調度：文案誠實度", () => {
  beforeEach(() => {
    h.queryData.clear();
    h.mutations.length = 0;
    h.mutationReply.clear();
    h.queryState.clear();
  });

  it("授權 0 點的核准確認訊息不准說「會在 0 點授權內自動核准」——那讀起來像它會自己處理", () => {
    seedCommander({ level: "command", campaigns: [campaign({ budgetPoints: 0 })] });
    render(<Launchpad groupId={GROUP} />);
    const msg = within(commander()).getByRole("button", { name: "核准" }).getAttribute("message") ?? "";
    expect(msg).toMatch(/停下來等你核准/);
    expect(msg).not.toMatch(/0 點的授權內自動核准/);
  });

  it("授權大於 0 時才講「在授權內自動核准」，而且點數帶「估」", () => {
    seedCommander({ level: "command", campaigns: [campaign({ budgetPoints: 100 })] });
    render(<Launchpad groupId={GROUP} />);
    const msg = within(commander()).getByRole("button", { name: "核准" }).getAttribute("message") ?? "";
    expect(msg).toMatch(/估 100 點的授權內自動核准子計畫/);
  });

  it("已停止的計畫在列表上就看得出「子計畫沒有跟著停」（確認訊息按完就消失了）", () => {
    seedCommander({ level: "command", campaigns: [campaign({ status: "stopped" })] });
    render(<Launchpad groupId={GROUP} />);
    expect(within(commander()).getByText(/先前派出去的子計畫仍在各專案照常執行/)).toBeInTheDocument();
  });

  it("動作失敗時指名是哪一個動作——後端四句訊息長得很像，對不上按鈕就會被當成按錯鈕", () => {
    seedCommander({ level: "command", campaigns: [campaign({ status: "waiting" })] });
    h.mutationError.set("teamAssistant.resumeCampaign", { message: "只有發起人或組長以上可以續跑組代理調度計畫" });
    render(<Launchpad groupId={GROUP} />);
    expect(within(commander()).getByRole("alert"))
      .toHaveTextContent("讓調度計畫繼續失敗：只有發起人或組長以上可以續跑組代理調度計畫");
  });
});

/* ────────────────────────────────────────────────────────────────
   總指揮的四個動作：失敗要接住，舊錯誤不能賴在下一個動作上。

   這兩件事都不會讓畫面「看起來」壞掉，所以只能靠測試守：
   前者是主控台一路噴 unhandled rejection（開發環境還會被 overlay 蓋住整頁），
   後者是橫幅指著一顆使用者這一輪根本沒按的鈕。
   ──────────────────────────────────────────────────────────────── */
describe("L3 跨專案調度：動作失敗的收尾", () => {
  beforeEach(() => {
    h.queryData.clear();
    h.mutations.length = 0;
    h.mutationReply.clear();
    h.queryState.clear();
  });

  /** 在這段期間內冒出來的 unhandled rejection（Node 在該 tick 結束時才判定，所以要讓出一個 macrotask） */
  async function unhandledDuring(fn: () => Promise<void>): Promise<unknown[]> {
    const caught: unknown[] = [];
    const onUnhandled = (reason: unknown) => { caught.push(reason); };
    process.on("unhandledRejection", onUnhandled);
    try {
      await fn();
      await new Promise((r) => setTimeout(r, 0));
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
    return caught;
  }

  it.each([
    ["approveCampaign", "awaiting_approval", /^核准$/, "核准調度計畫失敗"],
    ["discardCampaign", "awaiting_approval", /^放棄$/, "放棄調度計畫失敗"],
    ["stopCampaign", "running", /^停止$/, "停止調度計畫失敗"],
    ["resumeCampaign", "waiting", /^繼續/, "讓調度計畫繼續失敗"],
  ] as const)(
    "%s 被後端擋下來時接得住，不會變成 unhandled rejection（錯誤仍由橫幅講出來）",
    async (path, status, btn, banner) => {
      seedCommander({ level: "command", campaigns: [campaign({ status })] });
      h.mutationRejects.set(`teamAssistant.${path}`, { message: "只有發起人或組長以上可以動這份調度計畫" });
      const view = render(<Launchpad groupId={GROUP} />);
      const caught = await unhandledDuring(async () => {
        await userEvent.click(within(commander()).getByRole("button", { name: btn }));
      });
      expect(caught).toEqual([]);
      expect(h.mutations).toEqual([{ path: `teamAssistant.${path}`, input: expect.anything() }]);
      // 吞掉 rejection 不等於吞掉錯誤：使用者仍要看得到是哪一個動作失敗、後端說了什麼。
      // 失敗本身不改任何 React state，所以這裡補一次 rerender，演出真實 tRPC 下錯誤落地後的那次重繪。
      view.rerender(<Launchpad groupId={GROUP} />);
      expect(within(commander()).getByRole("alert"))
        .toHaveTextContent(`${banner}：只有發起人或組長以上可以動這份調度計畫`);
    },
  );

  it("動作開始前先清掉上一個動作的舊錯誤（不然核准失敗過一次，之後每個成功的動作都還掛著那句）", async () => {
    seedCommander({ level: "command", campaigns: [campaign({ status: "waiting" })] });
    h.mutationError.set("teamAssistant.approveCampaign", { message: "點數不足" });
    render(<Launchpad groupId={GROUP} />);
    const box = within(commander());
    expect(box.getByRole("alert")).toHaveTextContent("核准調度計畫失敗：點數不足");

    // 這次按的是「繼續」而且成功了，橫幅卻還在講「核准失敗」——指著一顆這一輪沒按的鈕
    await userEvent.click(box.getByRole("button", { name: /^繼續/ }));
    expect(h.resets).toEqual(expect.arrayContaining([
      "teamAssistant.approveCampaign",
      "teamAssistant.resumeCampaign",
      "teamAssistant.stopCampaign",
      "teamAssistant.discardCampaign",
    ]));
    expect(box.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("繼續失敗時不清掉輸入框的授權點數（清掉的話重按一次就變成不加授權，下一輪照樣停在同一步）", async () => {
    seedCommander({ level: "command", campaigns: [campaign({ status: "waiting" })] });
    h.mutationRejects.set("teamAssistant.resumeCampaign", { message: "額度不足" });
    render(<Launchpad groupId={GROUP} />);
    const box = within(commander());
    const add = box.getByLabelText(/加多少自動核准授權/);
    await userEvent.clear(add);
    await userEvent.type(add, "40");
    await userEvent.click(box.getByRole("button", { name: /^繼續/ }));
    expect(add).toHaveValue(40);
  });
});

describe("L3 跨專案調度：展開步驟的鈕要說得出自己是開還是關", () => {
  beforeEach(() => {
    h.queryData.clear();
    h.mutations.length = 0;
    h.queryState.clear();
  });

  it("目標鈕帶 aria-expanded／aria-controls，且指到真的步驟容器（只聽文字的人才知道展開了沒）", async () => {
    seedCommander({ level: "command", campaigns: [campaign({ status: "running" })] });
    render(<Launchpad groupId={GROUP} />);
    const box = within(commander());
    const toggle = box.getByRole("button", { name: "把三個待審的案子推到可交付" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    const controls = toggle.getAttribute("aria-controls");
    expect(controls).toBeTruthy();

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    // aria-controls 指到不存在的 id 等於沒寫：展開後那個 id 一定要真的是步驟清單
    const panel = document.getElementById(controls!);
    expect(panel).not.toBeNull();
    expect(within(panel!).getByText(/派工｜在招生短片開一份分鏡計畫/)).toBeInTheDocument();
  });
});

describe("campaignRefetchInterval（waiting 也要輪詢，不然人工關卡解掉了畫面也不會動）", () => {
  it("running 與 waiting 都輪詢；其餘狀態與空清單不輪詢", () => {
    expect(campaignRefetchInterval([{ status: "running" }])).toBe(10_000);
    // 這一條是修法本身：waiting 才是最需要盯的狀態（別人可能剛把關卡處理掉）
    expect(campaignRefetchInterval([{ status: "waiting" }])).toBe(10_000);
    expect(campaignRefetchInterval([{ status: "awaiting_approval" }, { status: "done" }])).toBe(false);
    expect(campaignRefetchInterval([])).toBe(false);
    expect(campaignRefetchInterval(undefined)).toBe(false);
  });
});

describe("組彙總 AI 的指令提議（ask 的 actions）", () => {
  beforeEach(() => {
    h.queryData.clear();
    h.mutations.length = 0;
    h.mutationReply.clear();
    h.askReply = {};
  });

  /** 提議裡的 command 直接對應後端 zod 的形狀；前端只負責原樣轉交 */
  const APPROVE = { kind: "approve_run", runId: "22222222-2222-4222-8222-222222222222" };
  const DISPATCH = {
    kind: "dispatch",
    projectId: "33333333-3333-4333-8333-333333333333",
    goal: "補一版可用的旁白稿",
    plannerMode: "thorough",
    playbookId: "playbook.storyboard.v1",
  };

  const askWithActions = (actions: Array<Record<string, unknown>>) => {
    h.askReply = {
      answer: "「招生短片」那份計畫還卡在待核。",
      steps: [], dispatches: [], canDispatch: true, contextUsed: [], degraded: false, actions,
    };
  };

  const askNow = async (q: string) => {
    await userEvent.type(screen.getByLabelText("問總指揮"), q);
    await userEvent.click(screen.getByRole("button", { name: "詢問" }));
  };

  it("回傳 actions → 畫面出現對應按鈕（有理由就掛在 title 上）", async () => {
    seed({ runs: [], pending: [] });
    askWithActions([{ command: APPROVE, label: "核准「招生短片」的計畫", reason: "它已經等了 8 天" }]);
    render(<Launchpad groupId={GROUP} />);
    await askNow("那份計畫怎麼還沒動？");
    const btn = await screen.findByRole("button", { name: "核准「招生短片」的計畫" });
    expect(btn).toHaveAttribute("title", "它已經等了 8 天");
  });

  it("按下去送的是 teamAssistant.command，且 command 與提議逐欄一致（前端不重新拆解）", async () => {
    seed({ runs: [], pending: [] });
    askWithActions([
      { command: APPROVE, label: "核准「招生短片」的計畫" },
      { command: DISPATCH, label: "在社課回顧補一版旁白稿", reason: "旁白缺稿" },
    ]);
    render(<Launchpad groupId={GROUP} />);
    await askNow("接下來該做什麼？");
    // 挑帶了 plannerMode／playbookId 的那一則：任何一欄在路上被吃掉，這裡就會紅
    await userEvent.click(await screen.findByRole("button", { name: "在社課回顧補一版旁白稿" }));
    const sent = h.mutations.filter((m) => m.path === "teamAssistant.command");
    expect(sent).toHaveLength(1);
    expect(sent[0].input).toEqual({ groupId: GROUP, command: DISPATCH });
  });

  it("執行成功後按鈕換成後端回的結果文字（同一道指令不會被按第二次）", async () => {
    seed({ runs: [], pending: [] });
    h.mutationReply.set("teamAssistant.command", {
      kind: "approve_run",
      message: "已核准「招生短片」的計畫，開始執行（估 12 點）",
      runId: APPROVE.runId,
    });
    askWithActions([{ command: APPROVE, label: "核准「招生短片」的計畫" }]);
    render(<Launchpad groupId={GROUP} />);
    await askNow("那份計畫怎麼還沒動？");
    await userEvent.click(await screen.findByRole("button", { name: "核准「招生短片」的計畫" }));
    expect(await screen.findByText("✓ 已核准「招生短片」的計畫，開始執行（估 12 點）")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "核准「招生短片」的計畫" })).not.toBeInTheDocument();
    expect(h.mutations.filter((m) => m.path === "teamAssistant.command")).toHaveLength(1);
  });

  it("清除對話也要清掉已執行的指令記錄——不然新一輪的提議會頂著上一輪的「✓ …」，按鈕根本不出現", async () => {
    seed({ runs: [], pending: [] });
    h.mutationReply.set("teamAssistant.command", {
      kind: "approve_run",
      message: "已核准「招生短片」的計畫，開始執行（估 12 點）",
      runId: APPROVE.runId,
    });
    askWithActions([{ command: APPROVE, label: "核准「招生短片」的計畫" }]);
    render(<Launchpad groupId={GROUP} />);
    await askNow("那份計畫怎麼還沒動？");
    await userEvent.click(await screen.findByRole("button", { name: "核准「招生短片」的計畫" }));
    expect(await screen.findByText("✓ 已核准「招生短片」的計畫，開始執行（估 12 點）")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "清除對話" }));
    // 第二輪的提議落回同一個 key（act-{訊息索引}-{i}，索引從 0 重來）：
    // actioned 沒清的話，這則新提議會直接被畫成上一輪的成功結果，使用者以為新指令送出去了。
    askWithActions([{ command: DISPATCH, label: "在社課回顧補一版旁白稿" }]);
    await askNow("那接下來呢？");
    expect(await screen.findByRole("button", { name: "在社課回顧補一版旁白稿" })).toBeInTheDocument();
    expect(screen.queryByText("✓ 已核准「招生短片」的計畫，開始執行（估 12 點）")).not.toBeInTheDocument();
  });
});
