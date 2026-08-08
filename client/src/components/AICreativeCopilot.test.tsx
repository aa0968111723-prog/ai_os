import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { AICreativeCopilot, siteActionDoneLink, toSiteActionInput } from "./AICreativeCopilot";
import {
  registerAssistantFocus,
  registerAssistantPage,
  resetAssistantContextForTest,
} from "../lib/assistantContext";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const SHOT_ID = "22222222-2222-4222-8222-222222222222";
const SHOT_ID_2 = "33333333-3333-4333-8333-333333333333";
const SHOT_ID_3 = "44444444-4444-4444-8444-444444444444";

/** runSiteAction 的可觀察替身：行為測試斷言「按確認卡才 mutate、payload 正確」 */
const runSiteActionMutate = vi.fn();
const undoSiteActionMutate = vi.fn();
const dispatchMutate = vi.fn();
const commandMutate = vi.fn();
let watchInsights: unknown;
let watchOverview: unknown;

vi.mock("../api", () => {
  const mutation = (mutate = vi.fn()) => () => ({
    mutate,
    isPending: false,
    isSuccess: false,
    reset: vi.fn(),
    error: null,
    data: undefined,
  });
  return {
    trpc: {
      globalAssistant: {
        // ask 只在串流失敗時作為 fallback；行為測試以串流替身為主
        ask: { useMutation: mutation() },
        runSiteAction: { useMutation: () => ({ mutate: runSiteActionMutate, isPending: false, isSuccess: false, reset: vi.fn(), error: null, data: undefined }) },
        undoSiteAction: { useMutation: () => ({ mutate: undoSiteActionMutate, isPending: false, isSuccess: false, reset: vi.fn(), error: null, data: undefined }) },
      },
      teamAssistant: {
        dispatch: { useMutation: () => ({ mutate: dispatchMutate, isPending: false, isSuccess: false, reset: vi.fn(), error: null, data: undefined }) },
        command: { useMutation: () => ({ mutate: commandMutate, isPending: false, isSuccess: false, reset: vi.fn(), error: null, data: undefined }) },
        groupInsights: { useQuery: () => ({ data: watchInsights, isLoading: false, isPending: false, error: null, refetch: vi.fn() }) },
        agentOverview: { useQuery: () => ({ data: watchOverview, isLoading: false, isPending: false, error: null, refetch: vi.fn() }) },
      },
    },
  };
});

/** 串流替身：預設回一則帶三種提議卡的 done（handled=true＝不退 tRPC） */
const streamMock = vi.fn();
vi.mock("./assistantStream", () => ({
  requestSiteAssistantStream: (args: unknown) => streamMock(args),
}));

const DONE = {
  answer: "組內 2 個專案進行中",
  steps: ["查了全組阻塞(0 項)"],
  contextUsed: ["專案現況"],
  siteActions: [
    { type: "send_dm", peerId: "u2", peerName: "阿明", body: "明早十點對稿，帶腳本", label: "私訊 阿明：「明早十點對稿，帶腳本」" },
  ],
  dispatches: [
    { projectId: "p-1", projectTitle: "招生短片", goal: "拆分鏡並逐鏡出圖", label: "在「招生短片」發起代理計畫：拆分鏡並逐鏡出圖" },
  ],
  actions: [
    { command: { kind: "approve_run", runId: "r-1" }, label: "核准並執行：「招生短片」（估 12 點）", reason: "兩份計畫已等三天" },
  ],
  mock: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  resetAssistantContextForTest();
  watchInsights = undefined;
  watchOverview = undefined;
  streamMock.mockImplementation(async ({ handlers }: { handlers: { onDone: (d: unknown) => void } }) => {
    handlers.onDone(DONE);
    return true;
  });
});

async function sendMessage(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.type(screen.getByLabelText("向 AI 助手提問"), text);
  await user.click(screen.getByTitle("發送 (Enter)"));
}

describe("AICreativeCopilot", () => {
  it("快捷鍵隨頁面改變：沒有頁面上下文時是全站型（不再是寫死的四顆）", () => {
    render(<AICreativeCopilot groupId="grp-123" />);
    expect(screen.queryByText("AI 創作助理")).not.toBeInTheDocument();
    expect(screen.getByLabelText("向 AI 助手提問")).toBeInTheDocument();
    expect(screen.getByText("安排今天")).toBeInTheDocument();
    expect(screen.getByText("繼續上次")).toBeInTheDocument();
    expect(screen.getByText("哪裡卡住")).toBeInTheDocument();
    // 舊的寫死快捷鍵不得復活——它們在任何頁面都一樣，正是這一輪要解決的問題
    expect(screen.queryByText("爆款短片主題")).not.toBeInTheDocument();
    expect(screen.queryByText("開場鉤子技巧")).not.toBeInTheDocument();
  });

  it("在分鏡頁盯著第 3 鏡：快捷鍵換成分鏡型、麵包屑寫得出「專案 · 分鏡 · 第 3 鏡」", () => {
    registerAssistantPage({ pageType: "storyboard", projectId: PROJECT_ID, projectTitle: "挑戰營回顧影片" });
    registerAssistantFocus({ entityType: "shot", entityId: SHOT_ID, entityLabel: "第 3 鏡" });
    render(<AICreativeCopilot groupId="grp-123" />);
    expect(screen.getByText("改善這鏡")).toBeInTheDocument();
    expect(screen.getByText("建立下一鏡")).toBeInTheDocument();
    expect(screen.getByText("挑戰營回顧影片 · 分鏡 · 第 3 鏡")).toBeInTheDocument();
    // 麵包屑不得出現任何 uuid
    expect(screen.queryByText(new RegExp(PROJECT_ID))).not.toBeInTheDocument();
  });

  it("勾了三鏡：快捷鍵變批次型，麵包屑說「已選 3 個分鏡」", () => {
    registerAssistantPage({ pageType: "storyboard", projectId: PROJECT_ID, projectTitle: "招生短片" });
    registerAssistantFocus({
      entityType: "shot", entityId: SHOT_ID, entityLabel: "第 3 鏡",
      selectedEntityIds: [SHOT_ID, SHOT_ID_2, SHOT_ID_3],
    });
    render(<AICreativeCopilot groupId="grp-123" />);
    expect(screen.getByText("直接優化")).toBeInTheDocument();
    expect(screen.getByText("3 個方向")).toBeInTheDocument();
    expect(screen.getByText("招生短片 · 分鏡 · 已選 3 個分鏡")).toBeInTheDocument();
  });

  it("送出時把頁面上下文一起送出（entityId／選取／模式），且不夾帶 route 或專案名", async () => {
    registerAssistantPage({ pageType: "storyboard", projectId: PROJECT_ID, projectTitle: "招生短片" });
    registerAssistantFocus({
      entityType: "shot", entityId: SHOT_ID, entityLabel: "第 3 鏡",
      selectedEntityIds: [SHOT_ID, SHOT_ID_2], activeTab: "pro",
    });
    const user = userEvent.setup();
    render(<AICreativeCopilot groupId="grp-123" />);
    await sendMessage(user, "這段太平了");
    expect(streamMock).toHaveBeenCalledWith(expect.objectContaining({
      projectId: PROJECT_ID,
      pageContext: {
        pageType: "storyboard",
        entityType: "shot",
        entityId: SHOT_ID,
        entityLabel: "第 3 鏡",
        selectedEntityIds: [SHOT_ID, SHOT_ID_2],
        activeTab: "pro",
        recentAction: undefined,
      },
    }));
    const sent = streamMock.mock.calls[0][0].pageContext;
    expect(sent).not.toHaveProperty("route");
    expect(sent).not.toHaveProperty("projectTitle");
  });

  it("updates input field when typed", async () => {
    const user = userEvent.setup();
    render(<AICreativeCopilot groupId="grp-123" />);
    const textarea = screen.getByLabelText("向 AI 助手提問");
    await user.type(textarea, "企劃一個夏日飲品短片");
    expect(textarea).toHaveValue("企劃一個夏日飲品短片");
  });

  it("送出走 SSE 串流：答案＋檢索摘要＋三種確認卡一起長出來", async () => {
    const user = userEvent.setup();
    render(<AICreativeCopilot groupId="grp-123" projectId="proj-9" />);
    await sendMessage(user, "進度如何？");

    await screen.findByText("組內 2 個專案進行中");
    expect(screen.getByText(/查了全組阻塞/)).toBeInTheDocument();
    // 三種確認卡都在；私訊卡顯示**全文**（以本人名義送出的內容必須看過才確認）
    expect(screen.getByText("明早十點對稿，帶腳本")).toBeInTheDocument();
    expect(screen.getByText(/發起代理計畫/)).toBeInTheDocument();
    expect(screen.getByText(/核准並執行/)).toBeInTheDocument();
    // 串流帶了 groupId＋projectId 脈絡
    expect(streamMock).toHaveBeenCalledWith(expect.objectContaining({ groupId: "grp-123", projectId: "proj-9", message: "進度如何？" }));
    // 串流已接手：一次性 tRPC 不得重跑（此處以 runSiteAction 未被叫代表沒有誤觸發任何 mutation）
    expect(runSiteActionMutate).not.toHaveBeenCalled();
  });

  it("短而不足的意圖不回操作長文，提供一個建立動作與查看資料入口", async () => {
    const user = userEvent.setup();
    render(<AICreativeCopilot groupId="grp-123" />);
    await sendMessage(user, "社評");
    expect(await screen.findByRole("button", { name: "建立社評準備" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "查看目前資料" })).toBeInTheDocument();
  });

  it("明確 ACT 回傳已完成結果卡，直接顯示成果並可復原", async () => {
    streamMock.mockImplementationOnce(async ({ handlers }: { handlers: { onDone: (d: unknown) => void } }) => {
      handlers.onDone({
        ...DONE,
        siteActions: [], dispatches: [], actions: [],
        executionPlan: { intent: "ACT", confidence: "high", title: "幫我建立會議筆記", steps: ["理解明確指令", "檢查權限與風險", "執行可安全落地的動作"] },
        executedSiteActions: [{
          action: { type: "add_note", groupId: "g", title: "會議筆記", content: "決議", label: "新增筆記「會議筆記」（組層級）" },
          result: { type: "add_note", noteId: "11111111-1111-4111-8111-111111111111", title: "會議筆記" },
          canUndo: true,
        }],
        latency: { requestReceivedMs: 0, contextReadyMs: 20, modelStartedMs: 25, firstTokenMs: null, firstToolCallMs: null, toolFinishedMs: null, finalAnswerMs: 80, totalMs: 80 },
      });
      return true;
    });
    const user = userEvent.setup();
    render(<AICreativeCopilot groupId="grp-123" />);
    await sendMessage(user, "幫我建立會議筆記");

    expect(await screen.findByText(/已完成：新增筆記/)).toBeInTheDocument();
    expect(screen.getByText(/總耗時 0.1 秒/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /復原/ }));
    expect(undoSiteActionMutate).toHaveBeenCalledWith({
      type: "add_note",
      id: "11111111-1111-4111-8111-111111111111",
    });
  });

  it("執行中送出鍵會變成停止，按下立即中止同一條串流", async () => {
    let sentSignal: AbortSignal | undefined;
    streamMock.mockImplementationOnce(({ signal }: { signal: AbortSignal }) => {
      sentSignal = signal;
      return new Promise<boolean>((resolve) => signal.addEventListener("abort", () => resolve(true), { once: true }));
    });
    const user = userEvent.setup();
    render(<AICreativeCopilot groupId="grp-123" />);
    await user.type(screen.getByLabelText("向 AI 助手提問"), "幫我建立任務");
    await user.click(screen.getByTitle("發送 (Enter)"));

    expect(await screen.findByText("執行中")).toBeInTheDocument();
    await user.click(screen.getByTitle("停止"));
    expect(sentSignal?.aborted).toBe(true);
    await waitFor(() => expect(screen.queryByTitle("停止")).not.toBeInTheDocument());
  });

  it("站級動作卡：按「確認執行」才 mutate，payload 只帶執行欄位不帶 label", async () => {
    const user = userEvent.setup();
    render(<AICreativeCopilot groupId="grp-123" />);
    await sendMessage(user, "私訊阿明");
    await screen.findByText("明早十點對稿，帶腳本");

    expect(runSiteActionMutate).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "確認執行" }));
    expect(runSiteActionMutate).toHaveBeenCalledTimes(1);
    expect(runSiteActionMutate).toHaveBeenCalledWith({ type: "send_dm", peerId: "u2", body: "明早十點對稿，帶腳本" });
  });

  it("站級動作卡：按「略過」整張卡消失、不執行任何 mutation", async () => {
    const user = userEvent.setup();
    render(<AICreativeCopilot groupId="grp-123" />);
    await sendMessage(user, "私訊阿明");
    await screen.findByText("明早十點對稿，帶腳本");

    const dmCard = screen.getByText("明早十點對稿，帶腳本").closest('[data-fb="站級動作卡"]')!;
    await user.click([...dmCard.querySelectorAll("button")].find((b) => b.textContent === "略過")!);
    await waitFor(() => expect(screen.queryByText("明早十點對稿，帶腳本")).not.toBeInTheDocument());
    expect(runSiteActionMutate).not.toHaveBeenCalled();
  });

  it("派工卡與指令卡：各自確認才叫 teamAssistant.dispatch／command", async () => {
    const user = userEvent.setup();
    render(<AICreativeCopilot groupId="grp-123" />);
    await sendMessage(user, "怎麼辦");
    await screen.findByText(/發起代理計畫/);

    await user.click(screen.getByRole("button", { name: "確認派工" }));
    expect(dispatchMutate).toHaveBeenCalledWith({ groupId: "grp-123", projectId: "p-1", goal: "拆分鏡並逐鏡出圖" });

    await user.click(screen.getByRole("button", { name: "確認" }));
    expect(commandMutate).toHaveBeenCalledWith({ groupId: "grp-123", command: { kind: "approve_run", runId: "r-1" } });
  });

  it("串流沒開始（回 false）：退回一次性 tRPC fallback", async () => {
    streamMock.mockResolvedValueOnce(false);
    const user = userEvent.setup();
    render(<AICreativeCopilot groupId="grp-123" />);
    await sendMessage(user, "進度？");
    // fallback 的 ask.mutate 是替身（不回資料），只驗證路徑有走到且不炸
    await waitFor(() => expect(streamMock).toHaveBeenCalled());
  });

  it("WATCH 零狀態：有待核准／逾期／critical 阻塞時列出，全健康時整塊不渲染", () => {
    watchOverview = { summary: { awaitingApproval: 2, failedRecent: 1, waiting: 0 } };
    watchInsights = {
      openTasks: 5, overdueTasks: 3,
      blockers: [
        { severity: "critical", type: "x", label: "「招生短片」等素材三天" },
        { severity: "warn", type: "y", label: "次要提醒不該出現" },
      ],
      people: [], byProject: [],
    };
    const { unmount } = render(<AICreativeCopilot groupId="grp-123" />);
    expect(screen.getByText("需要你注意")).toBeInTheDocument();
    expect(screen.getByText("2 份代理計畫等你核准")).toBeInTheDocument();
    expect(screen.getByText("近 7 天有 1 份代理計畫失敗")).toBeInTheDocument();
    expect(screen.getByText("3 件人員任務已逾期")).toBeInTheDocument();
    expect(screen.getByText("「招生短片」等素材三天")).toBeInTheDocument();
    expect(screen.queryByText("次要提醒不該出現")).not.toBeInTheDocument();
    unmount();

    watchOverview = { summary: { awaitingApproval: 0, failedRecent: 0, waiting: 0 } };
    watchInsights = { openTasks: 0, overdueTasks: 0, blockers: [], people: [], byProject: [] };
    render(<AICreativeCopilot groupId="grp-123" />);
    expect(screen.queryByText("需要你注意")).not.toBeInTheDocument();
  });
});

describe("toSiteActionInput（label 等顯示欄位不上送）", () => {
  it("五種動作各取正確欄位", () => {
    expect(toSiteActionInput({ type: "create_project", groupId: "g", title: "t", kind: "k", platform: "youtube", label: "L" }))
      .toEqual({ type: "create_project", groupId: "g", title: "t", kind: "k", platform: "youtube" });
    expect(toSiteActionInput({ type: "add_note", groupId: "g", projectId: "p", projectTitle: "PT", title: "t", content: "c", label: "L" }))
      .toEqual({ type: "add_note", groupId: "g", projectId: "p", title: "t", content: "c" });
    expect(toSiteActionInput({ type: "add_schedule_item", groupId: "g", title: "t", startsAt: "2026-08-09T02:00:00.000Z", label: "L" }))
      .toEqual({ type: "add_schedule_item", groupId: "g", projectId: undefined, title: "t", startsAt: "2026-08-09T02:00:00.000Z", endsAt: undefined, note: undefined });
    expect(toSiteActionInput({ type: "create_task", groupId: "g", projectId: "p", projectTitle: "PT", title: "t", assigneeId: "u", assigneeName: "N", label: "L" }))
      .toEqual({ type: "create_task", groupId: "g", projectId: "p", title: "t", description: undefined, assigneeId: "u", dueAt: undefined, priority: undefined });
    expect(toSiteActionInput({ type: "send_dm", peerId: "u", peerName: "N", body: "b", label: "L" }))
      .toEqual({ type: "send_dm", peerId: "u", body: "b" });
    expect(toSiteActionInput({ type: "save_decision", groupId: "g", projectId: "p", projectTitle: "PT", title: "角色穿米白外套", label: "L" }))
      .toEqual({ type: "save_decision", groupId: "g", projectId: "p", title: "角色穿米白外套" });
    expect(toSiteActionInput({ type: "create_watch", groupId: "g", projectId: "p", projectTitle: "PT", kind: "generation_failed", watchLabel: "失敗提醒", label: "L" }))
      .toEqual({ type: "create_watch", groupId: "g", projectId: "p", kind: "generation_failed", label: "失敗提醒" });
  });
});

describe("siteActionDoneLink", () => {
  it("完成後的落點：建案→專案頁、筆記行程→筆記排程、任務→專案頁、私訊→聊天", () => {
    expect(siteActionDoneLink({ type: "create_project", groupId: "g", title: "t", kind: "k", platform: "p", label: "L" }, { type: "create_project", projectId: "pid" }))
      .toEqual({ href: "/p/pid", label: "前往專案" });
    expect(siteActionDoneLink({ type: "add_note", groupId: "g", title: "t", content: "c", label: "L" }, { type: "add_note" })?.href).toBe("/planner");
    expect(siteActionDoneLink({ type: "create_task", groupId: "g", projectId: "pp", projectTitle: "PT", title: "t", label: "L" }, { type: "create_task" })?.href).toBe("/p/pp");
    expect(siteActionDoneLink({ type: "send_dm", peerId: "u", peerName: "N", body: "b", label: "L" }, { type: "send_dm" })?.href).toBe("/chat");
    expect(siteActionDoneLink({ type: "save_decision", groupId: "g", projectId: "pp", projectTitle: "PT", title: "定案", label: "L" }, { type: "save_decision" })?.href).toBe("/p/pp");
    expect(siteActionDoneLink({ type: "create_watch", groupId: "g", projectId: "pp", projectTitle: "PT", kind: "overdue_task", label: "L" }, { type: "create_watch" })?.href).toBe("/p/pp");
  });
});
