import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GroupCampaignPanel } from "./GroupCampaignPanel";
import type { GroupCampaignStep, GroupCommandLevel } from "../../../../shared/groupAgent";

const planMutate = vi.fn();
const approveMutate = vi.fn();
const discardMutate = vi.fn();
const stopMutate = vi.fn();
const resumeMutate = vi.fn();

let level: GroupCommandLevel = "command";
let runs: unknown[] = [];

// vi.mock 的工廠會被拉到檔頭，所以工廠**執行當下**不能碰到頂層變數。
// 每個 useMutation 都寫成箭頭函式，spy 要到元件 render 時才被讀取，那時已經初始化完了。
vi.mock("../../api", () => ({
  trpc: {
    useUtils: () => ({ teamAssistant: { campaigns: { invalidate: vi.fn() } } }),
    teamAssistant: {
      commandLevel: { useQuery: () => ({ data: level, isSuccess: true, isLoading: false, error: null }) },
      campaigns: { useQuery: () => ({ data: runs, isLoading: false, error: null }) },
      planCampaign: { useMutation: () => ({ mutate: planMutate, isPending: false, error: null }) },
      approveCampaign: { useMutation: () => ({ mutate: approveMutate, isPending: false, error: null }) },
      discardCampaign: { useMutation: () => ({ mutate: discardMutate, isPending: false, error: null }) },
      stopCampaign: { useMutation: () => ({ mutate: stopMutate, isPending: false, error: null }) },
      resumeCampaign: { useMutation: () => ({ mutate: resumeMutate, isPending: false, error: null }) },
    },
  },
}));

function step(partial: Partial<GroupCampaignStep> = {}): GroupCampaignStep {
  return { id: "s1", kind: "dispatch", title: "派工", note: "", status: "pending", ...partial };
}

function campaign(partial: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    goal: "辦一波中秋宣傳",
    summary: "辦一波中秋宣傳｜3 步（開專案 1、派工 1）｜自動核准授權 0 點",
    status: "awaiting_approval",
    steps: [step()],
    budgetPoints: 0,
    spentPoints: 0,
    ...partial,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  level = "command";
  runs = [];
});

/**
 * 這支元件是 L3 campaign 唯一的前門——在它之前，整套後端（規劃／背景執行器／預算閘／
 * 事件軌跡）在 client 一個呼叫端都沒有。測試守的是三件會直接變成金錢或權限事故的事：
 * 權限不足不露出、授權額度預設 0、以及等待中的兩種成因不能混為一談。
 */
describe("GroupCampaignPanel", () => {
  it("權限不足時整塊不渲染——沒有「可總指揮」就看不到這個入口", () => {
    level = "supervise";
    const { container } = render(<GroupCampaignPanel groupId="g1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("預設授權是 0 點——「每份都問我」比預設給了再靠人記得關安全", async () => {
    const user = userEvent.setup();
    render(<GroupCampaignPanel groupId="g1" />);
    expect(screen.getByText(/每一份子計畫都要你親自按核准/)).toBeVisible();
    await user.type(screen.getByLabelText("要達成什麼"), "幫我開一個中秋活動宣傳專案");
    await user.click(screen.getByRole("button", { name: /排一份計畫/ }));
    expect(planMutate).toHaveBeenCalledWith({ groupId: "g1", goal: "幫我開一個中秋活動宣傳專案", budgetPoints: 0 });
  });

  it("挑了自動核准額度就照挑的送——這個數字的意思是「我不在場時可以花多少」", async () => {
    const user = userEvent.setup();
    render(<GroupCampaignPanel groupId="g1" />);
    await user.click(screen.getByRole("button", { name: "200 點內自動" }));
    await user.type(screen.getByLabelText("要達成什麼"), "把三個案子都推到可交付");
    await user.click(screen.getByRole("button", { name: /排一份計畫/ }));
    expect(planMutate).toHaveBeenCalledWith(expect.objectContaining({ budgetPoints: 200 }));
  });

  it("目標太短時送不出去（後端下限是 5 字，前端不要讓人白按一次）", async () => {
    const user = userEvent.setup();
    render(<GroupCampaignPanel groupId="g1" />);
    await user.type(screen.getByLabelText("要達成什麼"), "中秋");
    expect(screen.getByRole("button", { name: /排一份計畫/ })).toBeDisabled();
  });

  it("待核准的計畫先給人過目——摘要說出會開幾個專案、派幾件工，才輪到核准鈕", async () => {
    const user = userEvent.setup();
    runs = [campaign()];
    render(<GroupCampaignPanel groupId="g1" />);
    expect(screen.getByText(/開專案 1、派工 1/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "核准開跑" }));
    expect(approveMutate).toHaveBeenCalledWith({ runId: "run-1" });
  });

  it("每個步驟講出種類與狀態，不是只有一顆圖示——色弱與讀屏使用者也要讀得懂", () => {
    runs = [campaign({
      steps: [
        step({ id: "s0", kind: "create_project", title: "開專案「中秋活動宣傳」", status: "done", projectTitle: "中秋活動宣傳", projectId: "p-1" }),
        step({ id: "s1", kind: "dispatch", title: "做一支 30 秒短片", status: "running" }),
      ],
      status: "running",
    })];
    render(<GroupCampaignPanel groupId="g1" />);
    expect(screen.getByText("開專案")).toBeVisible();
    expect(screen.getByText("派工")).toBeVisible();
    expect(screen.getByText("完成")).toBeVisible();
    expect(screen.getByText("進行中")).toBeVisible();
  });

  it("開好的專案要點得進去——不然使用者只看到「完成」卻找不到東西在哪", () => {
    runs = [campaign({
      status: "running",
      steps: [step({ id: "s0", kind: "create_project", title: "開專案", status: "done", projectTitle: "中秋活動宣傳", projectId: "p-1" })],
    })];
    render(<GroupCampaignPanel groupId="g1" />);
    expect(screen.getByRole("button", { name: /前往「中秋活動宣傳」/ })).toBeVisible();
  });

  it("預算停手與人工關卡分開講——混為一談的話使用者只會亂按「繼續」", () => {
    runs = [campaign({
      status: "waiting",
      budgetPoints: 30,
      spentPoints: 30,
      steps: [step({ id: "s2", kind: "watch", title: "盯進度", status: "waiting", error: "子計畫估 40 點，超出本次授權" })],
    })];
    render(<GroupCampaignPanel groupId="g1" />);
    expect(screen.getByText(/停下來等你加授權/)).toBeVisible();
    // 預算停手才需要加授權的選項；人工關卡只要按繼續
    expect(screen.getByRole("button", { name: "+200 點" })).toBeVisible();
  });

  it("人工關卡不出現加授權的選項——加點解不了「等人去做事」", () => {
    runs = [campaign({
      status: "waiting",
      steps: [step({ id: "s3", kind: "wait_for_human", title: "等場地確認", status: "waiting", note: "要先跟廟方確認場地" })],
    })];
    render(<GroupCampaignPanel groupId="g1" />);
    expect(screen.getByText(/等你處理/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "+200 點" })).toBeNull();
  });

  it("預算停手按繼續時把加的授權一起送出去——不加點就繼續會原地彈回 waiting", async () => {
    const user = userEvent.setup();
    runs = [campaign({
      status: "waiting",
      steps: [step({ id: "s2", kind: "watch", title: "盯進度", status: "waiting", error: "超出授權" })],
    })];
    render(<GroupCampaignPanel groupId="g1" />);
    await user.click(screen.getByRole("button", { name: "+200 點" }));
    await user.click(screen.getByRole("button", { name: "繼續" }));
    expect(resumeMutate).toHaveBeenCalledWith({ runId: "run-1", addBudgetPoints: 200 });
  });

  it("停止要先確認——組代理會花點、會改資料，不該是一顆按了就生效的鈕", async () => {
    const user = userEvent.setup();
    runs = [campaign({ status: "running" })];
    render(<GroupCampaignPanel groupId="g1" />);
    await user.click(screen.getByRole("button", { name: /停止/ }));
    expect(stopMutate).not.toHaveBeenCalled();
    // armed 之後觸發鈕會被確認／取消取代（ConfirmButton 在 !armed 時就 return 了），
    // 所以這裡的「停止」必然是確認鈕，不會跟觸發鈕撞名
    await user.click(screen.getByRole("button", { name: "停止" }));
    expect(stopMutate).toHaveBeenCalledWith({ runId: "run-1" });
  });

  it("放棄未核准的計畫也要確認，並說清楚沒有花過點", async () => {
    const user = userEvent.setup();
    runs = [campaign()];
    render(<GroupCampaignPanel groupId="g1" />);
    await user.click(screen.getByRole("button", { name: /放棄/ }));
    expect(screen.getByText(/沒有花任何點數/)).toBeVisible();
  });

  it("執行中的進度說出已自動花掉多少——「AI 替我花了多少」不該要人去別的頁面查", () => {
    runs = [campaign({ status: "running", budgetPoints: 200, spentPoints: 45, steps: [step({ status: "done" }), step({ id: "s2" })] })];
    render(<GroupCampaignPanel groupId="g1" />);
    expect(screen.getByText(/進度 1\/2 步・已自動花 45\/200 點/)).toBeVisible();
  });
});
