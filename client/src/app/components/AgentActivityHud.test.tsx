import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AgentActivityHud } from "./AgentActivityHud";

const stopMutate = vi.fn();
const goToSpy = vi.fn();
let overviewRuns: unknown[] = [];

vi.mock("../../lib/goTo", () => ({
  goTo: (...args: unknown[]) => goToSpy(...args),
}));

vi.mock("../../api", () => ({
  trpc: {
    useUtils: () => ({ teamAssistant: { agentOverview: { invalidate: vi.fn() } } }),
    teamAssistant: {
      agentOverview: { useQuery: () => ({ data: { runs: overviewRuns }, isLoading: false, error: null }) },
    },
    agents: {
      stop: { useMutation: () => ({ mutate: stopMutate, isPending: false, error: null }) },
    },
  },
}));

function run(partial: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    projectId: "proj-1",
    projectTitle: "淡江禪學社招生影片",
    goal: "把腳本拆成 6 鏡並逐鏡出圖",
    status: "running",
    doneSteps: 2,
    totalSteps: 6,
    currentStepNote: "為第 3 鏡生成畫面",
    ...partial,
  };
}

/**
 * 代理是背景執行的（關掉頁面也續跑）。在這條 HUD 之前，看得到進度的只有專案頁的
 * AgentCard——離開那頁就完全失去線索。這支測試守的是「跨頁看得見＋隨時停得掉」。
 */
describe("AgentActivityHud", () => {
  it("沒有在跑的代理時完全不渲染——常駐 UI 只在有話要說時才值得佔畫面", () => {
    overviewRuns = [run({ status: "done" }), run({ id: "r2", status: "failed" })];
    const { container } = render(<AgentActivityHud groupId="g1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("顯示目前步驟、專案與進度，並用 aria-live 播報", () => {
    overviewRuns = [run()];
    render(<AgentActivityHud groupId="g1" />);
    const hud = screen.getByRole("status");
    expect(hud).toHaveAttribute("aria-live", "polite");
    expect(screen.getByText("為第 3 鏡生成畫面")).toBeVisible();
    expect(screen.getByText(/淡江禪學社招生影片・2\/6 步/)).toBeVisible();
    expect(screen.getByText("開拍中")).toBeVisible();
  });

  it("多個同時在跑時說出還有幾個，不讓人以為只有一個", () => {
    overviewRuns = [run(), run({ id: "r2" }), run({ id: "r3", status: "waiting" })];
    render(<AgentActivityHud groupId="g1" />);
    expect(screen.getByText(/另有 2 個/)).toBeVisible();
  });

  it("待核准／等回覆的狀態各自講人話，不是原始 status 字串", () => {
    overviewRuns = [run({ status: "awaiting_approval" })];
    const { unmount } = render(<AgentActivityHud groupId="g1" />);
    expect(screen.getByText("待你過目")).toBeVisible();
    unmount();

    overviewRuns = [run({ status: "waiting" })];
    render(<AgentActivityHud groupId="g1" />);
    expect(screen.getByText("等你回覆")).toBeVisible();
  });

  it("點本體用 goTo 帶 focus 導航——裸 navigate 在「人已在該專案頁」時是靜默死鍵", async () => {
    // wouter 只認 pathname：/p/X → /p/X?focus=… 不會 re-render，掛載時讀一次的
    // ?focus= 消費者全都不會重跑。goTo 的同頁事件軌是唯一能補到這個洞的路徑，
    // 所以這裡鎖的是「走 goTo 且把 focus 分離傳遞」，不是只鎖網址字串。
    const user = userEvent.setup();
    overviewRuns = [run()];
    render(<AgentActivityHud groupId="g1" />);
    await user.click(screen.getByText("為第 3 鏡生成畫面"));
    expect(goToSpy).toHaveBeenCalledWith("/p/proj-1", { focus: "agent-run-run-1" });
  });

  it("「停」直接放在列上——代理會花點數會改資料，任何頁面都要能立刻按停", async () => {
    const user = userEvent.setup();
    overviewRuns = [run()];
    render(<AgentActivityHud groupId="g1" />);
    await user.click(screen.getByRole("button", { name: /停/ }));
    expect(stopMutate).toHaveBeenCalledWith({ runId: "run-1" });
  });

  it("沒有 currentStepNote 時退回目標，不留白", () => {
    overviewRuns = [run({ currentStepNote: null })];
    render(<AgentActivityHud groupId="g1" />);
    expect(screen.getByText("把腳本拆成 6 鏡並逐鏡出圖")).toBeVisible();
  });
});
