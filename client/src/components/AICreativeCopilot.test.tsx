import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  AICreativeCopilot,
  detectDirectIntakeRequest,
  siteActionDoneLink,
  toSiteActionInput,
} from "./AICreativeCopilot";
import {
  registerAssistantFocus,
  registerAssistantPage,
  resetAssistantContextForTest,
} from "../lib/assistantContext";
import { resetAssistantRunStoreForTest } from "../lib/assistantRunStore";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const SHOT_ID = "22222222-2222-4222-8222-222222222222";
const SHOT_ID_2 = "33333333-3333-4333-8333-333333333333";
const SHOT_ID_3 = "44444444-4444-4444-8444-444444444444";

/** runSiteAction 的可觀察替身：行為測試斷言「按確認卡才 mutate、payload 正確」 */
const runSiteActionMutate = vi.fn();
const undoSiteActionMutate = vi.fn();
const dispatchMutate = vi.fn();
const commandMutate = vi.fn();
const submitInteractionMutateAsync = vi.fn();
const intakeRender = vi.hoisted(() => vi.fn());
let watchInsights: unknown;
let watchOverview: unknown;
let durableConversationState: any;

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
      computerRuntime: {
        status: { useQuery: () => ({ data: { enabled: true, browserEnabled: true, browserProvider: "mock", liveExternalWebEnabled: false }, isLoading: false, isPending: false, error: null, refetch: vi.fn(async () => ({ data: { enabled: true, browserEnabled: true, browserProvider: "mock", liveExternalWebEnabled: false } })) }) },
        createSession: { useMutation: mutation() },
      },
      globalAssistant: {
        conversationState: { useQuery: () => ({ data: durableConversationState, isLoading: false, isPending: false, error: null }) },
        // ask 只在串流失敗時作為 fallback；行為測試以串流替身為主
        ask: { useMutation: mutation() },
        submitInteraction: { useMutation: () => ({ mutateAsync: submitInteractionMutateAsync, isPending: false, error: null }) },
        interactionLifecycle: { useMutation: () => ({ mutateAsync: vi.fn().mockResolvedValue({ accepted: true }), isPending: false, error: null }) },
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

// ExternalAssetIntake owns its own tRPC/query integration tests.  Keep this
// suite focused on the persistent conversation and command/result behaviour.
vi.mock("../features/external-intake/ExternalAssetIntake", () => ({
  ExternalAssetIntake: (props: unknown) => {
    intakeRender(props);
    return <button type="button" aria-label="加入資料">＋</button>;
  },
}));

/** 串流替身：預設回一則帶三種提議卡的 done（handled=true＝不退 tRPC） */
const streamMock = vi.fn();
vi.mock("./assistantStream", () => ({
  requestSiteAssistantStream: (args: unknown) => streamMock(args),
}));

/** 一則真實事件的最小形狀（伺服器 AgentEventStream 產生的那一種） */
const event = (over: Record<string, unknown>) => ({
  eventId: `e${Math.random().toString(36).slice(2)}`,
  runId: "run-1",
  timestamp: "2026-08-09T00:00:00.000Z",
  type: "tool.completed",
  status: "ok",
  title: "已讀取資料",
  phase: "step",
  text: "已讀取資料",
  ...over,
});

const DONE = {
  answer: "組內 2 個專案進行中",
  steps: ["查了全組阻塞(0 項)"],
  contextUsed: ["專案現況"],
  runId: "run-1",
  events: [
    event({ type: "source.read", title: "已讀取全組現況", resultCount: 2, durationMs: 120, toolName: "group_overview" }),
    event({ type: "tool.completed", title: "已讀取組阻塞", resultCount: 0, toolName: "group_blockers", status: "empty" }),
  ],
  sources: [
    { id: "group:g", type: "project", name: "全組現況", href: "/dashboard", itemCount: 2, toolName: "group_overview", status: "ok" },
  ],
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
  // 對話與執行軌跡刻意活在模組級 store（跨卸載存活），所以每個案例要自己歸零
  resetAssistantRunStoreForTest();
  watchInsights = undefined;
  watchOverview = undefined;
  durableConversationState = null;
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
  it("hydrates the durable conversation checkpoint after a client refresh", async () => {
    durableConversationState = {
      conversationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      groupId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      userId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      projectId: PROJECT_ID,
      runId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      goalId: null,
      planRevision: 1,
      status: "completed",
      messages: [{ role: "user", text: "匯入素材" }, { role: "assistant", text: "已安全加入 3 項素材" }],
      activeGoal: null,
      recentActionResults: [],
      events: [],
      sources: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    render(<AICreativeCopilot groupId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" />);
    expect(await screen.findByText("已安全加入 3 項素材")).toBeInTheDocument();
  });
  it("快捷鍵隨頁面改變：沒有頁面上下文時是全站型（不再是寫死的四顆）", () => {
    render(<AICreativeCopilot groupId="grp-123" />);
    expect(screen.queryByText("AI 創作助理")).not.toBeInTheDocument();
    expect(screen.getByLabelText("向 AI 助手提問")).toBeInTheDocument();
    expect(screen.getByText("加入資料")).toBeInTheDocument();
    expect(screen.getByText("繼續目前工作")).toBeInTheDocument();
    expect(screen.getByText("做影片")).toBeInTheDocument();
    expect(screen.getByText("安排工作")).toBeInTheDocument();
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

  it("restores the same conversation after the assistant surface unmounts on a route change", async () => {
    const user = userEvent.setup();
    const first = render(<AICreativeCopilot groupId="grp-123" />);
    await sendMessage(user, "幫我查看目前進度");
    await screen.findByText("組內 2 個專案進行中");
    first.unmount();

    render(<AICreativeCopilot groupId="grp-123" />);
    expect(screen.getAllByText("幫我查看目前進度").length).toBeGreaterThan(0);
    expect(screen.getByText("組內 2 個專案進行中")).toBeInTheDocument();
  });

  it("送出走 SSE 串流：答案＋檢索摘要＋三種確認卡一起長出來", async () => {
    const user = userEvent.setup();
    render(<AICreativeCopilot groupId="grp-123" projectId="proj-9" />);
    await sendMessage(user, "進度如何？");

    await screen.findByText("組內 2 個專案進行中");
    // 工作過程收合時只顯示最後一列（手機不被軌跡淹沒），展開才看得到全部
    expect(screen.getByText("已讀取組阻塞")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /查看工作過程/ }));
    expect(screen.getByText("已讀取全組現況")).toBeInTheDocument();
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

  it("明確 DIRECT 回傳已完成結果卡，直接顯示成果並可復原", async () => {
    streamMock.mockImplementationOnce(async ({ handlers }: { handlers: { onDone: (d: unknown) => void } }) => {
      handlers.onDone({
        ...DONE,
        siteActions: [], dispatches: [], actions: [],
        executionPlan: { intent: "DIRECT", confidence: "high", title: "幫我建立會議筆記", steps: ["理解明確指令", "檢查權限與風險", "執行可安全落地的動作"] },
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
    const onNavigate = vi.fn();
    render(<AICreativeCopilot groupId="grp-123" onNavigate={onNavigate} />);
    await sendMessage(user, "幫我建立會議筆記");

    expect(await screen.findByText(/已完成：新增筆記/)).toBeInTheDocument();
    expect(onNavigate).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "查看筆記排程" }));
    expect(onNavigate).toHaveBeenCalledWith("/planner");
    // latency 仍保留在資料契約，但一般使用者第一層不顯示工程計量。
    expect(screen.queryByText("80 毫秒")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /復原/ }));
    expect(undoSiteActionMutate).toHaveBeenCalledWith({
      type: "add_note",
      id: "11111111-1111-4111-8111-111111111111",
    });
  });

  it("Google Photos 分享頁顯示真實替代方式，不顯示假進度", async () => {
    streamMock.mockImplementationOnce(async ({ handlers }: { handlers: { onDone: (d: unknown) => void } }) => {
      handlers.onDone({
        ...DONE,
        answer: "這個 Google Photos 分享頁目前不能直接取得原始媒體。",
        siteActions: [], dispatches: [], actions: [], events: [], sources: [],
        intakeFallbacks: [{
          type: "source_transfer_required",
          provider: "google_photos",
          projectId: PROJECT_ID,
          projectTitle: "挑戰營",
          url: "https://photos.app.goo.gl/demo",
          message: "Google Photos 分享頁不是可直接下載的原始媒體網址。",
          browserAvailable: false,
          alternatives: ["files", "google-drive", "download-upload"],
        }],
      });
      return true;
    });
    const user = userEvent.setup();
    render(<AICreativeCopilot groupId="grp-123" />);
    await sendMessage(user, "把 https://photos.app.goo.gl/demo 加入挑戰營");

    expect(await screen.findByText("Google Photos 需要原始媒體")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "選擇檔案" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Google Drive" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "下載後上傳" })).toBeInTheDocument();
    expect(screen.queryByText(/正在取得內容/)).not.toBeInTheDocument();
    expect(screen.queryByText("Aios 已完成")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /瀏覽器/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Google Drive" }));
    expect(intakeRender).toHaveBeenLastCalledWith(expect.objectContaining({
      projectId: PROJECT_ID,
      openRequest: expect.objectContaining({ mode: "drive" }),
    }));
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
    expect(toSiteActionInput({ type: "import_url", groupId: "g", projectId: "p", projectTitle: "PT", url: "https://example.com/source", label: "L" }))
      .toEqual({ type: "import_url", groupId: "g", projectId: "p", url: "https://example.com/source" });
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
    expect(siteActionDoneLink(
      { type: "import_url", groupId: "g", projectId: "pp", projectTitle: "PT", url: "https://example.com/source", label: "L" },
      { type: "import", projectId: "pp" },
    )).toEqual({ href: "/p/pp#sec-assets", label: "查看資料" });
  });

  it("opens the existing Drive mini workspace from conversation without starting a campaign", async () => {
    const interactionRequest = {
      interactionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      runId: "run-1",
      goalId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      type: "DRIVE_PICKER",
      title: "選擇 Google Drive 檔案",
      description: "加入專案；完成後回到同一個對話。",
      required: true,
      resumeToken: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      expiresAt: "2026-09-01T00:00:00.000Z",
      targetProjectId: PROJECT_ID,
      expectedResultType: "import",
      status: "pending",
      createdAt: "2026-08-12T00:00:00.000Z",
    };
    streamMock.mockImplementationOnce(async ({ handlers }: { handlers: { onDone: (d: unknown) => void } }) => {
      handlers.onDone({
        ...DONE,
        answer: interactionRequest.description,
        siteActions: [], dispatches: [], actions: [], sources: [],
        events: [event({ type: "waiting.user_input", status: "waiting", title: interactionRequest.title })],
        interactionRequest,
        activeGoal: {
          goalId: interactionRequest.goalId,
          status: "waiting_user_input",
          frame: { intent: "IMPORT", operation: "IMPORT", objectType: "FILE", source: { type: "GOOGLE_DRIVE" }, scope: { projectId: PROJECT_ID }, referents: [], constraints: [], desiredOutcome: "PERSIST_ASSETS", missingSlots: [], understandingConfidence: "high", sourceConfidence: "high", entityConfidence: "high", capabilityConfidence: "high" },
          resolvedSlots: { projectId: PROJECT_ID }, missingSlots: [], resultRefIds: [], pendingInteraction: interactionRequest,
        },
      });
      return true;
    });
    const user = userEvent.setup();
    render(<AICreativeCopilot groupId="grp-123" projectId={PROJECT_ID} />);
    await sendMessage(user, "把 Google Drive 的活動資料帶進來");

    expect(await screen.findByText(/Google Drive 檔案/)).toBeInTheDocument();
    expect(streamMock).toHaveBeenCalledTimes(1);
    expect(intakeRender).toHaveBeenLastCalledWith(expect.objectContaining({
      projectId: PROJECT_ID,
      openRequest: expect.objectContaining({ mode: "drive" }),
    }));
  });

  it("does not navigate after create_project until the user clicks the result action", async () => {
    streamMock.mockImplementationOnce(async ({ handlers }: { handlers: { onDone: (d: unknown) => void } }) => {
      handlers.onDone({
        ...DONE,
        siteActions: [], dispatches: [], actions: [],
        executedSiteActions: [{
          action: { type: "create_project", groupId: "g", title: "百日夢島", kind: "動畫", platform: "youtube", label: "建立「百日夢島」" },
          result: { type: "create_project", projectId: PROJECT_ID, title: "百日夢島", verification: { status: "verified", message: "ok" } },
          canUndo: false,
        }],
      });
      return true;
    });
    const onNavigate = vi.fn();
    const onUseIdeaForNewProject = vi.fn();
    const user = userEvent.setup();
    render(<AICreativeCopilot groupId="grp-123" onNavigate={onNavigate} onUseIdeaForNewProject={onUseIdeaForNewProject} />);
    await sendMessage(user, "幫我建立百日夢島動畫專案");
    await screen.findByText(/已完成：建立「百日夢島」/);
    expect(onNavigate).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "以此靈感開新專案" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "前往專案" }));
    expect(onNavigate).toHaveBeenCalledWith(`/p/${PROJECT_ID}`);
  });

  it("清空對話會先中止同一條 run，晚到的回覆不會復活", async () => {
    let handlersRef: { onDone: (d: unknown) => void } | undefined;
    let sentSignal: AbortSignal | undefined;
    streamMock.mockImplementationOnce(({ handlers, signal }: { handlers: { onDone: (d: unknown) => void }; signal: AbortSignal }) => {
      handlersRef = handlers;
      sentSignal = signal;
      return new Promise<boolean>((resolve) => signal.addEventListener("abort", () => resolve(true), { once: true }));
    });
    const user = userEvent.setup();
    render(<AICreativeCopilot groupId="grp-123" />);
    await sendMessage(user, "幫我建立任務");
    await user.click(screen.getByLabelText("清空對話紀錄"));
    expect(sentSignal?.aborted).toBe(true);
    handlersRef?.onDone(DONE);
    await waitFor(() => expect(screen.queryByText(DONE.answer)).not.toBeInTheDocument());
    expect(screen.queryByRole("log")).not.toBeInTheDocument();
  });

  it("等待檔案時只顯示一次問題，不顯示工程卡或錯誤靈感操作", async () => {
    streamMock.mockImplementationOnce(async ({ handlers }: { handlers: { onDone: (d: unknown) => void } }) => {
      handlers.onDone({
        ...DONE,
        answer: "已確認要加入「新專案」。請選擇檔案。",
        siteActions: [], dispatches: [], actions: [], sources: [],
        executionPlan: { intent: "ASK", confidence: "medium", title: "選擇檔案", steps: ["等待檔案"] },
        events: [event({ type: "waiting.user_input", status: "waiting", title: "請選擇檔案" })],
        intakeRequest: { mode: "files", projectId: PROJECT_ID, projectTitle: "新專案", message: "請選擇檔案" },
      });
      return true;
    });
    const user = userEvent.setup();
    render(<AICreativeCopilot groupId="grp-123" onUseIdeaForNewProject={vi.fn()} />);
    await sendMessage(user, "1");
    expect(await screen.findAllByText("已確認要加入「新專案」。請選擇檔案。")).toHaveLength(1);
    expect(screen.queryByText("請選擇檔案", { selector: ".agent-work__step-title" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "以此靈感開新專案" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "建立1準備" })).not.toBeInTheDocument();
    expect(screen.getByRole("log")).toHaveAttribute("aria-live", "polite");
    expect(intakeRender).toHaveBeenLastCalledWith(expect.objectContaining({
      dialogTitle: "加入資料",
      closeOnImported: true,
    }));
  });

  it("queues one next turn entered after the completion bubble but before the exact run finalizer", async () => {
    let releaseFirst!: () => void;
    const firstFinalizer = new Promise<void>((resolve) => { releaseFirst = resolve; });
    streamMock.mockImplementationOnce(async ({ handlers }: { handlers: { onDone: (d: unknown) => void } }) => {
      handlers.onDone({ ...DONE, siteActions: [], dispatches: [], actions: [] });
      await firstFinalizer;
      return true;
    });
    const user = userEvent.setup();
    render(<AICreativeCopilot groupId="grp-123" />);
    await sendMessage(user, "建立測試專案");
    await screen.findByText(DONE.answer);

    const composer = screen.getByLabelText("向 AI 助手提問");
    await user.type(composer, "把 URL 加入剛建立專案{Enter}");
    expect(streamMock).toHaveBeenCalledTimes(1);
    releaseFirst();
    await waitFor(() => expect(streamMock).toHaveBeenCalledTimes(2));
    expect(streamMock).toHaveBeenLastCalledWith(expect.objectContaining({
      message: "把 URL 加入剛建立專案",
    }));
  });

  it("sends the previous typed ImportResult on the next turn for 'these data' references", async () => {
    streamMock.mockImplementationOnce(async ({ handlers }: { handlers: { onDone: (d: unknown) => void } }) => {
      handlers.onDone({
        ...DONE,
        siteActions: [], dispatches: [], actions: [],
        executedSiteActions: [{
          action: {
            type: "import_url", groupId: "g", projectId: PROJECT_ID, projectTitle: "北藝",
            url: "https://example.com/source.pdf", label: "加入北藝資料",
          },
          result: {
            type: "import", source: "url", resourceIds: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
            assetIds: ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"], intelligenceIds: [],
            projectId: PROJECT_ID, count: 1, duplicateCount: 0, needsReviewCount: 1,
            backgroundProcessing: true, verification: { status: "verified", message: "ok" },
          },
          canUndo: false,
        }],
      });
      return true;
    });
    const user = userEvent.setup();
    render(<AICreativeCopilot groupId="grp-123" projectId={PROJECT_ID} />);
    await sendMessage(user, "把網址加入專案");
    await screen.findByText(/AI 正在背景整理/);
    await sendMessage(user, "那幫我用這些資料做下一步");

    expect(streamMock).toHaveBeenLastCalledWith(expect.objectContaining({
      recentActionResults: [expect.objectContaining({
        type: "import",
        resourceIds: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
        projectId: PROJECT_ID,
      })],
    }));
  });
});

describe("detectDirectIntakeRequest", () => {
  it("routes explicit Drive and local-file requests to the existing intake mini workspace", () => {
    expect(detectDirectIntakeRequest("把 Google Drive 的活動資料帶進來")).toBe("drive");
    expect(detectDirectIntakeRequest("把整個北藝資料夾匯入")).toBe("folder");
    expect(detectDirectIntakeRequest("把我的 PDF 檔案放進專案")).toBe("files");
    expect(detectDirectIntakeRequest("什麼是 Google Drive？")).toBeNull();
  });
});
